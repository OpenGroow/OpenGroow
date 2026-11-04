# Node, git, tini and the pinned `openclaw` come from the shared base image
# (apps/openclaw-docker-config/docker/base/Dockerfile): one copy of openclaw
# for both this image and the gateway.
ARG OPENCLAW_BASE_IMAGE=opengroow/openclaw-base:local
FROM ${OPENCLAW_BASE_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    socat \
  && rm -rf /var/lib/apt/lists/*

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
