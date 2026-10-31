# Minimal image for the agentkit-data-mcp stdio MCP server.
# Tools list without any key; paid calls need AGENTKIT_PAYER_KEY passed at runtime (never baked in).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY server.json README.md LICENSE ./
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "src/server.js"]
