FROM python:3.12-slim

RUN pip install uv

WORKDIR /app

ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python

COPY src/pyproject.toml src/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src/amadeus/ amadeus/
COPY "src/슈타인즈게이트_온톨로지.ttl" ./
COPY "src/슈타인즈게이트_온톨로지_클래스_해설.md" ./
RUN uv sync --frozen --no-dev

RUN useradd -r -s /bin/false mcp \
 && chown -R mcp:mcp /app /opt/uv-python

ENV PATH=/app/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER mcp

CMD ["python", "-m", "amadeus.mcp_server"]
