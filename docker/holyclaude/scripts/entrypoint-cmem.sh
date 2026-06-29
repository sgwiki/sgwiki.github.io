#!/bin/bash
# ==============================================================================
# Entrypoint wrapper for the coderluii/holyclaude base image.
#
#   1. Provision claude-mem (idempotent) + fix ~/.claude-mem ownership.
#   2. Hand off to the ORIGINAL base entrypoint, which performs UID/GID remap,
#      first-boot bootstrap, and finally `exec /init` (s6-overlay PID 1).
#
# Environment (PUID/PGID/ZAI keys/etc.) is inherited from docker-compose.
# ==============================================================================
set -e

# Provision claude-mem; never block container startup on a memory-plugin failure.
if ! /etc/holyclaude/claude-mem-bootstrap.sh; then
  echo "[claude-mem] bootstrap reported failure — continuing to base entrypoint." >&2
fi

# Delegate to the base image entrypoint (remap → bootstrap → s6-overlay init).
exec /usr/local/bin/entrypoint.sh "$@"
