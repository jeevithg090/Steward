# The Steward bot directory, self-hosted. Build from the repository root:
#
#   docker build -f apps/directory/Dockerfile -t steward-directory .
#   docker run -p 8790:8790 -v steward-directory:/data \
#     -e DIRECTORY_SITE_URL=https://bots.example.org steward-directory
#
# Keys are never baked in. Pass GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and ADMIN_GITHUB_LOGINS
# at run time (-e, --env-file, or your host's secret store) to take submissions.
FROM node:26-slim

ENV NODE_ENV=production \
    DIRECTORY_HOST=0.0.0.0 \
    DIRECTORY_PORT=8790 \
    DIRECTORY_DATA_DIR=/data \
    DIRECTORY_DIR=/data/directory \
    DIRECTORY_SEED_DIR=/app/directory

WORKDIR /app
RUN npm install -g pnpm@10.20.0

COPY . .
# Only the directory and the packages it reads: no web app, no browser, no model clients.
RUN pnpm install --frozen-lockfile --prod --filter "@steward/directory..." \
  && mkdir -p /data && chown node:node /data

USER node
# The database and the bot folders (approved submissions land here). The bundled seed in
# /app/directory is copied in on first start.
VOLUME /data
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:8790/api/info').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["apps/directory/node_modules/.bin/tsx", "apps/directory/src/index.ts"]
