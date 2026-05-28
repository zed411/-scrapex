FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm install && npx playwright install chromium
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
