英语口音纠音（听音）由浏览器内 ffmpeg.wasm 将录音转为 WAV，服务端无需安装 ffmpeg。

### 用 uv 跑起来（推荐）

**[uv](https://docs.astral.sh/uv/)** 跨平台、单二进制，自动装 Python 和依赖。

**步骤：**

1. **装 uv**（任选一种）  
   - macOS / Linux：`curl -LsSf --http1.1 https://astral.sh/uv/install.sh | sh`（若报 HTTP2 错误则加 `--http1.1`）  
   - 或：`brew install uv`  
   - Windows：`powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`

2. **进项目目录**  
   `cd fluent_english`

3. **装 Python 3.11**（本仓库用 3.11，由 `.python-version` 指定；macOS 15 x86_64 上 onnxruntime 需 3.11）  
   `uv python install 3.11`

4. **装依赖并建虚拟环境**  
   `uv sync`  
   （会按 `pyproject.toml` 创建 `.venv` 并安装依赖）

5. **配环境变量**  
   复制 `.env.example` 为 `.env`，填好 `OPENAI_API_KEY` 或 `CHAT_API_KEY` 等（见文件内注释）。

6. **启动服务**  
   `uv run python web_main.py`  
   浏览器打开 http://localhost:8000

之后每次开发：进目录后直接 `uv run python web_main.py` 或 `uv run uvicorn web_main:app --reload` 即可；依赖变更后执行一次 `uv sync`。

其他方式：已装 **pyenv** 时本目录会按 `.python-version` 用 3.11；或用 **Homebrew** 装 `python@3.11` 后 `pip install -r requirements.txt`。
