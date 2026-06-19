FROM python:3.12-slim

RUN pip install uv

WORKDIR /app

COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

COPY app/ ./app/
COPY templates/ ./templates/

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]
