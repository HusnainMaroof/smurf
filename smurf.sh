#!/usr/bin/env bash
# Smurf launcher (Git Bash on Windows, or any bash).
#   ./smurf.sh setup     create .env with a random SMURF_TOKEN (once)
#   ./smurf.sh up        build and start smurf-server in Docker (127.0.0.1:47821)
#   ./smurf.sh runner    start the host runner (agents, worktrees, checks) in this terminal
#   ./smurf.sh status    container + runner health
#   ./smurf.sh down      stop the container (data volume is kept)
#   ./smurf.sh token     print the token (the desktop app asks for it once)
set -euo pipefail
cd "$(dirname "$0")"

env_token() { [ -f .env ] && sed -n 's/^SMURF_TOKEN=//p' .env | head -1; }

case "${1:-}" in
  setup)
    if [ -n "$(env_token)" ]; then echo ".env already has SMURF_TOKEN"; exit 0; fi
    printf 'SMURF_TOKEN=%s\n' "$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" >> .env
    echo "wrote .env (keep it private)"
    ;;
  up)
    [ -n "$(env_token)" ] || "$0" setup
    docker compose up -d --build
    ;;
  runner)
    SMURF_TOKEN="$(env_token)"
    [ -n "$SMURF_TOKEN" ] || { echo "no token: ./smurf.sh setup"; exit 1; }
    export SMURF_TOKEN
    cd orchestrator && exec node src/cli.ts runner --server "${SMURF_SERVER:-ws://127.0.0.1:47821}"
    ;;
  status)
    docker compose ps
    curl -s http://127.0.0.1:47821/health && echo
    ;;
  down)
    docker compose down
    ;;
  token)
    env_token
    ;;
  *)
    sed -n '2,9p' "$0"
    ;;
esac
