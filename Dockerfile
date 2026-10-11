# OPSIONAL: SAMAR bisa dijalankan tanpa Docker (npm install && npm start).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "scripts/dev.js"]
