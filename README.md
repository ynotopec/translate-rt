# translate-rt

Real-time speech translation prototype built with a lightweight Flask frontend and a FastAPI companion service that performs transcription, translation, diarisation and optional text-to-speech playback. The project is designed around rapid experimentation for live events: the web UI captures audio in the browser, streams it to the API and displays both the transcript and the translated text with speaker labels.

## Repository layout

| Path | Description |
| --- | --- |
| `frontend/app.py` | Minimal Flask application that serves the static single-page UI from `frontend/static/`. |
| `frontend/static/` | Frontend assets (HTML, JavaScript and styles) implementing recording, diarisation display and TTS playback. |
| `frontend/run.sh` | Helper script that creates a virtual environment, loads environment variables from `.env` and launches the Flask app. |
| `api-translate-rt/` | Standalone FastAPI + Socket.IO backend providing `/upload`, `/tts-proxy` and realtime streaming endpoints. |
| `api-translate-rt/mini_OpenAPI.yaml` | Compact OpenAPI description of the public HTTP endpoints exposed by the API. |

## Frontend architecture diagram

```mermaid
flowchart TD
    subgraph Browser["Browser<br/>(frontend/static/html/index.html<br/>+ static/js/code.js)"]
        U[User actions<br/>record/stop buttons,<br/>language selectors]
        UI[DOM binding & DSFR layout]
        Recorder[Recorder module<br/>(MediaRecorder + getUserMedia)]
        VAD[Custom VAD loop<br/>and speech detection]
        Chunker[Audio chunk buffer<br/>State.audioChunks]
        Network[Network helpers<br/>fetch + Socket.IO]
        Renderer[UI renderer<br/>transcript & translation]
        TTSQueue[TTS playback queue]
    end

    subgraph API[api-translate-rt service]
        Upload[/POST /upload/]
        Realtime[/Socket.IO /realtime/]
        TTSProxy[/POST /tts-proxy/]
    end

    U --> UI --> Recorder --> VAD --> Chunker --> Network
    Network --> Upload
    Upload --> Network
    Network --> Renderer
    Renderer --> UI
    Renderer --> TTSQueue
    TTSQueue --> TTSProxy
    TTSProxy --> TTSQueue
    Network <-- Realtime
    Realtime --> Renderer
```

The diagram highlights how the Flask-served single-page app orchestrates browser APIs. `MediaRecorder` captures Opus audio frames, the custom voice activity detector segments speech before uploading chunks to the REST backend, and the realtime Socket.IO channel streams live transcripts back to the renderer. When text-to-speech is enabled, translations are queued for playback by calling the `/tts-proxy` endpoint and playing the returned Opus audio in the browser.

## Prerequisites

* Python 3.10 or newer.
* `ffmpeg` available on the `PATH` (required by the API to transcode audio chunks for Whisper and TTS).
* API credentials for speech-to-text and translation providers (see [Environment variables](#environment-variables)).

## Quick start

1. **Clone the repository and prepare your environment**
   ```bash
   git clone https://github.com/<your-org>/translate-rt.git
   cd translate-rt
   cp .env.example .env  # fill in the secrets that match your deployment
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

2. **Start the frontend Flask app**
   ```bash
   cd frontend
   ./run.sh 0.0.0.0 5000
   # or run manually:
   # SERVER_NAME=0.0.0.0 SERVER_PORT=5000 python app.py
   ```
   The UI becomes available at [http://localhost:5000](http://localhost:5000). It serves the static assets in `frontend/static/` and proxies API calls directly to the backend URLs defined in the JavaScript configuration.

3. **Launch the API service (in another shell)**
   ```bash
   cd api-translate-rt
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt webrtcvad
   python app.py
   ```
   By default the API listens on `SERVER_NAME`/`SERVER_PORT` (defaults to `0.0.0.0:5001`). Adjust the frontend configuration in `frontend/static/js/code.js` if you want to call a different base URL during development.

## Environment variables

Create a `.env` file (see `.env.example`) to share configuration between the scripts. The most relevant settings are:

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUDIO_API_KEY` | ✅ | Bearer token used to call the Whisper transcription endpoint (`Cfg.WHISPER_URL`). |
| `OPENAI_API_KEY` | ✅ | Token for the translation provider used by `/upload` and realtime translation. |
| `OPENAI_API_BASE` | ⚙️ | Base URL of the translation API. Defaults to the public OpenAI endpoint. |
| `OPENAI_API_MODEL` | ⚙️ | Chat model identifier passed when creating translations. |
| `DIARIZATION_TOKEN` | ⚙️ | Optional token enabling diarisation via `Cfg.DIAR_URL`. Leave empty to disable diarisation. |
| `TTS_API_KEY` | ⚙️ | Enables `/tts-proxy` and realtime TTS responses when provided. |
| `TTS_API_URL` | ⚙️ | Overrides the default text-to-speech API endpoint. |
| `API_TOKENS` | ⚙️ | Comma-separated list of bearer tokens accepted by the realtime Socket.IO namespace. Leave empty to allow unauthenticated access. |
| `SERVER_NAME` | ⚙️ | Host interface for the frontend Flask app and backend FastAPI service. Defaults to `localhost` for the UI and `0.0.0.0` for the API. |
| `SERVER_PORT` | ⚙️ | TCP port used by the running service. When launching `run.sh`, the backend port is computed as `SERVER_PORT + 1`. |
| `VAD_AGGR` | ⚙️ | Controls the aggressiveness of WebRTC voice activity detection on the realtime socket endpoint (integer `0-3`). |

> ℹ️ Environment variables marked with ⚙️ are optional; omit them to use the built-in defaults.

## API documentation

The backend exposes two REST endpoints and a realtime Socket.IO namespace:

* **`POST /upload`** – accepts an audio chunk (`multipart/form-data`) together with `target_lang` and `primary_lang` form fields. Returns transcription, diarisation metadata and per-language translations. A concise summary is available in [`api-translate-rt/README.md`](api-translate-rt/README.md).
* **`POST /tts-proxy`** – forwards text to the configured TTS provider and streams back Opus audio.
* **`/realtime` Socket.IO namespace** – receives Opus frames, performs streaming transcription/translation and emits transcript + audio messages.

For an OpenAPI snapshot of the REST surface, refer to [`api-translate-rt/mini_OpenAPI.yaml`](api-translate-rt/mini_OpenAPI.yaml).

## Development tips

* Frontend constants such as the API base URLs, supported languages and VAD thresholds are centralised at the top of [`frontend/static/js/code.js`](frontend/static/js/code.js).
* Styling relies on the French government DSFR design system served from the CDN; you can add custom overrides in `frontend/static/html/index.html`.
* When iterating on the backend, tweak FastAPI logging or enable Uvicorn debug output in [`api-translate-rt/app.py`](api-translate-rt/app.py) for more verbose traces.
