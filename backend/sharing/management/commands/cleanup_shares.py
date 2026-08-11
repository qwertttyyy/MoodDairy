"""Удаление отработавших ссылок шаринга.

Просроченные и отозванные записи не нужны никому, но продолжают занимать
место вместе со своими блобами — а блоб это снапшот всех записей врачу.
Команда рассчитана на запуск по расписанию (cron, systemd timer).
"""

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from sharing.models import SharedAccess

# Запас перед удалением: если пользователь пожалуется на пропавшую ссылку,
# запись ещё можно посмотреть в базе.
DEFAULT_RETENTION_DAYS = 7


class Command(BaseCommand):
    help = (
        "Удаляет просроченные и отозванные ссылки шаринга старше N дней "
        f"(по умолчанию {DEFAULT_RETENTION_DAYS})."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=DEFAULT_RETENTION_DAYS,
            help="Сколько дней хранить отработавшие ссылки",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, сколько записей будет удалено",
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=options["days"])

        stale = SharedAccess.objects.filter(
            Q(is_active=False) | Q(expires_at__lt=timezone.now()),
            created_at__lt=cutoff,
        )
        count = stale.count()

        if options["dry_run"]:
            self.stdout.write(f"К удалению: {count}")
            return

        stale.delete()
        self.stdout.write(self.style.SUCCESS(f"Удалено ссылок: {count}"))
