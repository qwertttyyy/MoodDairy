import random
from datetime import datetime
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone

from entries.models import Tag, MoodEntry


class Command(BaseCommand):
    help = "Наполняет БД тестовыми настроениями"

    def handle(self, *args, **kwargs):
        User = get_user_model()
        user = User.objects.get(id=2)

        if not user:
            self.stdout.write(self.style.ERROR("Нет пользователей в базе"))
            return

        # создаём 5 тегов
        tag_names = ["Работа", "Семья", "Спорт", "Отдых", "Стресс"]

        tags = []
        for name in tag_names:
            tag, _ = Tag.objects.get_or_create(name=name)
            tags.append(tag)

        self.stdout.write(self.style.SUCCESS("Созданы теги"))

        now = timezone.now()

        start = datetime(2026, 1, 1, tzinfo=timezone.get_current_timezone())
        end = now

        total_seconds = int((end - start).total_seconds())

        entries = []

        # создаём 100 записей
        for i in range(100):

            random_seconds = random.randint(0, total_seconds)
            random_date = start + timezone.timedelta(seconds=random_seconds)

            mood_value = random.randint(1, 9)

            entry = MoodEntry.objects.create(
                user=user,
                mood=f"encrypted_mood_{mood_value}",
                note="encrypted_note",
                timestamp=random_date,
            )

            # случайные теги
            entry.tags.set(random.sample(tags, random.randint(0, 3)))

            entries.append(entry)

        self.stdout.write(self.style.SUCCESS("Создано 100 записей настроения"))
