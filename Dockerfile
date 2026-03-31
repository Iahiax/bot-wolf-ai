FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:20-alpine AS runner
LABEL maintainer="Wolf Bot"
LABEL description="Wolf Live AI Language Bot — Gemini Flash"
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY bot.js healthcheck.js start.sh ./
COPY config/ ./config/
COPY phrases/ ./phrases/        ← هذا السطر هو الإصلاح

RUN mkdir -p data
RUN chmod +x start.sh

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["sh", "start.sh"]
