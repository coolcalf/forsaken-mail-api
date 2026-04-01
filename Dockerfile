FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY scripts ./scripts
RUN npm install --production && npm cache clean --force

COPY . .

EXPOSE 25
EXPOSE 3000

CMD ["npm", "start"]
