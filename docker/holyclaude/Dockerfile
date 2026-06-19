FROM coderluii/holyclaude:latest

USER root
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY scripts/git-credential-cloudcli-github /usr/local/bin/git-credential-cloudcli-github
RUN chmod 0755 /usr/local/bin/git-credential-cloudcli-github \
    && git config --system user.name "sgwiki" \
    && git config --system user.email "sgwiki404@gmail.com" \
    && git config --system credential.https://github.com.helper /usr/local/bin/git-credential-cloudcli-github
RUN uv venv /opt/venv
ENV VIRTUAL_ENV="/opt/venv" \
    PATH="/opt/venv/bin:$PATH"
RUN uv pip install openai
