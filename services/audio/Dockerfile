FROM node:22-bookworm-slim

ARG BGUTIL_VERSION=1.3.2

ENV NODE_ENV=production \
    PORT=8080 \
    AUDIO_MAX_CONCURRENT=2 \
    AUDIO_BITRATE=128K \
    BGUTIL_SERVER_HOME=/opt/bgutil-ytdlp-pot-provider/server \
    PATH="/opt/ytdlp/bin:${PATH}"

RUN apt-get update

RUN apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    ca-certificates \
    git

RUN python3 -m venv /opt/ytdlp

RUN /opt/ytdlp/bin/pip install --no-cache-dir --upgrade pip

RUN /opt/ytdlp/bin/pip install --no-cache-dir --upgrade \
    "yt-dlp[default]" \
    bgutil-ytdlp-pot-provider

RUN git clone \
    --single-branch \
    --branch "${BGUTIL_VERSION}" \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil-ytdlp-pot-provider

WORKDIR /opt/bgutil-ytdlp-pot-provider/server

RUN npm ci

RUN npx tsc

RUN apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

COPY src ./src

EXPOSE 8080

CMD ["npm", "start"]
