"""Bound request memory and per-process demand before parsing or provider calls."""
import hmac
import os
import time
from collections import deque

from starlette.responses import JSONResponse


class RequestGuards:
    def __init__(self, app, token=''):
        self.app = app
        self.token = token
        self.max_bytes = int(os.getenv('MAX_REQUEST_BYTES', str(12 * 1024 * 1024)))
        self.max_active = int(os.getenv('MAX_CONCURRENT_REQUESTS', '32'))
        self.max_per_minute = int(os.getenv('MAX_REQUESTS_PER_MINUTE', '1200'))
        if min(self.max_bytes, self.max_active, self.max_per_minute) <= 0:
            raise ValueError('Request limits must be positive')
        self.active = 0
        self.arrivals = deque()

    async def reject(self, scope, receive, send, status, message):
        await JSONResponse({'detail': message}, status_code=status)(scope, receive, send)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] in {'/healthz', '/docs', '/redoc', '/openapi.json'}:
            return await self.app(scope, receive, send)
        headers = dict(scope['headers'])
        expected = f'Bearer {self.token}'.encode()
        if self.token and not hmac.compare_digest(headers.get(b'authorization', b''), expected):
            return await self.reject(scope, receive, send, 401, 'Jeton absent ou invalide')
        now = time.monotonic()
        while self.arrivals and self.arrivals[0] <= now - 60:
            self.arrivals.popleft()
        if self.active >= self.max_active or len(self.arrivals) >= self.max_per_minute:
            return await self.reject(scope, receive, send, 429, 'Trop de requêtes')
        self.arrivals.append(now)
        self.active += 1
        try:
            await self.bounded_request(scope, receive, send, headers)
        finally:
            self.active -= 1

    async def bounded_request(self, scope, receive, send, headers):
        try:
            declared = int(headers.get(b'content-length', b'0'))
        except ValueError:
            return await self.reject(scope, receive, send, 400, 'Taille invalide')
        if declared < 0 or declared > self.max_bytes:
            return await self.reject(scope, receive, send, 413, 'Requête trop volumineuse')
        chunks, total = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            total += len(chunk)
            if total > self.max_bytes:
                return await self.reject(scope, receive, send, 413, 'Requête trop volumineuse')
            chunks.append(chunk)
            if not message.get('more_body', False):
                break
        body = b''.join(chunks)
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': body, 'more_body': False}
            return await receive()

        await self.app(scope, replay, send)
