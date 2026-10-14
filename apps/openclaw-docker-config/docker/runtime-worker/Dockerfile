FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    socat \
    tini \
  && rm -rf /var/lib/apt/lists/*

COPY apps/openclaw-docker-config/OPENCLAW_VERSION /tmp/OPENCLAW_VERSION
RUN npm install -g "openclaw@$(cat /tmp/OPENCLAW_VERSION)" \
  && rm /tmp/OPENCLAW_VERSION

WORKDIR /opt/runtime-worker

RUN npm install --no-save tsx ws

COPY apps/openclaw-docker-config/docker/runtime-worker/entrypoint.sh /opt/runtime-worker/entrypoint.sh
COPY scripts/docker/load-secrets-file.sh /opt/runtime-worker/load-secrets-file.sh
COPY apps/openclaw-runtime-worker/src /opt/runtime-worker/src
COPY packages/hmac /opt/runtime-worker/node_modules/@opengroow/hmac
COPY packages/protocol /opt/runtime-worker/node_modules/@opengroow/protocol
RUN chmod +x /opt/runtime-worker/entrypoint.sh

ENTRYPOINT ["tini", "--"]
CMD ["/opt/runtime-worker/entrypoint.sh"]
