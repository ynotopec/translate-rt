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

Translation is bidirectional between the selected primary and destination
languages: speech in the primary language is translated to the destination,
and speech in the destination language is translated back to the primary.
Speech in a third or unidentified language uses the destination. Display and
TTS use the same translation; if it is missing, the original text is displayed.

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

The frontend is public by default (FRONTEND_AUTH_MODE=none), including browser
calls to /api/*. Basic authentication and managed SSO via proxy mode are optional.
Keep the backend credentials server-side and the raw upstream ports private.
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

## Production hardening (follow-up to the audit)

**Public access is the default:** FRONTEND_AUTH_MODE=none serves the frontend
and its /api/* proxy without a login. No frontend username or password is required.
The shared backend API token stays on the server. Size, concurrency/rate limits,
origin checks and security headers still apply. No new Python dependency is needed.

For an optional password-protected instance, select FRONTEND_AUTH_MODE=basic
and generate a hash interactively inside the installed virtual environment:

```bash
python -c 'import getpass,shlex; from werkzeug.security import generate_password_hash; print("FRONTEND_AUTH_PASSWORD_HASH=" + shlex.quote(generate_password_hash(getpass.getpass("Password: "))))'
```

Only for Basic mode, copy the output into the frontend `.env` (preserve the quotes)
and set FRONTEND_AUTH_USER. Without those credentials, explicitly selected Basic
mode returns 503. The public configuration is:

```dotenv
FRONTEND_AUTH_MODE=none
FRONTEND_PUBLIC_ORIGIN=https://app.example.com
TRANSLATE_RT_API_BASE=https://api-app.example.com
```

Use the same `TRANSLATE_RT_API_TOKEN` in Flask and FastAPI. The browser calls
`app.example.com/api/*`; Flask calls `api-app.example.com` server-side. The
external frontend origin must be set explicitly when TLS is terminated upstream.
Compose now forwards that variable, including authentication settings, into Flask.
A blank origin falls back to the directly observed request origin; forwarded
headers are not trusted automatically. A 403 origin error describes which setting
to check. Restart/recreate services after changing their environment.

If SSO is desired, protect the entire frontend at the reverse proxy, set
`FRONTEND_AUTH_MODE=proxy` and ensure no direct path bypasses SSO. Public mode
intentionally lets visitors use transcription and TTS through Flask while keeping
the backend token out of the browser. Use the supplied Nginx/API limits to bound demand.

`run.sh` now launches Gunicorn and binds `127.0.0.1` by default. Explicit IP/port
arguments still work; use `0.0.0.0` only on an isolated container/private interface.
See `deploy/translate-rt.service` for a systemd example. Provision the service
user and virtual environment first; do not depend on auto-installation at boot.

`deploy/nginx.conf` is a standalone example, not an auto-applied configuration.
Adapt both hostnames, the upstream ports and TLS certificate paths; certificates
must cover both names. If your existing Nginx terminates TLS, merge only the relevant
server/location settings. Validate with `nginx -t` before reloading. It provides:

- HTTP to HTTPS **308** (preserves POST methods), HSTS without includeSubDomains;
- per-IP request/connection limits and read/header/body timeouts;
- hidden upstream Server banner and no Nginx version number (`Server: nginx` remains);
- no request bodies, query strings or Authorization headers in access logs.

Do not change the whole domain's HSTS scope or enable preload without checking
other services. When another load balancer precedes Nginx, configure trusted real-IP
sources explicitly before relying on per-IP limits. Do not accept arbitrary
X-Forwarded-For values from public clients. Keep API 8080 private even if its public
subdomain is retained; enable the shared token for direct clients.

Flask now emits security headers on successful and error responses, including a
CSP with a fresh nonce for each HTML response, frame-ancestors none, nosniff,
no-referrer, microphone restricted to self, COOP and CORP. CSP allows only the
pinned DSFR CDN path for scripts/styles/fonts, same-origin fetch and blob audio.
Inline script execution requires a nonce; inline styles remain allowed for the
existing DSFR/dynamic UI. Dynamic responses are no-store. HSTS is emitted for
HTTPS or an explicitly configured HTTPS public origin; the redirect itself belongs
to Nginx. Backend direct documentation is separate from the frontend CSP.

Configure the real disclosure contact and expiration described in SECURITY.md to
publish security.txt; no owner contact is fabricated. The PWA display mode is
unchanged. Copying language options uses cloned DOM nodes instead of innerHTML.
These controls do not constitute an RGAA audit or a production homologation.
