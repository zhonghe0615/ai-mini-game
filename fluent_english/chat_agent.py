#!/usr/bin/env python3
"""
AI chat agent with RAG over conversation history.
Stores each turn in ChromaDB; context = last N turns by time (no similarity search).
Chat/embeddings: configurable via env (OpenAI, DeepSeek, or any OpenAI-compatible API).
Voice (TTS, Whisper, gpt-audio): requires OPENAI_API_KEY. See .env.example.
"""
import os
import sys
import time
import uuid

from dotenv import load_dotenv

load_dotenv()


def _env(key: str, default: str | None = None) -> str | None:
    v = os.getenv(key)
    return v.strip() if (v and v.strip()) else default


# 至少需要一种 key：聊天用 CHAT_API_KEY 或 OPENAI_API_KEY；语音功能需 OPENAI_API_KEY
_chat_key = _env("CHAT_API_KEY") or _env("OPENAI_API_KEY")
if not _chat_key:
    print("Error: Set CHAT_API_KEY or OPENAI_API_KEY in .env (for chat). Voice features need OPENAI_API_KEY.")
    sys.exit(1)

from langchain_core.documents import Document
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_chroma import Chroma
from openai import OpenAI

# 配置
CHROMA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_chat")
COLLECTION_NAME = "chat_history"
RECENT_TURNS = 10

# 聊天模型：CHAT_BASE_URL + CHAT_MODEL 可换为 DeepSeek 等 OpenAI 兼容 API
_chat_base = _env("CHAT_BASE_URL")
_chat_model = _env("CHAT_MODEL") or "gpt-4o-mini"
llm = ChatOpenAI(
    model=_chat_model,
    temperature=0.3,
    api_key=_chat_key,
    base_url=_chat_base if _chat_base else None,
)

# 向量检索用 embedding，可与聊天不同源（如聊天用 DeepSeek、embedding 用 OpenAI）
_emb_key = _env("EMBEDDING_API_KEY") or _chat_key
_emb_base = _env("EMBEDDING_BASE_URL") or _chat_base
_emb_model = _env("EMBEDDING_MODEL") or "text-embedding-3-small"
embeddings = OpenAIEmbeddings(
    api_key=_emb_key,
    openai_api_base=_emb_base if _emb_base else None,
    model=_emb_model,
)

# 语音反馈（gpt-audio）、TTS、Whisper 目前仅支持 OpenAI，由 web_main / 此处使用
_openai_key = _env("OPENAI_API_KEY")
client_openai: OpenAI | None = OpenAI(api_key=_openai_key) if _openai_key else None

# 持久化向量库：存在则加载，否则新建
vectorstore = Chroma(
    collection_name=COLLECTION_NAME,
    embedding_function=embeddings,
    persist_directory=CHROMA_DIR,
)


def _format_turn(human: str, assistant: str) -> str:
    return f"Human: {human}\nAssistant: {assistant}"


def _retrieve_context(chat_id: str | None = None, user_id: str | None = None) -> str:
    """Return last RECENT_TURNS turns by time (oldest to newest). Filters by chat_id, then user_id if set."""
    coll = vectorstore._collection
    res = coll.get(include=["metadatas", "documents"])
    ids = res.get("ids") or []
    metadatas = res.get("metadatas") or []
    documents = res.get("documents") or []
    if not ids:
        return "(No prior conversation yet.)"
    rows = []
    for i, _ in enumerate(ids):
        meta = metadatas[i] if i < len(metadatas) and isinstance(metadatas[i], dict) else {}
        if not isinstance(meta, dict):
            meta = {}
        if chat_id is not None and meta.get("chat_id") != chat_id:
            continue
        if user_id is not None and meta.get("user_id") != user_id:
            continue
        ts = meta.get("ts") or 0
        doc = documents[i] if i < len(documents) else ""
        rows.append((ts, doc or ""))
    rows.sort(key=lambda x: x[0])
    last = rows[-RECENT_TURNS:]
    if not last:
        return "(No prior conversation yet.)"
    return "\n---\n".join(d for _, d in last)


SYSTEM_PROMPT = (
    "You are a native English speaker from the United States, an English teacher who has been living in China for 20 years. "
    "Your career focus is correcting common pronunciation issues of Asian English learners and helping them move toward "
    "standard British or American accent. You are skilled at guiding learners with various accents to clearer, more "
    "standard pronunciation. Reply in a supportive, teacher-like way; when relevant, give brief pronunciation tips "
    "or corrections. Whenever you correct or explain the pronunciation of a word, always give its standard IPA (International "
    "Phonetic Alphabet) in slashes, e.g. precedent /ˈpresɪdənt/, so the learner can see the target pronunciation clearly."
)

SYSTEM_PROMPT_TEXT_ONLY = (
    "Important: you only receive text (no audio). Do not claim to 'listen' to or 'hear' the user's pronunciation; "
    "you can only work with the transcribed text (e.g. grammar, word choice, or whether they read the correct words in a read-along)."
)

# When user selects a second language (zh/ko/ja), tell LLM to avoid assuming a third language (e.g. avoid hearing Chinese as Korean).
USER_LANGUAGE_HINT = {
    "zh": "The user will only communicate in English and Chinese in this session; no other language will appear. Do not interpret their words as another language (e.g. do not treat Chinese as Korean or Japanese).",
    "ko": "The user will only communicate in English and Korean in this session; no other language will appear. Do not interpret their words as another language (e.g. do not treat Korean as Chinese or Japanese).",
    "ja": "The user will only communicate in English and Japanese in this session; no other language will appear. Do not interpret their words as another language (e.g. do not treat Japanese as Chinese or Korean).",
}

READALONG_PROMPT = (
    "The user is doing a read-along exercise. We only have text from speech-to-text (no audio), so you cannot evaluate "
    "actual pronunciation quality.\n\n"
    "Target sentence (what they should read): {target}\n\n"
    "What the user said (transcription): {transcribed}\n\n"
    "Compare the two: (1) Did they say the right words? Note any wrong, missing, or extra words. "
    "(2) Give one short, encouraging feedback. When mentioning a word they misread or should practice, give its standard IPA in slashes (e.g. /ˈpresɪdənt/). Do not claim you heard their accent or pronunciation.\n\n"
    "Important: When you say what the user said (e.g. 'Instead, you said X'), you MUST quote the transcription above exactly. Do not paraphrase, interpret, or replace with different words; use the transcription text verbatim."
)

WANTS_PRONUNCIATION_PROMPT = (
    "The following is a transcription of something the user just said (possibly in English or Chinese). "
    "Does the user explicitly or implicitly ask for pronunciation feedback, accent correction, or for you to "
    '"listen to" or "hear" how they sound? Examples: "correct my pronunciation", "how is my accent", '
    '"帮我纠正发音", "听一下我读得怎么样". Reply with exactly one word: YES or NO.'
)


def wants_pronunciation_feedback(user_text: str) -> bool:
    """Infer from semantics whether the user wants pronunciation/accent feedback (so we should use gpt-audio).
    Only meaningful when the input is from voice; callers must not use this for text-only path."""
    if not (user_text or "").strip():
        return False
    # if is_likely_conversational_reply(user_text):
    #     return False
    reply = llm.invoke(
        f"{WANTS_PRONUNCIATION_PROMPT}\n\nUser said: {user_text.strip()}\n\nReply:"
    ).content
    return reply and "YES" in reply.upper().strip()


def _language_hint(user_second_language: str | None) -> str:
    if not user_second_language or user_second_language not in USER_LANGUAGE_HINT:
        return ""
    return USER_LANGUAGE_HINT[user_second_language] + "\n\n"


def _reply(
    user_input: str,
    user_second_language: str | None = None,
    user_id: str | None = None,
    chat_id: str | None = None,
) -> str:
    context = _retrieve_context(chat_id=chat_id, user_id=user_id)
    hint = _language_hint(user_second_language)
    prompt = (
        f"{SYSTEM_PROMPT}\n\n{SYSTEM_PROMPT_TEXT_ONLY}\n\n{hint}"
        "Use the following relevant past conversation (if any) as context.\n\n"
        "Relevant past context:\n"
        f"{context}\n\n"
        f"Current user message: {user_input}\n\n"
        "Reply concisely and naturally."
    )
    return llm.invoke(prompt).content


def chat(
    user_text: str,
    user_second_language: str | None = None,
    user_id: str | None = None,
    chat_id: str | None = None,
) -> str:
    """One turn: get reply and persist to Chroma. Used by CLI and web. Context is scoped by chat_id."""
    reply = _reply(user_text, user_second_language, user_id, chat_id)
    meta = {"turn": str(uuid.uuid4()), "ts": time.time()}
    if chat_id is not None:
        meta["chat_id"] = chat_id
    if user_id is not None:
        meta["user_id"] = user_id
    doc = Document(page_content=_format_turn(user_text, reply), metadata=meta)
    vectorstore.add_documents([doc], ids=[str(uuid.uuid4())])
    return reply


def chat_readalong(
    user_text: str,
    target_sentence: str,
    user_second_language: str | None = None,
    user_id: str | None = None,
    chat_id: str | None = None,
) -> str:
    """Read-along mode: compare target vs transcribed text only; no audio. Persist to Chroma.
    Context scoped by chat_id so agent sees prior turns of this chat only."""
    context = _retrieve_context(chat_id=chat_id, user_id=user_id)
    hint = _language_hint(user_second_language)
    prompt = READALONG_PROMPT.format(
        target=target_sentence.strip(),
        transcribed=user_text.strip(),
    )
    reply = llm.invoke(
        f"{SYSTEM_PROMPT}\n\n{SYSTEM_PROMPT_TEXT_ONLY}\n\n{hint}"
        "Relevant past context:\n"
        f"{context}\n\n"
        f"{prompt}\n\nReply in 2-4 short sentences."
    ).content
    meta = {"turn": str(uuid.uuid4()), "ts": time.time()}
    if chat_id is not None:
        meta["chat_id"] = chat_id
    if user_id is not None:
        meta["user_id"] = user_id
    doc = Document(
        page_content=_format_turn(
            f"[Read-along] Target: {target_sentence.strip()}. User said: {user_text.strip()}",
            reply,
        ),
        metadata=meta,
    )
    vectorstore.add_documents([doc], ids=[str(uuid.uuid4())])
    return reply


def chat_voice(
    audio_base64: str,
    audio_format: str,
    user_second_language: str | None = None,
    user_id: str | None = None,
    chat_id: str | None = None,
) -> str:
    """Send user audio to gpt-audio so the model hears and gives pronunciation/accent feedback. Persist to Chroma.
    Requires OPENAI_API_KEY; if not set, returns a short message asking for it."""
    if not client_openai:
        return "Voice pronunciation feedback (gpt-audio) requires OPENAI_API_KEY in .env. You can still use text chat and other voice features (Whisper + TTS also need OpenAI)."
    hint = _language_hint(user_second_language)
    system = (
        f"{SYSTEM_PROMPT}{hint}You are now listening to the user's voice recording. "
        "Give brief, specific pronunciation or accent feedback (sounds to improve, stress, clarity). "
        "For any word you correct or explain, include its standard IPA in slashes (e.g. /ˈpresɪdənt/). "
        "Reply in 2-5 short sentences; you may use both English and the user's other language if helpful."
    )
    completion = client_openai.chat.completions.create(
        model="gpt-audio",
        modalities=["text"],
        messages=[
            {
                "role": "system",
                "content": system,
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": audio_base64, "format": audio_format},
                    },
                ],
            },
        ],
    )
    reply = (completion.choices[0].message.content or "").strip()
    meta = {"turn": str(uuid.uuid4()), "ts": time.time()}
    if chat_id is not None:
        meta["chat_id"] = chat_id
    if user_id is not None:
        meta["user_id"] = user_id
    doc = Document(
        page_content=_format_turn("[Voice: user sent recording for pronunciation feedback]", reply),
        metadata=meta,
    )
    vectorstore.add_documents([doc], ids=[str(uuid.uuid4())])
    return reply


def main() -> None:
    print("Chat with RAG (LangChain + Chroma + GPT). Type 'quit' or 'exit' to end.\n")
    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye.")
            break
        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("Bye.")
            break
        response = chat(user_input)
        print("Agent:", response, "\n")


if __name__ == "__main__":
    main()
