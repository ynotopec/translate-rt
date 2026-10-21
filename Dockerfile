FROM python:3.12-slim AS build
WORKDIR /build
COPY requirements.lock ./frontend.lock
COPY api-translate-rt/requirements.lock ./api.lock
RUN python -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir --require-hashes -r frontend.lock -r api.lock

FROM python:3.12-slim
ENV PATH="/opt/venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY app.py frontend_security.py ./
COPY static ./static
COPY api-translate-rt/app.py api-translate-rt/guards.py ./api-translate-rt/
RUN chown -R 10001:0 /app && chmod -R g=u /app
USER 10001
EXPOSE 5000 8080
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--threads", "4", "--timeout", "120", "--access-logfile", "-", "--access-logformat", "%(m)s %(U)s %(s)s %(L)s", "app:app"]
