FROM node:20-slim

# yt-dlp is deliberately UNPINNED: YouTube's bot detection changes constantly
# and only recent releases carry the evasion that keeps extraction working
# from datacenter IPs (the old 2025.7.21 pin was a year stale and getting
# "Sign in to confirm you're not a bot" blocks). Builds always install the
# newest release.
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl && \
    pip3 install --break-system-packages -U yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify yt-dlp is installed and working
RUN yt-dlp --version

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.cjs server-songs.json ./

EXPOSE 3001
CMD ["node", "server.cjs"]
