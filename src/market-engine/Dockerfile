FROM python:3.12-slim

RUN groupadd -g 1000 engine && useradd -u 1000 -g engine -s /bin/sh engine

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY market_engine/ /app/market_engine/

RUN mkdir -p /shared && chown engine:engine /shared

USER 1000:1000

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')"

CMD ["python", "-m", "market_engine"]
