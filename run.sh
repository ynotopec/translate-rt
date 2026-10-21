#!/usr/bin/env bash
set -Eeuo pipefail

serverAddress="${1:-${SERVER_NAME:-}}"
portNumber="${2:-${SERVER_PORT:-}}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "${ROOT_DIR}")"
VENV_DIR="${VENV_DIR:-${HOME}/venv/${PROJECT_NAME}}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

cd "${ROOT_DIR}"

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  ./install.sh
fi

# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -n "${serverAddress}" ]]; then
  export SERVER_NAME="${serverAddress}"
fi
if [[ -n "${portNumber}" ]]; then
  export SERVER_PORT="${portNumber}"
fi

export HF_HUB_DISABLE_TELEMETRY="${HF_HUB_DISABLE_TELEMETRY:-1}"
export SERVER_NAME="${SERVER_NAME:-127.0.0.1}"
export SERVER_PORT="${SERVER_PORT:-5000}"

args=(--bind "${SERVER_NAME}:${SERVER_PORT}" --workers "${GUNICORN_WORKERS:-2}" --threads "${GUNICORN_THREADS:-4}" --timeout "${GUNICORN_TIMEOUT:-180}" app:app)
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  "${VENV_DIR}/bin/gunicorn" "${args[@]}"
else
  exec "${VENV_DIR}/bin/gunicorn" "${args[@]}"
fi
