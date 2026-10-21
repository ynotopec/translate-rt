import base64
import re
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import pytest
from werkzeug.security import generate_password_hash

from test_security import frontend


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    for name in ['FRONTEND_AUTH_MODE', 'FRONTEND_AUTH_USER', 'FRONTEND_AUTH_PASSWORD_HASH',
                 'FRONTEND_PUBLIC_ORIGIN', 'SECURITY_CONTACT', 'SECURITY_EXPIRES']:
        monkeypatch.delenv(name, raising=False)


def credentials(password='fixture-password'):
    return {'Authorization': 'Basic ' + base64.b64encode(f'test-user:{password}'.encode()).decode()}


def test_basic_auth_fails_closed_without_configuration(monkeypatch):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', 'basic')
    client = frontend.app.test_client()
    for path in ['/', '/api/upload', '/static/js/code.js']:
        assert client.open(path, method='POST' if path.startswith('/api/') else 'GET').status_code == 503


def test_authentication_on_frontend_and_proxy(monkeypatch):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', 'basic')
    monkeypatch.setenv('FRONTEND_AUTH_USER', 'test-user')
    monkeypatch.setenv('FRONTEND_AUTH_PASSWORD_HASH', generate_password_hash('fixture-password'))
    client = frontend.app.test_client()
    assert client.get('/').status_code == 401
    assert client.get('/', headers=credentials('wrong')).status_code == 401
    assert client.get('/', headers=credentials()).status_code == 200
    with patch.object(frontend.requests, 'post', return_value=Mock(
        content=b'{}', status_code=200, headers={'Content-Type': 'application/json'})
    ) as post:
        assert client.post('/api/upload', headers={'X-Translate-RT': '1'}).status_code == 401
        post.assert_not_called()
        headers = credentials() | {'X-Translate-RT': '1'}
        assert client.post('/api/upload', headers=headers).status_code == 200
        assert 'Basic' not in post.call_args.kwargs['headers'].get('Authorization', '')


@pytest.mark.parametrize('mode', ['proxy', 'none'])
def test_explicit_auth_modes(monkeypatch, mode):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', mode)
    assert frontend.app.test_client().get('/').status_code == 200


def test_csp_nonces_and_error_headers(monkeypatch):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', 'none')
    client = frontend.app.test_client()
    responses = [client.get('/'), client.get('/')]
    nonces = []
    for response in responses:
        nonce = re.search(r"'nonce-([^']+)'", response.headers['Content-Security-Policy']).group(1)
        nonces.append(nonce)
        inline = re.findall(r'<script([^>]*)>([\s\S]*?)</script>', response.text)
        for attrs, text in inline:
            if text.strip():
                assert f'nonce="{nonce}"' in attrs
        assert response.headers['Cache-Control'] == 'no-store'
    assert nonces[0] != nonces[1]
    assert "'unsafe-inline'" not in responses[0].headers['Content-Security-Policy'].split('script-src ')[1].split(';')[0]
    for response in [responses[0], client.get('/missing'), client.post('/api/upload')]:
        assert response.headers['X-Frame-Options'] == 'DENY'
        assert response.headers['X-Content-Type-Options'] == 'nosniff'
        assert response.headers['Permissions-Policy'].startswith('microphone=(self)')


def test_https_public_origin_behind_http_proxy(monkeypatch):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', 'none')
    monkeypatch.setenv('FRONTEND_PUBLIC_ORIGIN', 'https://app.example.com')
    monkeypatch.setenv('TRANSLATE_RT_API_BASE', 'https://api-app.example.com')
    client = frontend.app.test_client()
    with patch.object(frontend.requests, 'post', return_value=Mock(content=b'{}', status_code=200, headers={})) as post:
        response = client.post('/api/upload', base_url='http://internal:5000', headers={
            'Origin': 'https://app.example.com', 'X-Translate-RT': '1'})
        assert response.status_code == 200
        assert post.call_args.args[0] == 'https://api-app.example.com/upload'
        assert response.headers['Strict-Transport-Security'] == 'max-age=31536000'
        assert client.post('/api/upload', headers={
            'Origin': 'https://attacker.example.com', 'X-Translate-RT': '1'}).status_code == 403


def test_blank_origin_and_untrusted_forwarded_headers(monkeypatch):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', 'none')
    monkeypatch.setenv('FRONTEND_PUBLIC_ORIGIN', '')
    client = frontend.app.test_client()
    with patch.object(frontend.requests, 'post', return_value=Mock(content=b'{}', status_code=200, headers={})):
        assert client.post('/api/upload', base_url='http://localhost', headers={
            'Origin': 'http://localhost', 'X-Translate-RT': '1'}).status_code == 200
    assert 'Strict-Transport-Security' not in client.get('/', headers={'X-Forwarded-Proto': 'https'}).headers


def test_security_txt_needs_real_contact_and_valid_expiry(monkeypatch):
    client = frontend.app.test_client()
    assert client.get('/.well-known/security.txt').status_code == 404
    monkeypatch.setenv('SECURITY_CONTACT', 'mailto:security@example.invalid')
    assert client.get('/.well-known/security.txt').status_code == 503
    expiry = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
    monkeypatch.setenv('SECURITY_EXPIRES', expiry)
    response = client.get('/.well-known/security.txt')
    assert response.status_code == 200  # Public even when frontend Basic is unconfigured.
    assert response.mimetype == 'text/plain'
    assert f'Expires: {expiry}' in response.text
    monkeypatch.setenv('SECURITY_EXPIRES', '2020-01-01T00:00:00Z')
    assert client.get('/.well-known/security.txt').status_code == 503


def test_public_default_allows_frontend_and_proxy_without_login(monkeypatch):
    monkeypatch.setenv('TRANSLATE_RT_API_TOKEN', 'fixture-backend-token')
    client = frontend.app.test_client()
    for path in ['/', '/static/js/code.js']:
        response = client.get(path)
        assert response.status_code == 200
        assert 'WWW-Authenticate' not in response.headers
        assert 'fixture-backend-token' not in response.text
    with patch.object(frontend.requests, 'post', return_value=Mock(
        content=b'{}', status_code=200, headers={'Content-Type': 'application/json'})
    ) as post:
        for path in ['/api/upload', '/api/tts-proxy']:
            response = client.post(path, headers={'X-Translate-RT': '1'})
            assert response.status_code == 200
            assert 'WWW-Authenticate' not in response.headers
            assert post.call_args.kwargs['headers']['Authorization'] == 'Bearer fixture-backend-token'
        post.reset_mock()
        assert client.post('/api/upload').status_code == 403
        assert client.post('/api/upload', headers={
            'X-Translate-RT': '1', 'Origin': 'https://attacker.example.com'}).status_code == 403
        post.assert_not_called()
