# Shopkeep server – works on Railway, Fly.io, Google Cloud Run, a VPS, etc.
#   docker build -t shopkeep .
#   docker run -p 3033:3033 -e GEMINI_API_KEY=your-key shopkeep
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3033
HEALTHCHECK CMD wget -qO- http://localhost:${PORT:-3033}/healthz || exit 1
USER node
CMD ["node", "server.mjs"]
