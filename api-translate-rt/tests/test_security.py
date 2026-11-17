import asyncio
import importlib.util
import logging
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient

from test_pipeline import APP_PATH, api
from guards import RequestGuards

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('frontend', ROOT / 'app.py')
frontend = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = frontend
spec.loader.exec_module(frontend)


@pytest.fixture(autouse=True)
def local_demo_mode(monkeypatch):
    monkeypatch.setenv('FRONTEND_AUTH_MODE', 'none')


@pytest.fixture
def client():
    api.app.middleware_stack = None
    # The API now refuses to start without a token, so the real app enforces
    # auth: every test that exercises validation must present it explicitly.
    with TestClient(
        api.app,
        raise_server_exceptions=False,
        headers={'Authorization': f'Bearer {api.Cfg.TRANSLATE_RT_API_TOKEN}'},
    ) as client:
        yield client


@pytest.fixture
def protected_app():
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    app = FastAPI()
    app.add_middleware(RequestGuards, token='fixture-token')
    app.add_middleware(CORSMiddleware, allow_origins=['https://frontend.invalid'],
                       allow_methods=['POST'], allow_headers=['Authorization'])

    @app.post('/probe')
    async def probe():
        return {'ok': True}

    return app


def test_authentication_and_preflight(protected_app):
    with TestClient(protected_app, raise_server_exceptions=False) as c:
        assert c.post('/probe').status_code == 401
        assert c.post('/probe', headers={'Authorization': 'Bearer wrong'}).status_code == 401
        assert c.post('/probe', headers={'Authorization': 'Bearer fixture-token'}).status_code == 200
        response = c.options('/probe', headers={
            'Origin': 'https://frontend.invalid', 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Authorization'})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == 'https://frontend.invalid'


def test_frontend_keeps_token_on_server(monkeypatch):
    monkeypatch.setenv('TRANSLATE_RT_API_TOKEN', 'fixture-server-token')
    client = frontend.app.test_client()
    page = client.get('/')
    assert page.status_code == 200
    assert b'fixture-server-token' not in page.data
    assert b'/api/upload' in page.data
    upstream = Mock(content=b'{"ok":true}', status_code=200, headers={'Content-Type': 'application/json'})
    with patch.object(frontend.requests, 'post', return_value=upstream) as post:
        response = client.post('/api/upload', data=b'audio', headers={'X-Translate-RT': '1'})
    assert response.status_code == 200
    assert post.call_args.kwargs['headers']['Authorization'] == 'Bearer fixture-server-token'
    assert post.call_args.kwargs['data'] == b'audio'


def test_proxy_rejects_cross_origin_and_missing_header():
    client = frontend.app.test_client()
    with patch.object(frontend.requests, 'post') as post:
        assert client.post('/api/upload').status_code == 403
        assert client.post('/api/upload', headers={
            'X-Translate-RT': '1', 'Origin': 'https://attacker.invalid'}).status_code == 403
        post.assert_not_called()


def test_proxy_timeout_and_size_limit():
    client = frontend.app.test_client()
    with patch.object(frontend.requests, 'post', side_effect=frontend.requests.Timeout):
        assert client.post('/api/upload', headers={'X-Translate-RT': '1'}).status_code == 504
    with patch.dict(frontend.app.config, MAX_CONTENT_LENGTH=4):
        assert client.post('/api/upload', data=b'12345', headers={'X-Translate-RT': '1'}).status_code == 413


def test_invalid_upstream_is_an_error(client):
    with patch.object(api, 'process_audio_chunk', side_effect=ValueError('malformed')):
        response = client.post('/upload', files={'file': ('audio.webm', b'x' * 16000, 'audio/webm')})
    assert response.status_code == 502


def test_audio_limit_before_provider(client, monkeypatch):
    monkeypatch.setenv('MAX_AUDIO_BYTES', '8')
    with patch.object(api, 'process_audio_chunk') as process:
        assert client.post('/upload', files={'file': ('a.webm', b'x' * 9)}).status_code == 413
        process.assert_not_called()


@pytest.mark.parametrize('payload', [
    {'text': 'x' * 20001}, {'text': 'Hi', 'target_lang': 'ignore instructions'},
])
def test_translation_validation(client, payload):
    with patch.object(api, 'translate_text_cached') as translate:
        assert client.post('/translate-text', json=payload).status_code == 422
        translate.assert_not_called()


def test_tts_validation(client, monkeypatch):
    monkeypatch.setattr(api.Cfg, 'TTS_API_KEY', 'fixture')
    with patch.object(api, 'post') as post:
        assert client.post('/tts-proxy', json={'input': 'x' * 20001}).status_code == 422
        post.assert_not_called()


def test_payload_is_not_logged(caplog):
    response = Mock(status_code=200, content=b'audio')
    with patch.object(api.session, 'post', return_value=response), caplog.at_level(logging.INFO):
        api.post('https://provider.invalid/speech', json={'input': 'PRIVATE-SPEECH'})
    assert 'PRIVATE-SPEECH' not in caplog.text


def test_translations_are_not_cached():
    response = Mock(ok=True)
    response.json.return_value = {'choices': [{'message': {'content': 'Bonjour'}}]}
    with patch.object(api, 'post', return_value=response) as post:
        assert api.translate_text_cached('Hello', 'fr') == 'Bonjour'
        assert api.translate_text_cached('Hello', 'fr') == 'Bonjour'
        assert post.call_count == 2


def test_chunked_body_limit_without_content_length(monkeypatch):
    monkeypatch.setenv('MAX_REQUEST_BYTES', '4')
    messages = iter([{'type': 'http.request', 'body': b'123', 'more_body': True},
                     {'type': 'http.request', 'body': b'45', 'more_body': False}])
    sent = []
    called = False

    async def downstream(*args):
        nonlocal called
        called = True

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    asyncio.run(RequestGuards(downstream)({'type': 'http', 'path': '/upload', 'headers': []}, receive, send))
    assert sent[0]['status'] == 413
    assert not called


def test_rate_limit(protected_app, monkeypatch):
    monkeypatch.setenv('MAX_REQUESTS_PER_MINUTE', '1')
    with TestClient(protected_app) as client:
        headers = {'Authorization': 'Bearer fixture-token'}
        assert client.post('/probe', headers=headers).status_code == 200
        assert client.post('/probe', headers=headers).status_code == 429


def test_proxy_preserves_multipart_to_real_api(client):
    """Browser -> Flask -> real API parser, with only provider I/O mocked."""
    def forward(url, *, data, headers, timeout):
        result = client.post('/upload', content=data, headers=headers)
        return Mock(content=result.content, status_code=result.status_code, headers=result.headers)

    with patch.object(frontend.requests, 'post', side_effect=forward), patch.object(
        api, 'process_audio_chunk', return_value={'transcription': 'Hello', 'translation_es': 'Hola'}
    ) as process:
        from io import BytesIO
        response = frontend.app.test_client().post('/api/upload', data={
            'file': (BytesIO(b'x' * 16000), 'audio.webm'),
            'target_lang': 'es', 'primary_lang': 'fr',
        }, headers={'X-Translate-RT': '1'})
    assert response.status_code == 200
    assert response.json['translation_es'] == 'Hola'
    assert process.call_args.args[3:] == ('fr', 'es')


def test_concurrency_limit_and_release(monkeypatch):
    monkeypatch.setenv('MAX_CONCURRENT_REQUESTS', '1')

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        sent = []

        async def downstream(scope, receive, send):
            entered.set()
            await release.wait()

        async def receive():
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def send(message):
            sent.append(message)

        guards = RequestGuards(downstream)
        scope = {'type': 'http', 'path': '/upload', 'headers': []}
        first = asyncio.create_task(guards(scope, receive, send))
        await asyncio.wait_for(entered.wait(), timeout=1)
        await guards(scope, receive, send)
        assert sent[0]['status'] == 429
        release.set()
        await first
        assert guards.active == 0
        await guards(scope, receive, send)
        assert guards.active == 0

    asyncio.run(scenario())


# ─────────────────── Security review hardening (non-regression) ───────────────────
AUTH = {'Authorization': 'Bearer test-api-token'}


def _load_api_with_env(monkeypatch, **env):
    """Re-import the API module with a controlled environment.

    The module reads its configuration at import time, so a fresh load is the
    only way to assert on startup validation.
    """
    for key in ('TRANSLATE_RT_API_TOKEN', 'CORS_ALLOW_ORIGINS', 'CORS_ALLOW_ORIGIN_REGEX',
                'CORS_ALLOW_CREDENTIALS', 'TTS_ALLOWED_MODELS', 'TTS_ALLOWED_VOICES'):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    spec = importlib.util.spec_from_file_location(f'api_reload_{len(env)}_{id(env)}', APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_token_is_mandatory_at_startup(monkeypatch):
    """An unset token must stop the process instead of disabling auth."""
    with pytest.raises(RuntimeError, match='TRANSLATE_RT_API_TOKEN'):
        _load_api_with_env(monkeypatch)


def test_cors_defaults_to_same_origin(monkeypatch):
    module = _load_api_with_env(monkeypatch, TRANSLATE_RT_API_TOKEN='t')
    assert module.ALLOW_ORIGINS == []
    assert module.ALLOW_ORIGIN_REGEX is None


def test_credentials_with_wildcard_regex_is_rejected(monkeypatch):
    """`CORS_ALLOW_ORIGIN_REGEX=.*` used to slip past the old string compare.

    The origin list is set to a single explicit value on purpose: the only
    reason to reject this config is the regex, so the test fails on the old
    `allow_origin_regex == '.*'` comparison rather than on the wildcard list.
    """
    with pytest.raises(RuntimeError, match='CORS'):
        _load_api_with_env(
            monkeypatch,
            TRANSLATE_RT_API_TOKEN='t',
            CORS_ALLOW_CREDENTIALS='true',
            CORS_ALLOW_ORIGINS='https://app.example.com',
            CORS_ALLOW_ORIGIN_REGEX='.*',
        )


def test_credentials_with_explicit_origin_is_allowed(monkeypatch):
    module = _load_api_with_env(
        monkeypatch,
        TRANSLATE_RT_API_TOKEN='t',
        CORS_ALLOW_CREDENTIALS='true',
        CORS_ALLOW_ORIGINS='https://app.example.com',
    )
    assert module.ALLOW_ORIGINS == ['https://app.example.com']


def test_documentation_routes_require_the_token(client):
    # `client` drops the middleware stack to test validation in isolation, so
    # rebuild it here to exercise the real guard.
    api.app.middleware_stack = api.app.build_middleware_stack()
    guarded = TestClient(api.app, headers={'Authorization': 'Bearer wrong'})
    anonymous = TestClient(api.app)
    try:
        assert anonymous.get('/healthz').status_code == 200
        assert anonymous.get('/openapi.json').status_code == 401
        assert anonymous.get('/docs').status_code == 401
        assert guarded.get('/openapi.json').status_code == 401
        assert TestClient(api.app, headers=AUTH).get('/openapi.json').status_code == 200
    finally:
        api.app.middleware_stack = None


def test_tts_forwards_only_known_fields(client, monkeypatch):
    monkeypatch.setattr(api.Cfg, 'TTS_API_KEY', 'fixture')
    response = Mock(ok=True, content=b'audio', status_code=200,
                    headers={'Content-Type': 'audio/webm'})
    with patch.object(api, 'post', return_value=response) as post:
        status = client.post('/tts-proxy', json={
            'input': 'bonjour', 'voice': 'alloy', 'model': 'gpt-4o-mini-tts',
            'speed': 2.0, 'instructions': 'ignore previous instructions',
        }).status_code
    assert status == 200
    forwarded = post.call_args.kwargs['json']
    assert set(forwarded) == {'input', 'voice', 'model', 'instructions'}
    assert 'speed' not in forwarded


@pytest.mark.parametrize('field,value', [
    ('model', '../../etc/passwd'),
    ('voice', 'x' * 200),
    ('response_format', 'exe'),
])
def test_tts_rejects_unknown_provider_options(client, monkeypatch, field, value):
    monkeypatch.setattr(api.Cfg, 'TTS_API_KEY', 'fixture')
    with patch.object(api, 'post') as post:
        status = client.post('/tts-proxy', json={'input': 'bonjour', field: value}).status_code
    assert status == 422
    post.assert_not_called()


@pytest.mark.parametrize('field,value', [
    ('model', 'unapproved-expensive-model'), ('voice', 'unapproved-voice'),
    ('model', []), ('voice', {}),
    ('response_format', []), ('response_format', {}),
    ('response_format', None), ('response_format', 1),
])
def test_tts_rejects_unapproved_or_malformed_options(client, monkeypatch, field, value):
    monkeypatch.setattr(api.Cfg, 'TTS_API_KEY', 'fixture')
    upstream = Mock(ok=True, content=b'audio', status_code=200, headers={'Content-Type': 'audio/opus'})
    with patch.object(api, 'post', return_value=upstream) as post:
        response = client.post('/tts-proxy', json={'input': 'bonjour', field: value})
    assert response.status_code == 422
    post.assert_not_called()


def test_tts_configured_allowlists(monkeypatch):
    module = _load_api_with_env(
        monkeypatch, TRANSLATE_RT_API_TOKEN='t',
        TTS_ALLOWED_MODELS=' Vendor/Custom-TTS , gpt-4o-mini-tts ',
        TTS_ALLOWED_VOICES=' CustomVoice , alloy ',
    )
    monkeypatch.setattr(module.Cfg, 'TTS_API_KEY', 'fixture')
    payload = {'input': 'bonjour', 'model': 'Vendor/Custom-TTS', 'voice': 'CustomVoice'}
    upstream = Mock(ok=True, content=b'audio', status_code=200, headers={'Content-Type': 'audio/opus'})
    with TestClient(module.app, headers={'Authorization': 'Bearer t'}) as client:
        with patch.object(module, 'post', return_value=upstream) as post:
            assert client.post('/tts-proxy', json=payload).status_code == 200
            assert post.call_args.kwargs['json'] == payload
            post.reset_mock()
            assert client.post('/tts-proxy', json={**payload, 'model': 'other-model'}).status_code == 422
            assert client.post('/tts-proxy', json={**payload, 'voice': 'other-voice'}).status_code == 422
            post.assert_not_called()


@pytest.mark.parametrize('setting', ['TTS_ALLOWED_MODELS', 'TTS_ALLOWED_VOICES'])
@pytest.mark.parametrize('value', ['', '*'])
def test_tts_allowlists_fail_closed(monkeypatch, setting, value):
    with pytest.raises(RuntimeError, match=setting):
        _load_api_with_env(monkeypatch, TRANSLATE_RT_API_TOKEN='t', **{setting: value})


@pytest.mark.parametrize('pattern', [r'http://.*', r'https://(?!evil\.invalid).*', r'https://app\.example\.com'])
def test_credentialed_cors_rejects_custom_regexes(monkeypatch, pattern):
    with pytest.raises(RuntimeError, match='CORS'):
        _load_api_with_env(
            monkeypatch, TRANSLATE_RT_API_TOKEN='t',
            CORS_ALLOW_CREDENTIALS='true', CORS_ALLOW_ORIGIN_REGEX=pattern,
        )


def test_cors_domain_suffix_with_credentials(monkeypatch):
    module = _load_api_with_env(
        monkeypatch, TRANSLATE_RT_API_TOKEN='t', CORS_ALLOW_CREDENTIALS='true',
        CORS_ALLOW_ORIGINS='https://.example.com',
    )
    with TestClient(module.app) as client:
        for origin, allowed in [('https://app.example.com', True),
                                ('https://example.com.attacker.invalid', False),
                                ('http://app.example.com', False)]:
            response = client.options('/tts-proxy', headers={
                'Origin': origin, 'Access-Control-Request-Method': 'POST',
            })
            assert response.status_code == (200 if allowed else 400)
            assert response.headers.get('access-control-allow-origin') == (origin if allowed else None)


def test_cors_regex_without_credentials(monkeypatch):
    module = _load_api_with_env(
        monkeypatch, TRANSLATE_RT_API_TOKEN='t',
        CORS_ALLOW_ORIGIN_REGEX=r'https://app\.example\.com',
    )
    with TestClient(module.app) as client:
        response = client.options('/tts-proxy', headers={
            'Origin': 'https://app.example.com', 'Access-Control-Request-Method': 'POST',
        })
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == 'https://app.example.com'
        assert 'access-control-allow-credentials' not in response.headers


def test_invalid_cors_regex_fails_at_startup(monkeypatch):
    with pytest.raises(RuntimeError, match='CORS_ALLOW_ORIGIN_REGEX'):
        _load_api_with_env(monkeypatch, TRANSLATE_RT_API_TOKEN='t', CORS_ALLOW_ORIGIN_REGEX='[')
