# translate-rt

Minimal real-time translation stack:

* a Flask frontend served by `app.py`;
* a FastAPI backend in `api-translate-rt/` for transcription, translation, diarization, and TTS proxying;
* idempotent `uv` install/run scripts that use `~/venv/<basename project dir>`.

## Requirements

* Python 3.10+
* `uv` (installed automatically by `install.sh` when missing)
* `ffmpeg` on `PATH` for audio conversion/provider compatibility
* API tokens configured in `.env`

The project is CPU-safe by default and does not pin CUDA libraries, so the same scripts are compatible with GPU hosts such as H100/DGX Spark when your upstream providers or local extensions use those accelerators.

## Quick start

```bash
cp .env.example .env
cp api-translate-rt/.env.example api-translate-rt/.env
$EDITOR .env api-translate-rt/.env
./install.sh
source ./run.sh 0.0.0.0 5000
```

Start the API in another shell:

```bash
cd api-translate-rt
./install.sh
source ./run.sh 0.0.0.0 8080
```

`run.sh [IP] [PORT]` is systemd-compatible: execute it directly from an `ExecStart=` command, or source it during interactive development. The virtual environment path is always `~/venv/<basename project dir>` unless you override `VENV_DIR`.

## Environment

Copy `.env.example` to `.env` for the frontend/runtime defaults and `api-translate-rt/.env.example` to `api-translate-rt/.env` for the backend. Only important variables are shown; optional/default variables are commented with `#`.

Most deployments need:

```bash
AUDIO_API_KEY=...
OPENAI_API_KEY=...
OPENAI_API_SCHEME=https
OPENAI_API_HOST=api.openai.com
OPENAI_API_BASE=${OPENAI_API_SCHEME}://${OPENAI_API_HOST}/v1
#OPENAI_API_MODEL=gpt-4o-mini
#TRANSLATE_RT_API_TOKEN=change-me
```

Set `TRANSLATE_RT_API_TOKEN` to require `Authorization: Bearer <token>` on backend API routes.

## Popular API endpoints

Backend endpoints:

* `GET /healthz`
* `POST /upload` — `multipart/form-data` audio upload for transcription and translation
* `POST /translate-text` — JSON text translation helper
* `POST /tts-proxy` — JSON TTS proxy returning audio bytes

The translation provider is called through the popular OpenAI-compatible Chat Completions API at `${OPENAI_API_BASE}/chat/completions`.

## Systemd examples

Frontend:

```ini
[Service]
WorkingDirectory=/opt/translate-rt
ExecStart=/bin/bash -lc './run.sh 0.0.0.0 5000'
Restart=always
```

Backend:

```ini
[Service]
WorkingDirectory=/opt/translate-rt/api-translate-rt
ExecStart=/bin/bash -lc './run.sh 0.0.0.0 8080'
Restart=always
```
