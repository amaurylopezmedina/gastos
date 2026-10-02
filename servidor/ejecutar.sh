#!/bin/sh
# Arranca la API solo en 127.0.0.1. Lee ~/finanzas/config.env si existe (ACCESS_TEAM, ACCESS_AUD).
cd "$(dirname "$0")"
[ -f "$HOME/finanzas/config.env" ] && set -a && . "$HOME/finanzas/config.env" && set +a
exec "$HOME/finanzas/venv/bin/uvicorn" app:app --host 127.0.0.1 --port "${PUERTO:-8420}"
