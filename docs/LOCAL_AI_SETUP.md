# Local AI Setup — Whisper, LLM, and Kokoro

1StopQuantum and Sumi use three separate model boundaries. The reference setup
keeps speech on the Mac and lets the administrator choose a local or remote
OpenAI-compatible LLM.

| Boundary | Reference implementation | API used by this repository |
| --- | --- | --- |
| Speech to text | MLX Whisper | `POST /api/transcribe`, `WS /api/duplex` on `127.0.0.1:5152` |
| Reasoning | Ollama, MLX-LM, llama.cpp, LM Studio, or remote provider | `GET /v1/models`, `POST /v1/chat/completions` |
| Text to speech | Kokoro 82M | `POST /api/speak` on `127.0.0.1:5152` |

## Apple Silicon installation

Install the core application and database first:

```bash
./setup.sh
```

Install the optional local speech dependencies:

```bash
./scripts/setup-local-voice.sh
```

That script installs `ffmpeg`, `espeak-ng`, `mlx-whisper`, Kokoro, SoundFile,
and Silero VAD. Keep these values in the ignored `.env` file:

```dotenv
WHISPER_MODEL=mlx-community/whisper-small-mlx
KOKORO_API_URL=http://127.0.0.1:5152
COMPANION_TTS_MODEL=hexgrad/Kokoro-82M
VOICE_HOST=127.0.0.1
VOICE_PORT=5152
VOICE_AUTOSTART=1
```

`./manage.sh start` launches this API with the rest of the stack. The first voice
start or request downloads and caches the selected models, so it needs internet
access and may take longer. Later starts use the local cache. Set
`VOICE_AUTOSTART=0` only when live voice is not needed; saved course narration
continues to work.

## Choose the LLM server

The LLM must implement the OpenAI-compatible model-list and chat-completion
routes. Pick one option and copy its base URL and exact model ID to `.env`.

### Ollama

```bash
brew install ollama
brew services start ollama
ollama pull qwen2.5-coder:14b
```

```dotenv
LLM_PROVIDER=local
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5-coder:14b
LLM_API_KEY=ollama
```

### MLX-LM

Install `mlx-lm` in a separate environment, then run its local server on a port
that does not conflict with the frontend:

```bash
mlx_lm.server --model mlx-community/Mistral-7B-Instruct-v0.3-4bit --port 8888
```

Set `LLM_BASE_URL=http://127.0.0.1:8888/v1` and use the same model repository as
`LLM_MODEL`. The official MLX-LM server is intended for local development, not an
internet-facing production service.

### llama.cpp

```bash
brew install llama.cpp
llama-server -hf ggml-org/gemma-3-1b-it-GGUF --port 8888
```

Set `LLM_BASE_URL=http://127.0.0.1:8888/v1`; use the model ID returned by
`curl http://127.0.0.1:8888/v1/models` as `LLM_MODEL`.

For a remote OpenAI-compatible service, set `LLM_PROVIDER=openai`, its `/v1`
base URL, model ID, and API key. Secrets stay in `.env` or encrypted PostgreSQL
administrator settings and are never placed in browser JavaScript.

## Start and verify

```bash
./manage.sh start
./manage.sh status

curl -fsS http://127.0.0.1:5152/health
curl -fsS "$LLM_BASE_URL/models" -H "Authorization: Bearer $LLM_API_KEY"
curl -fsS http://localhost:8000/health
open http://localhost:8080
```

Test Kokoro directly:

```bash
curl -fsS http://127.0.0.1:5152/api/speak \
  -H 'Content-Type: application/json' \
  -d '{"text":"Sumi is ready.","voice":"am_michael","speed":0.94}' \
  -o /tmp/sumi-ready.wav
afplay /tmp/sumi-ready.wav
```

To test Whisper, send a WAV, WebM, MP3, MP4, or Ogg recording as the multipart
field named `audio`:

```bash
curl -fsS http://127.0.0.1:5152/api/transcribe \
  -F 'audio=@/path/to/short-recording.wav'
```

## Replacing providers in another Sumi host

Sumi's generated adapter is provider-neutral. The host learning platform exposes
authenticated server routes and points `window.SUMI_STT_URL`,
`window.SUMI_LLM_URL`, and `window.SUMI_TTS_URL` at them. STT returns `text` or
`transcription`; the LLM returns a response plus an optional registered action;
TTS returns an audio blob. Keep all remote-provider credentials on that host's
server. The integrated 1StopQuantum demo deliberately uses local Whisper and
Kokoro on port `5152`.

Provider references: [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility),
[MLX-LM server](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md),
and [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server).
