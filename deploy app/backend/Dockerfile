# Backend image with Chromium, so the Tecnimede sync (Playwright) can run on Railway.
FROM mcr.microsoft.com/playwright/python:v1.56.0-noble

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
