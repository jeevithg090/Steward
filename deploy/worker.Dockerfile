# syntax=docker/dockerfile:1
# Tempo's ephemeral worker (S8.4, S8.6). Built reproducibly in CI (release-images) and deployed
# by digest. Run with a read-only root filesystem and /tmp on tmpfs:
#   docker run --read-only --tmpfs /tmp -e IMAGE_DIGEST -e DEPLOY_SIGNING_KEY tempo-worker@sha256:...
FROM ghcr.io/astral-sh/uv:0.13.1-python3.12-trixie-slim@sha256:e28141cccc682844c7bed0cb7e5b2b4522c1f72f1d5116c7d22710d0d421f7dc AS build
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /src
COPY . .
RUN uv sync --frozen --no-dev --no-editable --package tempo-worker

FROM python:3.12-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin tempo
COPY --from=build /src/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TMPDIR=/tmp
USER 10001
EXPOSE 8080
# No shell, SSH or Jupyter entrypoint: the worker process only.
ENTRYPOINT ["python", "-m", "tempo_worker"]
