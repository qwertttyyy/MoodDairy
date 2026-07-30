FROM python:3.12-slim

# uv ставится копированием бинарника из официального образа — быстрее и без лишнего pip-слоя.
COPY --from=ghcr.io/astral-sh/uv:0.10.12 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Байткод компилируется на сборке, чтобы не тратить время при старте контейнера.
    UV_COMPILE_BYTECODE=1 \
    # Кэш и venv лежат на разных слоях, жёсткие ссылки между ними не работают.
    UV_LINK_MODE=copy \
    # Интерпретатор берём из базового образа, а не скачиваем отдельный.
    UV_PYTHON_DOWNLOADS=never \
    # Команды (python, gunicorn) резолвятся из окружения проекта.
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends nano && rm -rf /var/lib/apt/lists/*
RUN echo "alias ll='ls -la'" >> /root/.bashrc

# Отдельный слой зависимостей: пересобирается только при изменении манифеста или лока.
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

COPY . .

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
