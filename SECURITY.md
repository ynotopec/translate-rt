# Security reporting and deployment

Do not publish credentials, recordings or confidential vulnerability details in a
public issue. This repository does not invent a private reporting address.
The instance operator must set SECURITY_CONTACT to an actual monitored HTTPS
reporting URL or mailto address, and SECURITY_EXPIRES to a future RFC 3339 timestamp
no more than one year away. Only then does /.well-known/security.txt publish a
Contact and Expires field. An unset contact returns 404; an invalid/expired
configured expiry returns 503, rather than presenting a misleading disclosure policy.

Review deployment instructions in README.md. The frontend defaults to public access
(FRONTEND_AUTH_MODE=none), including browser calls to /api/*. Backend credentials
stay on the server; request/connection limits also apply to anonymous traffic.
FRONTEND_AUTH_MODE=basic optionally restricts access with a password, while
FRONTEND_AUTH_MODE=proxy delegates it to an authenticated reverse proxy.
When enabled, Basic auth must be served over HTTPS. Keep raw Flask/FastAPI ports private and
restrict access to them with firewall/container networking rules.

`TRANSLATE_RT_API_TOKEN` is mandatory: the API exits at startup when it is unset,
because an empty token used to disable authentication and expose every
provider-backed route as an open relay. Only `/healthz` stays public;
`/docs`, `/redoc` and `/openapi.json` require the token. CORS is same-origin by
default (`CORS_ALLOW_ORIGINS` empty). With `CORS_ALLOW_CREDENTIALS=true`, wildcard
origins and custom `CORS_ALLOW_ORIGIN_REGEX` are rejected at startup. Use explicit
`CORS_ALLOW_ORIGINS`; domain suffix entries such as `https://.example.com` remain
supported through escaped, server-generated patterns. Invalid regex syntax is
rejected at startup even without credentials.

TTS models and voices are matched exactly against `TTS_ALLOWED_MODELS` and
`TTS_ALLOWED_VOICES` (comma-separated, defaults `gpt-4o-mini-tts` and `alloy`).
Empty lists and wildcard entries are rejected at startup. Configure additional
values only when they are approved for the provider account.
