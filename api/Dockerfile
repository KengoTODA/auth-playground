FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

EXPOSE 5000

CMD ["npm", "run", "start"]
