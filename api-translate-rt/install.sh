#!/usr/bin/env bash
set -Eeuo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "${DIR}")"
VENV_DIR="${VENV_DIR:-${HOME}/venv/${PROJECT_NAME}}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

cd "${DIR}"

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv with ${PYTHON_BIN}..."
  "${PYTHON_BIN}" -m pip install --user --upgrade uv
fi
UV_BIN="$(command -v uv || true)"
if [[ -z "${UV_BIN}" && -x "${HOME}/.local/bin/uv" ]]; then
  UV_BIN="${HOME}/.local/bin/uv"
fi
if [[ -z "${UV_BIN}" ]]; then
  echo "uv was installed but is not on PATH. Add ${HOME}/.local/bin to PATH." >&2
  exit 1
fi

"${UV_BIN}" venv --python "${PYTHON_BIN}" "${VENV_DIR}"
"${UV_BIN}" pip install --python "${VENV_DIR}/bin/python" --upgrade pip wheel
"${UV_BIN}" pip install --python "${VENV_DIR}/bin/python" -r requirements.txt

echo "Installed ${PROJECT_NAME} into ${VENV_DIR}"
