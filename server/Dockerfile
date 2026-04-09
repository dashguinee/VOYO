# VOYO Music Backend - Fly.io Deployment
# yt-dlp + Node.js + Deno for highest quality audio extraction

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp (latest)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install Deno (required for yt-dlp JavaScript runtime)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

# Verify installations
RUN yt-dlp --version && deno --version && node --version

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install Node dependencies
RUN npm install --production

# Copy server code
COPY . .

# Create downloads directory
RUN mkdir -p /app/downloads

# Expose port
EXPOSE 8080

# Set environment
ENV NODE_ENV=production
ENV PORT=8080
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start server
CMD ["node", "index.js"]
