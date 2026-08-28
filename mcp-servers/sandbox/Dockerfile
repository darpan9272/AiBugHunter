FROM python:3.12-slim

# Minimal pentest workspace utilities (kept small; heavy scanners live in recon/exploit servers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git dnsutils iputils-ping netcat-openbsd grep ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn httpx pyyaml

COPY server.py .
RUN mkdir -p /workspace

EXPOSE 8004
CMD ["python", "server.py"]
