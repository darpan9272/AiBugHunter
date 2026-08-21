FROM python:3.12-slim

# Install recon tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget git nmap unzip ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Use matching pre-compiled binaries instead of Go to avoid memory exhaustion during build.
RUN ARCH="$(dpkg --print-architecture)" && \
    wget -qO pdtm.zip "https://github.com/projectdiscovery/pdtm/releases/download/v0.1.5/pdtm_0.1.5_linux_${ARCH}.zip" && \
    unzip pdtm.zip && mv pdtm /usr/local/bin/ && rm pdtm.zip && \
    pdtm -i subfinder,httpx,katana,nuclei

ENV PATH="/root/.pdtm/go/bin:${PATH}"

RUN ARCH="$(dpkg --print-architecture)" && \
    wget -qO gau.tar.gz "https://github.com/lc/gau/releases/download/v2.2.4/gau_2.2.4_linux_${ARCH}.tar.gz" && \
    tar -xzf gau.tar.gz -C /usr/local/bin gau && rm gau.tar.gz

# Install Python MCP server deps
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

RUN mkdir -p /app/output /app/targets/programs

# Pull latest nuclei templates on first run
RUN nuclei -update-templates -silent || true

EXPOSE 8001
CMD ["python", "server.py"]
