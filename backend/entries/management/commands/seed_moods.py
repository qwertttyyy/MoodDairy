import random
from datetime import datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from entries.models import MoodEntry


class Command(BaseCommand):
    help = "Создаёт 3-5 записей настроения на каждый день за указанный период"

    def add_arguments(self, parser):
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
        username = options["username"]
        days_back = options["days"]

        User = get_user_model()
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            self.stdout.write(
                self.style.ERROR(f'Пользователь "{username}" не найден.')
            )
            return

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
                        note="encrypted_note",
                        timestamp=random_dt,
                    )
                )
                total_created += 1

            MoodEntry.objects.bulk_create(moods)

        self.stdout.write(
            self.style.SUCCESS(f"Создано записей: {total_created}")
        )
