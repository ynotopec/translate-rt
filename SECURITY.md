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
default (`CORS_ALLOW_ORIGINS` empty). Custom `CORS_ALLOW_ORIGIN_REGEX` is
supported with or without credentials; the operator is responsible for the
origins it authorizes. Invalid regex syntax is rejected at startup, as is
`CORS_ALLOW_ORIGINS=*` combined with `CORS_ALLOW_CREDENTIALS=true`.
Domain suffix entries such as `https://.example.com` remain supported.

TTS model and voice identifiers are validated for syntax and type without
restricting them to a local catalogue. The configured provider determines
available options and account permissions.
