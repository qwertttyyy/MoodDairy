FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/. .

RUN python manage.py collectstatic --noinput || true

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
