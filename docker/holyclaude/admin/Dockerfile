FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && git config --system --add safe.directory /workspace \
 && rm -rf /var/lib/apt/lists/*

RUN pip install uv

WORKDIR /app

COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

COPY app/ ./app/
COPY templates/ ./templates/
COPY presets.json ./presets.json

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]
