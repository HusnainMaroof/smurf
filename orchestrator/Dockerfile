# smurf-server: the Smurf control plane (API for the desktop app). The host runner
# (`node src/cli.ts runner`) executes the work; see docs/SMURF.md.
FROM node:24-slim

ENV NODE_ENV=production \
    SMURF_HOST=0.0.0.0 \
    SMURF_PORT=47821 \
    SMURF_DATA=/data

WORKDIR /app
# no runtime dependencies: the source runs directly on Node 24
COPY package.json ./
COPY src ./src
COPY config ./config
COPY workflows ./workflows

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 47821

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:47821/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/cli.ts", "server"]
