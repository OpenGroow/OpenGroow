###############################################################################
# OpenClaw Gateway – Docker Image
#
# IMPORTANT: Runtime installs are lost on container restart. All binaries
# needed by skills MUST be installed here at build time. If you add a skill
# that needs a new binary, update this Dockerfile and rebuild.
###############################################################################

FROM node:22-bookworm-slim

# Install system dependencies as root
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    chromium \
    ca-certificates \
    gnupg \
    jq \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (required by github skill)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Pin OpenClaw version for reproducible builds — bump apps/openclaw-docker-config/OPENCLAW_VERSION
COPY OPENCLAW_VERSION /tmp/OPENCLAW_VERSION
RUN OPENCLAW_VERSION="$(cat /tmp/OPENCLAW_VERSION)" \
  && npm install -g "openclaw@${OPENCLAW_VERSION}" \
  && cp /tmp/OPENCLAW_VERSION /opt/openclaw-expected-version \
  && rm /tmp/OPENCLAW_VERSION

# Install ClawHub CLI for skill management
RUN npm install -g clawhub

# Create OpenClaw directories owned by node
# runtime/ is mounted as a named Docker volume — creating it here with node
# ownership ensures Docker initialises the volume with the correct permissions.
RUN mkdir -p /home/node/.openclaw/workspace /home/node/.openclaw/runtime /.clawhub \
  && chown -R node:node /home/node/.openclaw /.clawhub

# Copy default config, skills manifest, workspace templates, and entrypoint
COPY config/ /opt/config/
COPY workspace-templates/ /opt/workspace-templates/
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/control-socket-server.js /opt/openclaw-control/socket-server.js
COPY docker/control-socket-openclaw.js /opt/openclaw-control/control-socket-openclaw.js
COPY docker/control-socket-errors.js /opt/openclaw-control/control-socket-errors.js
COPY docker/control-socket-auth.js /opt/openclaw-control/control-socket-auth.js
COPY docker/control-socket-workspace-workflow.js /opt/openclaw-control/control-socket-workspace-workflow.js
COPY docker/control-socket-mcp-workflow.js /opt/openclaw-control/control-socket-mcp-workflow.js
COPY docker/control-socket-plugins-workflow.js /opt/openclaw-control/control-socket-plugins-workflow.js
COPY docker/control-socket-openclaw-workflow.js /opt/openclaw-control/control-socket-openclaw-workflow.js
COPY docker/control-socket-node-workflow.js /opt/openclaw-control/control-socket-node-workflow.js
COPY docker/control-socket-whatsapp-workflow.js /opt/openclaw-control/control-socket-whatsapp-workflow.js
COPY docker/control-socket-channel-workflow.js /opt/openclaw-control/control-socket-channel-workflow.js
COPY docker/control-socket-auth-workflow.js /opt/openclaw-control/control-socket-auth-workflow.js
COPY docker/control-socket-mcp.js /opt/openclaw-control/control-socket-mcp.js
COPY docker/control-socket-speech-to-text.js /opt/openclaw-control/control-socket-speech-to-text.js
COPY docker/control-socket-workspaces.js /opt/openclaw-control/control-socket-workspaces.js
COPY docker/control-socket-template-instructions.js /opt/openclaw-control/control-socket-template-instructions.js
COPY docker/control-socket-sessions.js /opt/openclaw-control/control-socket-sessions.js
COPY docker/control-socket-whatsapp-qr.js /opt/openclaw-control/control-socket-whatsapp-qr.js
COPY docker/control-socket-run-command.js /opt/openclaw-control/control-socket-run-command.js
COPY docker/optional-plugins.js /opt/openclaw-control/optional-plugins.js

USER node

ENTRYPOINT ["tini", "--", "entrypoint.sh"]
