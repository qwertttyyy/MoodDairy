# --- Стадия сборки: ставит зависимости, в финальный образ не попадает ---
FROM python:3.12-slim AS builder

# uv ставится копированием бинарника из официального образа — быстрее и без
# лишнего pip-слоя.
COPY --from=ghcr.io/astral-sh/uv:0.10.12 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Байткод компилируется на сборке, чтобы не тратить время при старте.
    UV_COMPILE_BYTECODE=1 \
    # Кэш и venv лежат на разных слоях, жёсткие ссылки между ними не работают.
    UV_LINK_MODE=copy \
    # Интерпретатор берём из базового образа, а не скачиваем отдельный.
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Отдельный слой зависимостей: пересобирается только при изменении манифеста
# или лока. --no-dev оставляет за бортом ruff и coverage.
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


# --- Финальный образ: только рантайм ---
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Боевые настройки: обязательные переменные без умолчаний, строгие куки, HSTS.
    DJANGO_SETTINGS_MODULE=config.settings.prod \
    # Команды (python, gunicorn) резолвятся из окружения проекта.
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY . .

# Статика служебная (админка, DRF) и между запусками не меняется, поэтому
# собирается один раз на сборке, а не при каждом старте контейнера.
# Настройки разработки берутся намеренно: боевые требуют секретов, которых
# на этапе сборки нет и быть не должно.
RUN DJANGO_SETTINGS_MODULE=config.settings.dev \
    python manage.py collectstatic --noinput

COPY entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

EXPOSE 8000

# Проверяет не только живость процесса, но и доступность БД.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/', timeout=4).status == 200 else 1)"

ENTRYPOINT ["/entrypoint.sh"]
