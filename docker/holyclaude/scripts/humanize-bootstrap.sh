#!/bin/bash
# ==============================================================================
# Humanize KR bootstrap — best-effort plugin refresh for Claude Code.
#
# Runs before the base holyclaude entrypoint. The plugin lives under the
# persistent ~/.claude bind mount, so image rebuilds do not erase it.
# ==============================================================================
set +e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
CLAUDE_HOME="/home/claude/.claude"
PLUGIN_ROOT="${CLAUDE_HOME}/plugins"
SENTINEL="${PLUGIN_ROOT}/.humanize-installed"
MARKETPLACE_NAME="im-not-ai"
PLUGIN_NAME="humanize-korean"
SOURCE="epoko77-ai/im-not-ai"
PINNED_DIR="${PLUGIN_ROOT}/marketplace-sources/im-not-ai-pinned"

if [ -n "${HUMANIZE_PLUGIN_REF:-}" ]; then
  echo "[humanize] HUMANIZE_PLUGIN_REF=${HUMANIZE_PLUGIN_REF}; preparing pinned marketplace source"
  mkdir -p "$(dirname "${PINNED_DIR}")"
  if [ ! -d "${PINNED_DIR}/.git" ]; then
    rm -rf "${PINNED_DIR}"
    git clone https://github.com/epoko77-ai/im-not-ai.git "${PINNED_DIR}" \
      || echo "[humanize] pinned clone failed; falling back to configured marketplace" >&2
  fi
  if [ -d "${PINNED_DIR}/.git" ]; then
    git -C "${PINNED_DIR}" fetch --all --tags --prune \
      || echo "[humanize] pinned fetch failed; using existing checkout" >&2
    git -C "${PINNED_DIR}" checkout "${HUMANIZE_PLUGIN_REF}" \
      || echo "[humanize] pinned checkout failed; using existing checkout" >&2
    chown -R "${PUID}:${PGID}" "${PINNED_DIR}" 2>/dev/null || true
    SOURCE="${PINNED_DIR}"
  fi
fi

mkdir -p "${PLUGIN_ROOT}"
chown -R "${PUID}:${PGID}" "${CLAUDE_HOME}" 2>/dev/null || true

run_as_claude() {
  su -s /bin/sh claude -c "export HOME=/home/claude; $*" </dev/null
}

echo "[humanize] refreshing marketplace=${MARKETPLACE_NAME} plugin=${PLUGIN_NAME} source=${SOURCE}"

if [ -n "${HUMANIZE_PLUGIN_REF:-}" ] && [ -d "${PINNED_DIR}/.git" ]; then
  run_as_claude "claude plugin marketplace remove ${MARKETPLACE_NAME}" \
    || true
fi

run_as_claude "claude plugin marketplace add ${SOURCE}" \
  || echo "[humanize] marketplace add failed or already exists; continuing" >&2

run_as_claude "claude plugin marketplace update ${MARKETPLACE_NAME}" \
  || echo "[humanize] marketplace update failed; continuing with existing copy if present" >&2

run_as_claude "claude plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}" \
  || echo "[humanize] plugin install failed or already installed; continuing" >&2

run_as_claude "claude plugin update ${PLUGIN_NAME}" \
  || echo "[humanize] plugin update failed; continuing with installed version if present" >&2

touch "${SENTINEL}" 2>/dev/null || true
chown "${PUID}:${PGID}" "${SENTINEL}" 2>/dev/null || true
echo "[humanize] refresh complete (best effort)."
exit 0
