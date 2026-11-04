###############################################################################
# OpenClaw base image – shared by the gateway and the runtime-worker.
#
# Both images run the same `openclaw` CLI (~800 MB). Installing it in each one
# stored it twice; building both FROM this image stores it once. It holds only
# what both need: Node, git, tini, ca-certificates and the pinned `openclaw`.
# Bump apps/openclaw-docker-config/OPENCLAW_VERSION to change the version for
# both images at once.
###############################################################################

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    tini \
  && rm -rf /var/lib/apt/lists/*

COPY OPENCLAW_VERSION /tmp/OPENCLAW_VERSION
RUN OPENCLAW_VERSION="$(cat /tmp/OPENCLAW_VERSION)" \
  && npm install -g "openclaw@${OPENCLAW_VERSION}" \
  && cp /tmp/OPENCLAW_VERSION /opt/openclaw-expected-version \
  && rm /tmp/OPENCLAW_VERSION
