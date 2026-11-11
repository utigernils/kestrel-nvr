# Kestrel NVR
#
# Die Oberflaeche (React/TypeScript) wird in einer eigenen Stufe mit Node gebaut.
# Ohne Zugriff auf die npm-Registry:  docker build --build-arg WEB_MODE=pre .
# Dann wird die mitgelieferte, vorgebaute Oberflaeche aus app/web uebernommen.
ARG WEB_MODE=src

FROM node:22-alpine AS web-src
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM scratch AS web-pre
COPY app/web /build/app/web

FROM web-${WEB_MODE} AS web

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    KESTREL_CONFIG=/config/config.yml \
    KESTREL_PORT=5000 \
    OMP_WAIT_POLICY=PASSIVE

# ffmpeg (mit libx265) kodiert abgeschlossene Stunden nach H.265 um
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 tzdata util-linux \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/kestrel
COPY requirements.txt .
RUN pip install -r requirements.txt

# Erkennungsmodell (YOLOX-Tiny, Apache-2.0). Liegt es nicht im Paket, wird es geladen.
ARG MODEL_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx
COPY models/ /models/
RUN test -s /models/yolox_tiny.onnx || python -c "import urllib.request,sys; urllib.request.urlretrieve(sys.argv[1], '/models/yolox_tiny.onnx')" "$MODEL_URL"

COPY VERSION CHANGELOG.md CHANGELOG.de.md ./
COPY app ./app
COPY tools ./tools
COPY --from=web /build/app/web ./app/web

VOLUME ["/config", "/data"]
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python tools/healthcheck.py

CMD ["python", "-m", "app.main"]
