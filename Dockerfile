FROM node:20-slim

# yt-dlp is deliberately UNPINNED: YouTube's bot detection changes constantly
# and only recent releases carry the evasion that keeps extraction working
# from datacenter IPs (the old 2025.7.21 pin was a year stale and getting
# "Sign in to confirm you're not a bot" blocks). Builds always install the
# newest release.
#
# bgutil-ytdlp-pot-provider is the yt-dlp PO token plugin. Proof-of-origin
# tokens make extraction traffic from a datacenter IP (Render) look
# legitimate to YouTube — without them, even mobile player clients get
# bot-blocked from cloud IPs.
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl git && \
    pip3 install --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify yt-dlp is installed and working
RUN yt-dlp --version

# Build the PO token provider HTTP server (the yt-dlp plugin auto-connects
# to 127.0.0.1:4416, so no extra config is needed).
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-pot && \
    cd /opt/bgutil-pot/server && npm ci && npx tsc

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.cjs server-songs.json ./

EXPOSE 3001

# Start the PO token provider in the background, then the API server.
CMD ["sh", "-c", "node /opt/bgutil-pot/server/build/main.js > /tmp/bgutil-pot.log 2>&1 & exec node server.cjs"]
