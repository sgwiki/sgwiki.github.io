#!/bin/bash
# ==============================================================================
# claude-mem bootstrap — idempotent install + ~/.claude-mem ownership fix
#
# Runs from the entrypoint wrapper BEFORE the base image entrypoint (which does
# the UID/GID remap and hands off to s6-overlay). We chown to ${PUID}:${PGID} —
# the same numeric uid/gid the base entrypoint will assign to `claude` — so the
# named-volume data stays correctly owned after the remap.
#
# Idempotent: a sentinel inside the (persistent) named volume skips re-install
# on subsequent boots and rebuilds. The marketplace clone + hooks registration
# live on the ~/.claude bind mount and also persist.
# ==============================================================================
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
CMEM_DIR="/home/claude/.claude-mem"
SENTINEL="${CMEM_DIR}/.holyclaude-cmem-installed"

# 1. Ensure data dir exists and is owned by the (to-be-remapped) claude user.
mkdir -p "${CMEM_DIR}"
chown -R "${PUID}:${PGID}" "${CMEM_DIR}"

# 2. Idempotent install — skip if already provisioned on this volume.
if [ -f "${SENTINEL}" ]; then
  echo "[claude-mem] already provisioned (sentinel present), skipping install."
  exit 0
fi

echo "[claude-mem] first-time provision: marketplace + hooks + worker setup..."
# Run as the claude user so HOME/files resolve correctly. </dev/null forces
# non-interactive mode (no TTY in container) so the installer can't hang.
if ! su -s /bin/sh claude -c '
      set -e
      export HOME=/home/claude
      npx -y claude-mem@latest install
    ' </dev/null; then
  echo "[claude-mem] install failed — will retry on next boot." >&2
  exit 0
fi

# Re-chown: install may have written files as the pre-remap claude UID.
chown -R "${PUID}:${PGID}" "${CMEM_DIR}" 2>/dev/null || true
touch "${SENTINEL}"
chown "${PUID}:${PGID}" "${SENTINEL}"
echo "[claude-mem] provision complete."
