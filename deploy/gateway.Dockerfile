# syntax=docker/dockerfile:1
# Tempo's Gateway (the control plane). Built reproducibly in CI (release-images), deployed by
# digest, run with a read-only root filesystem and /tmp on tmpfs; checkpoints on a volume.
FROM ghcr.io/astral-sh/uv:0.13.1-python3.12-trixie-slim@sha256:e28141cccc682844c7bed0cb7e5b2b4522c1f72f1d5116c7d22710d0d421f7dc AS build
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /src
COPY . .
RUN uv sync --frozen --no-dev --no-editable --package tempo-gateway

FROM python:3.12-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin tempo
COPY --from=build /src/.venv /app/.venv
COPY skills /app/skills
COPY fixtures/rail/replay /app/fixtures/rail/replay
COPY fixtures/court /app/fixtures/court
COPY alembic.ini /app/alembic.ini
COPY alembic /app/alembic
WORKDIR /app
ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TMPDIR=/tmp \
    TEMPO_HOME=/app CHECKPOINT_DIR=/data/checkpoints MESH_FILE=/data/mesh.json
USER 10001
EXPOSE 8000
ENTRYPOINT ["uvicorn", "tempo_gateway.main:build", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
