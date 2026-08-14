FROM node:20-slim

RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl && \
    pip3 install --break-system-packages yt-dlp==2025.7.21 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify yt-dlp is installed and working
RUN yt-dlp --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.cjs ./

EXPOSE 3001
CMD ["node", "server.cjs"]
