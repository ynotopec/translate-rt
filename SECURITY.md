# Security reporting and deployment

Do not publish credentials, recordings or confidential vulnerability details in a
public issue. This repository does not invent a private reporting address.
The instance operator must set SECURITY_CONTACT to an actual monitored HTTPS
reporting URL or mailto address, and SECURITY_EXPIRES to a future RFC 3339 timestamp
no more than one year away. Only then does /.well-known/security.txt publish a
Contact and Expires field. An unset contact returns 404; an invalid/expired
configured expiry returns 503, rather than presenting a misleading disclosure policy.

Review deployment instructions in README.md. The frontend defaults to Basic auth;
FRONTEND_AUTH_MODE=proxy delegates authentication to an independently protected
reverse proxy. FRONTEND_AUTH_MODE=none is reserved for explicit local demos.
Basic auth must be served over HTTPS. Keep raw Flask/FastAPI ports private and
restrict access to them with firewall/container networking rules.
