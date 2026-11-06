# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca bun install --frozen-lockfile --production; \
    else \
      bun install --frozen-lockfile --production; \
    fi
COPY src ./src
USER bun
CMD ["bun", "src/main.ts"]
