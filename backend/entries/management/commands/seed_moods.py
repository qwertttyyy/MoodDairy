import random
from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone

from entries.models import Tag, MoodEntry


class Command(BaseCommand):
    help = "Создаёт 3-5 записей настроения на каждый день за последний год"

    def handle(self, *args, **kwargs):
        User = get_user_model()
        try:
            user = User.objects.get(username="qwerty")
        except User.DoesNotExist:
            self.stdout.write(
                self.style.ERROR('Пользователь "qwerty" не найден.')
            )
            return

        now = timezone.now()
        tz = timezone.get_current_timezone()

        start_date = (now - timedelta(days=365)).date()  # год назад (по дате)
        end_date = now.date()

        total_created = 0

        days_count = (end_date - start_date).days + 1
        for day_offset in range(days_count):
            current_day = start_date + timedelta(days=day_offset)

            # сколько записей в этот день (3..5)
            entries_per_day = random.randint(3, 5)

            # границы дня (naive), затем делаем aware
            day_start_naive = datetime.combine(current_day, time.min)
            day_end_naive = datetime.combine(current_day, time.max)

            day_start = timezone.make_aware(day_start_naive, tz)
            day_end = timezone.make_aware(day_end_naive, tz)

            # если это сегодняшний день — не допускаем времени позже now
            if current_day == end_date:
                max_dt = now
            else:
                max_dt = day_end

            # если по какой-то причине границы неверны — пропускаем
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
