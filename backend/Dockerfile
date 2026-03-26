# ── Stage 1: Python deps ───────────────────────────────────────────────────────
FROM python:3.12-slim AS python-builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: Node + LiteParse ─────────────────────────────────────────────────
# Build liteparse in a separate stage so we don't bloat the final image
# with the full npm cache — only the compiled output is copied across.
FROM node:20-slim AS node-builder

# Install LiteParse globally and capture the global prefix
RUN npm install -g @llamaindex/liteparse && \
    # Smoke-test: confirm `lit` resolves
    lit --version


# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# System libs: libpq for asyncpg, curl for healthcheck,
# nodejs runtime for liteparse (needs the V8 engine at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl nodejs && \
    rm -rf /var/lib/apt/lists/*

# Python packages from stage 1
COPY --from=python-builder /install /usr/local

# LiteParse: copy the compiled Node global from stage 2.
# npm global installs land in /usr/local/lib/node_modules on node:20-slim.
# The `lit` bin symlink lives at /usr/local/bin/lit.
COPY --from=node-builder /usr/local/lib/node_modules/@llamaindex/liteparse \
                         /usr/local/lib/node_modules/@llamaindex/liteparse
COPY --from=node-builder /usr/local/bin/lit /usr/local/bin/lit

# App source
COPY . .

RUN mkdir -p /chroma_data /app/finetune_outputs

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--loop", "uvloop", "--access-log"]
