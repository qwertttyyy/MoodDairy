import random
from datetime import datetime, time, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from entries.models import MoodEntry


class Command(BaseCommand):
    """Создаёт тестовые записи с открытым текстом за указанный период."""

    help = (
        "Создаёт 3-5 записей настроения на каждый день за указанный период. "
        "Работает только при ENCRYPTION_ENABLED=0: записи пишутся открытым "
        "текстом, и клиент с включённым шифрованием их не прочитает."
    )

    def add_arguments(self, parser):
        """Добавляет параметры имени пользователя и глубины истории."""
        parser.add_argument(
            "--username",
            type=str,
            default="qwerty",
            help="Имя пользователя (по умолчанию: qwerty)",
        )
        parser.add_argument(
            "--days",
            type=int,
            default=365,
            help="Количество дней назад (по умолчанию: 365)",
        )

    def handle(self, *args, **options):
        """Создаёт несколько случайных записей для каждого календарного дня."""
        if settings.ENCRYPTION_ENABLED:
            raise CommandError(
                "ENCRYPTION_ENABLED=1: команда создаст записи, которые "
                "фронтенд не сможет расшифровать. "
                "Запустите с ENCRYPTION_ENABLED=0."
            )

        username = options["username"]
        days_back = options["days"]

        User = get_user_model()
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist as exc:
            raise CommandError(
                f'Пользователь "{username}" не найден.'
            ) from exc

        now = timezone.now()
        tz = timezone.get_current_timezone()

        start_date = (now - timedelta(days=days_back)).date()
        end_date = now.date()

        total_created = 0
        days_count = (end_date - start_date).days + 1

        for day_offset in range(days_count):
            current_day = start_date + timedelta(days=day_offset)
            entries_per_day = random.randint(3, 5)

            day_start = timezone.make_aware(
                datetime.combine(current_day, time.min), tz
            )
            day_end = timezone.make_aware(
                datetime.combine(current_day, time.max), tz
            )

            max_dt = now if current_day == end_date else day_end
            if max_dt <= day_start:
                continue

            seconds_range = int((max_dt - day_start).total_seconds())

            moods = []
            for _ in range(entries_per_day):
                rand_sec = random.randint(0, seconds_range)
                random_dt = day_start + timedelta(seconds=rand_sec)
                mood_value = random.randint(1, 9)
                moods.append(
                    MoodEntry(
                        user=user,
                        mood=str(mood_value),
                        note="Тестовая заметка",
                        timestamp=random_dt,
                    )
                )
                total_created += 1

            MoodEntry.objects.bulk_create(moods)

        self.stdout.write(
            self.style.SUCCESS(f"Создано записей: {total_created}")
        )
