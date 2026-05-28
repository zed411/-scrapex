FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install chromium
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
