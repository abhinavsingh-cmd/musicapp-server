FROM node:20-slim

# yt-dlp is deliberately UNPINNED: YouTube's bot detection changes constantly
# and only recent releases carry the evasion that keeps extraction working
# from datacenter IPs (the old 2025.7.21 pin was a year stale and getting
# "Sign in to confirm you're not a bot" blocks). Builds always install the
# newest release.
#
# bgutil-ytdlp-pot-provider is the yt-dlp PO token plugin. Proof-of-origin
# tokens make extraction traffic from a datacenter IP (Render) look
# legitimate to YouTube.
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl git unzip && \
    pip3 install --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider && \
    curl -fsSL https://deno.land/install.sh | sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify yt-dlp is installed and working
RUN yt-dlp --version

# Build the PO token provider HTTP server (the yt-dlp plugin auto-connects
# to 127.0.0.1:4416, so no extra config is needed).
RUN git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-pot && \
    cd /opt/bgutil-pot/server && npm ci && npx tsc

# ── Cloudflare WARP SOCKS5 proxy ─────────────────────────────────────────
# YouTube bot-blocks raw datacenter IPs (Render) even with PO tokens, but
# does NOT block Cloudflare's network. wireproxy exposes the WARP tunnel as
# a local SOCKS5 proxy on :1080; server.cjs routes all yt-dlp traffic
# through it (with a direct-connection fallback if it is ever down).
RUN curl -fsSL -o /usr/local/bin/wgcf \
      "https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_linux_amd64" && \
    curl -fsSL -o /tmp/wireproxy.tar.gz \
      "https://github.com/pufferffish/wireproxy/releases/download/v1.1.3/wireproxy_linux_amd64.tar.gz" && \
    tar -xzf /tmp/wireproxy.tar.gz -C /usr/local/bin wireproxy && \
    rm -f /tmp/wireproxy.tar.gz && \
    chmod +x /usr/local/bin/wgcf /usr/local/bin/wireproxy && \
    cd /root && echo | wgcf register --accept-tos && wgcf generate && \
    printf '\n[Socks5]\nBindAddress = 127.0.0.1:1080\n\n' >> /root/wgcf-profile.conf

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY server.cjs server-songs.json ./

EXPOSE 3001

# Start the PO token provider, then the WARP SOCKS5 proxy, then the API.
ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

# Configure yt-dlp to fetch EJS challenge solver components from GitHub
# (needed for YouTube n-parameter/signature solving from datacenter IPs).
RUN mkdir -p /root/.config/yt-dlp && echo '--remote-components ejs:github' > /root/.config/yt-dlp/config

CMD ["sh", "-c", "node /opt/bgutil-pot/server/build/main.js > /tmp/bgutil-pot.log 2>&1 & /usr/local/bin/wireproxy -c /root/wgcf-profile.conf > /tmp/wireproxy.log 2>&1 & sleep 3 && exec node server.cjs"]
