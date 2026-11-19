FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs22-debian13:nonroot
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY backend/src ./backend/src
COPY backend/sql ./backend/sql
COPY frontend ./frontend
ARG RELEASE_SHA=local
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 RELEASE_SHA=$RELEASE_SHA
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=6 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["backend/src/server.js"]
