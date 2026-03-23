#!/usr/bin/env python3
"""
Web backend for fluent_english: chat + voice (STT via Whisper).
Serves static frontend and exposes /api/chat, /api/speech, /api/speech/stream.
Proxies /ffmpeg/* so FFmpeg.wasm worker loads same-origin (avoids Worker cross-origin on localhost).
"""
import asyncio
import base64
import json
import os
import tempfile
import urllib.request
import uuid
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

# 聊天至少需要 CHAT_API_KEY 或 OPENAI_API_KEY；语音（TTS、Whisper、gpt-audio）需 OPENAI_API_KEY
if not (os.getenv("CHAT_API_KEY") or os.getenv("OPENAI_API_KEY")):
    raise RuntimeError("Set CHAT_API_KEY or OPENAI_API_KEY in .env. Voice features require OPENAI_API_KEY.")

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel

# Import after env check so CLI can run without starting server
from chat_agent import chat, chat_readalong, chat_voice, wants_pronunciation_feedback

app = FastAPI(title="Fluent English Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# FFmpeg.wasm proxy: worker/core from same origin to avoid "Failed to construct Worker" on localhost
_FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm"
_FFMPEG_PKG_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm"


def _media_type(path: str) -> str:
    if path.endswith(".wasm"):
        return "application/wasm"
    if path.endswith(".js"):
        return "text/javascript"
    return "application/octet-stream"


@app.get("/ffmpeg/core/{path:path}")
def proxy_ffmpeg_core(path: str):
    """Proxy @ffmpeg/core ESM files so worker can load same-origin."""
    url = f"{_FFMPEG_CORE_BASE}/{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FluentEnglish/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return Response(content=r.read(), media_type=_media_type(path))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/ffmpeg/ffmpeg/{path:path}")
def proxy_ffmpeg_pkg(path: str):
    """Proxy @ffmpeg/ffmpeg ESM files (worker.js + deps) same-origin."""
    url = f"{_FFMPEG_PKG_BASE}/{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FluentEnglish/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return Response(content=r.read(), media_type=_media_type(path))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
# TTS、Whisper 用 OpenAI；未配置时相关接口会返回错误或跳过
client_openai = OpenAI() if os.getenv("OPENAI_API_KEY") else None


def _text_to_speech(text: str) -> Optional[str]:
    """Generate natural-sounding speech via OpenAI TTS (tts-1-hd). Returns base64 mp3 or None on error."""
    if not (text or "").strip() or not client_openai:
        return None
    try:
        resp = client_openai.audio.speech.create(
            model="tts-1-hd",
            voice="nova",
            input=text.strip()[:4096],
            response_format="mp3",
        )
        data = resp.read()
        return base64.b64encode(data).decode("ascii") if data else None
    except Exception:
        return None


class ChatBody(BaseModel):
    text: str
    language: Optional[str] = None  # zh, ko, ja, en: user's second language for LLM hint (en or empty = no hint)
    chat_id: Optional[str] = None  # if missing, backend generates new and returns it


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


def _user_second_lang(lang: Optional[str]) -> Optional[str]:
    """Return zh/ko/ja for LLM hint; en or empty = None."""
    if not (lang or "").strip():
        return None
    return lang.strip().lower() if lang.strip().lower() in ("zh", "ko", "ja") else None


@app.post("/api/chat")
def api_chat(body: ChatBody):
    """Text-only path: never do pronunciation feedback on current sentence (no voice)."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")
    chat_id = (body.chat_id or "").strip() or str(uuid.uuid4())
    second_lang = _user_second_lang(body.language)
    reply = chat(text, user_second_language=second_lang, chat_id=chat_id)
    audio_b64 = _text_to_speech(reply)
    out = {"reply": reply, "chat_id": chat_id}
    if audio_b64:
        out["audio"] = audio_b64
    return out


@app.post("/api/speech")
async def api_speech(
    file: UploadFile = File(...),
    target: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    chat_id: Optional[str] = Form(None),
):
    if not client_openai:
        raise HTTPException(
            status_code=503,
            detail="Voice (Whisper/TTS) requires OPENAI_API_KEY in .env. Text chat works with CHAT_API_KEY only.",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio file is empty")
    suffix = ".webm"
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[-1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(content)
        path = f.name
    try:
        lang = (language or "").strip().lower()
        target_sentence = (target or "").strip()
        # 跟读：强制英语。自由说：不传 language，Whisper 自动检测，便于中英混杂识别
        whisper_lang = "en" if target_sentence else None
        kwargs = {}
        if whisper_lang and whisper_lang in ("zh", "en", "ko", "ja", "es", "fr", "de"):
            kwargs["language"] = whisper_lang
        with open(path, "rb") as f:
            transcript = client_openai.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                **kwargs,
            )
        user_text = (transcript.text or "").strip()
        cid = (chat_id or "").strip() or str(uuid.uuid4())
        second_lang = _user_second_lang(lang)
        if target_sentence:
            reply = chat_readalong(user_text, target_sentence, user_second_language=second_lang, chat_id=cid) if user_text else ""
        else:
            # Voice path only: optionally use gpt-audio for pronunciation. Short replies (yes/no/好的) use chat with context.
            use_listen = wants_pronunciation_feedback(user_text)
            if use_listen:
                # gpt-audio only accepts wav/mp3; frontend converts webm→wav with ffmpeg.wasm (no server ffmpeg)
                if suffix == ".wav" or suffix == ".mp3":
                    audio_b64 = base64.b64encode(content).decode("ascii")
                    fmt = "wav" if suffix == ".wav" else "mp3"
                    reply = chat_voice(audio_b64, fmt, user_second_language=second_lang, chat_id=cid)
                else:
                    fallback_note = (
                        "[Pronunciation by listening needs WAV audio. Use latest Chrome/Firefox to enable in-browser conversion.]\n\n"
                    )
                    reply = fallback_note + (chat(user_text, user_second_language=second_lang, chat_id=cid) if user_text else "Say something to get feedback.")
            else:
                reply = chat(user_text, user_second_language=second_lang, chat_id=cid) if user_text else ""
        out = {"reply": reply, "text": user_text, "chat_id": cid}
        audio_b64 = _text_to_speech(reply)
        if audio_b64:
            out["audio"] = audio_b64
        return out
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


async def _stream_speech_gen(
    content: bytes, path: str, suffix: str, target: Optional[str], language: Optional[str], chat_id: str
):
    """Yield NDJSON: chat_id, transcript, then done (reply + audio). Context scoped by chat_id."""
    try:
        yield json.dumps({"type": "chat_id", "chat_id": chat_id}) + "\n"
        lang = (language or "").strip().lower()
        target_sentence = (target or "").strip()
        # 跟读：强制英语。自由说：不传 language，Whisper 自动检测，便于中英混杂识别
        whisper_lang = "en" if target_sentence else None
        kwargs = {}
        if whisper_lang and whisper_lang in ("zh", "en", "ko", "ja", "es", "fr", "de"):
            kwargs["language"] = whisper_lang
        with open(path, "rb") as f:
            transcript = await asyncio.to_thread(
                lambda: client_openai.audio.transcriptions.create(model="whisper-1", file=f, **kwargs),
            )
        user_text = (transcript.text or "").strip()
        yield json.dumps({"type": "transcript", "text": user_text}) + "\n"

        second_lang = _user_second_lang(lang)
        if target_sentence:
            reply = await asyncio.to_thread(
                lambda: chat_readalong(user_text, target_sentence, second_lang, chat_id=chat_id),
            ) if user_text else ""
        else:
            # Voice path only: optionally gpt-audio for pronunciation; short replies use chat with context
            use_listen = await asyncio.to_thread(wants_pronunciation_feedback, user_text)
            if use_listen and suffix in (".wav", ".mp3"):
                audio_b64 = base64.b64encode(content).decode("ascii")
                fmt = "wav" if suffix == ".wav" else "mp3"
                reply = await asyncio.to_thread(
                    lambda: chat_voice(audio_b64, fmt, second_lang, chat_id=chat_id),
                )
            elif use_listen:
                reply = (
                    "[Pronunciation by listening needs WAV audio. Use latest Chrome/Firefox.]\n\n"
                    + (await asyncio.to_thread(lambda: chat(user_text, second_lang, chat_id=chat_id)) if user_text else "")
                )
            else:
                reply = await asyncio.to_thread(lambda: chat(user_text, second_lang, chat_id=chat_id)) if user_text else ""
        audio_b64 = await asyncio.to_thread(_text_to_speech, reply)
        yield json.dumps({"type": "done", "reply": reply, "audio": audio_b64}) + "\n"
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


@app.post("/api/speech/stream")
async def api_speech_stream(
    file: UploadFile = File(...),
    target: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    chat_id: Optional[str] = Form(None),
):
    """Stream: chat_id (if new), transcript, then done (reply, audio). Context is scoped by chat_id."""
    if not client_openai:
        raise HTTPException(
            status_code=503,
            detail="Voice (Whisper/TTS) requires OPENAI_API_KEY in .env. Text chat works with CHAT_API_KEY only.",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio file is empty")
    cid = (chat_id or "").strip() or str(uuid.uuid4())
    suffix = ".webm"
    if file.filename and "." in file.filename:
        suffix = "." + file.filename.rsplit(".", 1)[-1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(content)
        path = f.name
    return StreamingResponse(
        _stream_speech_gen(content, path, suffix, target, language, cid),
        media_type="application/x-ndjson",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
