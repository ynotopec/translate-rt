# translate-rt

Minimal real-time translation stack:

* a Flask frontend served by `app.py`;
* a FastAPI backend in `api-translate-rt/` for transcription, translation, diarization, and TTS proxying;
* idempotent `uv` install/run scripts that use `~/venv/<basename project dir>`.

## Requirements

* Python 3.12 (tested)
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
TRANSLATE_RT_API_SCHEME=https
TRANSLATE_RT_API_HOST=api-translate-rt.ailab.infocepo.com
TRANSLATE_RT_API_BASE=${TRANSLATE_RT_API_SCHEME}://${TRANSLATE_RT_API_HOST}
```

Set `TRANSLATE_RT_API_TOKEN` to require `Authorization: Bearer <token>` on backend API routes. Flask uses `TRANSLATE_RT_API_BASE` server-side; browser requests stay on the frontend origin.

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

## Security and deployment

The bundled browser now calls `/api/upload` and `/api/tts-proxy` on **the Flask origin**.
Flask forwards the request and adds `TRANSLATE_RT_API_TOKEN` on the server; this token
is never delivered in HTML or JavaScript. Existing `TRANSLATE_RT_*_URL` overrides
still select the upstream destination, but the Flask host must now reach it.
Configure the same strong token in both services. Direct API clients continue to
use `Authorization: Bearer <token>` on the existing routes.

The frontend is a proxy, **not a user identity provider**. Before exposing it,
protect the Flask origin with your reverse proxy/SSO and keep the backend private.
The `X-Translate-RT: 1` header and origin checks prevent browser cross-origin
submission; they do not authenticate a user or stop direct HTTP clients.
Do not enable cross-origin access on Flask. Behind a TLS-terminating proxy, set
`FRONTEND_PUBLIC_ORIGIN=https://your-public-host` to the exact external origin
(no path), preserve the Host header and restrict incoming hosts at the proxy.
Never trust arbitrary forwarded headers from the public network.

Defaults, configurable through environment variables:

| Setting | Default | Scope |
| --- | --- | --- |
| `MAX_REQUEST_BYTES` | 12582912 (12 MiB) | Flask and API request body |
| `MAX_AUDIO_BYTES` | 10485760 (10 MiB) | API uploaded audio |
| `MAX_CONCURRENT_REQUESTS` | 32 | API requests per worker |
| `MAX_REQUESTS_PER_MINUTE` | 1200 | API requests per worker, shared across clients |
| `PROXY_READ_TIMEOUT` | 120 seconds | Flask upstream read timeout |

API limits reject excess demand with 413/429, including bodies sent without
Content-Length. Health and documentation routes are exempt. Use the ingress for
shared quotas, per-user limits, connection limits and slow-upload timeouts across
workers/replicas. Text and TTS input are capped at 20,000 characters.

Translation caching has been removed: `MAX_CACHE_SIZE` no longer has an effect.
Repeated phrases now call the provider again. Application logs omit payloads and
provider error bodies. There is no application database or stored recording;
provider retention and infrastructure logs must be assessed separately. The browser
keeps transcript results in memory; downloaded exports remain on the user's device.

### Container (Python 3.12)

```bash
# Create api-translate-rt/.env from its example and set provider credentials.
export TRANSLATE_RT_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose up --build
```

Set `FRONTEND_PUBLIC_ORIGIN` in the frontend service environment when using a
public HTTPS origin. Compose binds the frontend to localhost only and does not
publish the API. The image runs non-root, supports an arbitrary non-root UID and
uses read-only roots with temporary files in `/tmp`. The image has no embedded
credentials. Set memory/CPU limits in your deployment and use TLS at ingress.
No Kubernetes manifest or claim of production homologation is supplied.

### Verification

```bash
python -m pip install --require-hashes -r requirements.lock -r api-translate-rt/requirements.lock
python -m pip install pytest httpx
python -m pytest -q api-translate-rt/tests
node --test tests/frontend.test.cjs
```

CI runs regression tests, basic Python lint, a dependency audit, Gitleaks and a
container build/Trivy scan. Enable the versioned local secret hook with
`pre-commit install` after installing pre-commit. Dependency lockfiles contain
hashes; refresh them deliberately with `uv pip compile --generate-hashes`.
The install scripts also consume these locks, while requirements.txt remains the
human-maintained constraint input.

The DSFR fixes are not a complete RGAA audit. The information sections in the UI
identify what the operator still needs to complete (editor, hosting, providers,
retention and rights contact); complete them before public use.
