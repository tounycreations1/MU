# Persistent backend for StealthView: long-lived Chromium + WebSocket screencast.
# Much faster than the Vercel serverless mode (no cold starts, no per-click screenshots).
FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production

COPY package.json ./
# devDependencies (vite, tsx, typescript) are needed to build and run the server
RUN npm install --include=dev --no-audit --no-fund \
 && npx playwright-core install --with-deps chromium-headless-shell \
 && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npx vite build

EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
