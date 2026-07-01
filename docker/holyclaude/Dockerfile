FROM coderluii/holyclaude:latest

USER root
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
RUN ln -sf /usr/local/bin/uv /usr/local/bin/uvx
COPY scripts/git-credential-cloudcli-github /usr/local/bin/git-credential-cloudcli-github
RUN chmod 0755 /usr/local/bin/git-credential-cloudcli-github \
    && git config --system user.name "sgwiki" \
    && git config --system user.email "sgwiki404@gmail.com" \
    && git config --system credential.https://github.com.helper /usr/local/bin/git-credential-cloudcli-github
RUN uv venv /opt/venv
ENV VIRTUAL_ENV="/opt/venv" \
    PATH="/opt/venv/bin:$PATH"
RUN uv pip install openai

# --- claude-mem: persistent agent memory (worker auto-managed by hooks) ---
# Bun runtime drives the claude-mem worker service. Pre-install in the image so
# rebuilds don't re-download it at first-boot install time.
RUN npm install -g bun

# Idempotent provisioner (marketplace clone + hooks + worker setup + volume chown).
COPY scripts/claude-mem-bootstrap.sh /etc/holyclaude/claude-mem-bootstrap.sh
COPY scripts/humanize-bootstrap.sh /etc/holyclaude/humanize-bootstrap.sh
RUN chmod 0755 /etc/holyclaude/claude-mem-bootstrap.sh \
    && chmod 0755 /etc/holyclaude/humanize-bootstrap.sh

# Entrypoint wrapper: provision claude-mem, then delegate to the base s6 entrypoint.
COPY scripts/entrypoint-cmem.sh /usr/local/bin/entrypoint-cmem.sh
RUN chmod 0755 /usr/local/bin/entrypoint-cmem.sh

# s6 longrun: claude-mem worker (supervised, auto-restarted, started at boot).
# claude-mem v13 does NOT autostart the worker, so s6 must run it.
COPY scripts/s6/claude-mem-worker/run  /etc/s6-overlay/s6-rc.d/claude-mem-worker/run
COPY scripts/s6/claude-mem-worker/type /etc/s6-overlay/s6-rc.d/claude-mem-worker/type
RUN chmod +x /etc/s6-overlay/s6-rc.d/claude-mem-worker/run

# Register the worker in the base image's active 'user' bundle so s6-overlay
# starts it at boot (the user bundle uses a contents.d/ dir, not a contents file).
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/claude-mem-worker

# --- proxy ---
COPY scripts/claude-mem-llm-proxy.js /app/scripts/claude-mem-llm-proxy.js
COPY scripts/s6/claude-mem-proxy/run  /etc/s6-overlay/s6-rc.d/claude-mem-proxy/run
COPY scripts/s6/claude-mem-proxy/type /etc/s6-overlay/s6-rc.d/claude-mem-proxy/type
RUN chmod +x /etc/s6-overlay/s6-rc.d/claude-mem-proxy/run
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/claude-mem-proxy

ENTRYPOINT ["/usr/local/bin/entrypoint-cmem.sh"]
