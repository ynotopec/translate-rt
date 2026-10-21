"""Frontend access control and browser policies, using Flask's existing dependencies."""
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from flask import Response, g, jsonify, request
from werkzeug.security import check_password_hash


def configure_security(app):
    app.before_request(authorize_request)
    app.after_request(security_headers)
    app.add_url_rule('/.well-known/security.txt', 'security_txt', security_txt)


def authorize_request():
    g.csp_nonce = secrets.token_urlsafe(24)
    if request.path == '/.well-known/security.txt':
        return None
    mode = os.getenv('FRONTEND_AUTH_MODE', 'none').strip().lower()
    if mode in {'proxy', 'none'}:
        # proxy requires an independently authenticated, private upstream.
        # none intentionally provides public access to the frontend and proxy.
        return None
    if mode != 'basic':
        return jsonify(detail='FRONTEND_AUTH_MODE invalide'), 503
    username = os.getenv('FRONTEND_AUTH_USER', '').strip()
    password_hash = os.getenv('FRONTEND_AUTH_PASSWORD_HASH', '').strip()
    if not username or not password_hash:
        return jsonify(detail='Configurer FRONTEND_AUTH_USER et FRONTEND_AUTH_PASSWORD_HASH'), 503
    auth = request.authorization
    if auth and auth.type.lower() == 'basic' and auth.username is not None and auth.password is not None:
        valid_user = hmac.compare_digest(auth.username.encode(), username.encode())
        try:
            valid_password = check_password_hash(password_hash, auth.password)
        except (ValueError, TypeError):
            return jsonify(detail='FRONTEND_AUTH_PASSWORD_HASH invalide'), 503
        if valid_user and valid_password:
            return None
    return Response('Authentification requise', status=401, headers={
        'WWW-Authenticate': 'Basic realm="translate-rt", charset="UTF-8"',
    })


def security_headers(response):
    nonce = g.get('csp_nonce', '')
    response.headers.update({
        'Content-Security-Policy': (
            "default-src 'self'; "
            f"script-src 'self' https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.11.2/ 'nonce-{nonce}'; "
            "script-src-attr 'none'; style-src 'self' https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.11.2/ 'unsafe-inline'; "
            "font-src 'self' https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.11.2/; "
            "img-src 'self' https://cdn.jsdelivr.net/npm/@gouvfr/dsfr@1.11.2/ data:; "
            "connect-src 'self'; media-src 'self' blob:; worker-src 'self'; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
        ),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin',
    })
    # HTTPS is terminated by the configured ingress; never trust arbitrary
    # X-Forwarded-Proto from a public client or enable includeSubDomains here.
    public_origin = os.getenv('FRONTEND_PUBLIC_ORIGIN', '').strip()
    if request.is_secure or urlsplit(public_origin).scheme == 'https':
        response.headers['Strict-Transport-Security'] = 'max-age=31536000'
    if request.endpoint != 'static':
        response.headers['Cache-Control'] = 'no-store'
    return response


def security_txt():
    contact = os.getenv('SECURITY_CONTACT', '').strip()
    expires = os.getenv('SECURITY_EXPIRES', '').strip()
    parsed = urlsplit(contact)
    if '\n' in contact or '\r' in contact or parsed.scheme not in {'mailto', 'https'}:
        return Response('Contact de sécurité non configuré', status=404)
    if (parsed.scheme == 'https' and (not parsed.netloc or parsed.username or parsed.password)) or (
        parsed.scheme == 'mailto' and '@' not in parsed.path
    ):
        return Response('Contact de sécurité non configuré', status=404)
    try:
        expiry = datetime.fromisoformat(expires.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        if expiry.tzinfo is None or not now < expiry <= now + timedelta(days=365):
            raise ValueError('Invalid expiry')
    except ValueError:
        return Response('Expiration security.txt non configurée ou invalide', status=503)
    return Response(f'Contact: {contact}\nExpires: {expires}\nPreferred-Languages: fr, en\n',
                    content_type='text/plain; charset=utf-8')
