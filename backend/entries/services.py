from __future__ import annotations

from datetime import date, datetime, timedelta

from django.db.models import Min, QuerySet
from django.db.models.functions import TruncDate
from django.utils import timezone

from .constants import DAYS_PER_PAGE, PERIOD_DAYS
from .models import MoodEntry


def filter_by_month(
    qs: QuerySet[MoodEntry], year: str, month: str
) -> QuerySet[MoodEntry]:
    """Фильтрует queryset по конкретному календарному месяцу."""
    try:
        y, m = int(year), int(month)
        tz = timezone.get_current_timezone()
        start = datetime(y, m, 1, tzinfo=tz)
        end = (
            datetime(y + 1, 1, 1, tzinfo=tz)
            if m == 12
            else datetime(y, m + 1, 1, tzinfo=tz)
        )
        return qs.filter(timestamp__gte=start, timestamp__lt=end)
    except (ValueError, TypeError):
        return qs


def filter_by_period(
    qs: QuerySet[MoodEntry], period: str
) -> QuerySet[MoodEntry]:
    """Фильтрует queryset по именованному периоду (month, year, …)."""
    if period in PERIOD_DAYS:
        cutoff = timezone.now() - timedelta(days=PERIOD_DAYS[period])
        return qs.filter(timestamp__gte=cutoff)
    return qs


def parse_before(value: str | None) -> date | None:
    """Парсит курсор ?before=YYYY-MM-DD для пагинации grouped."""
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def fetch_date_page(
    user_id: int, before: date | None
) -> tuple[list[date], bool]:
    """Достаёт DAYS_PER_PAGE уникальных дат + флаг has_next."""
    qs = (
        MoodEntry.objects.filter(user_id=user_id)
        .annotate(day=TruncDate("timestamp"))
        .values_list("day", flat=True)
        .distinct()
        .order_by("-day")
    )
    if before is not None:
        qs = qs.filter(day__lt=before)

    dates = list(qs[: DAYS_PER_PAGE + 1])
    has_next = len(dates) > DAYS_PER_PAGE
    return dates[:DAYS_PER_PAGE], has_next


def get_first_entry_date(user_id: int) -> datetime | None:
    """Дата первой записи пользователя (для date-range endpoint)."""
    return (
        MoodEntry.objects.filter(user_id=user_id)
        .aggregate(first_date=Min("timestamp"))
        .get("first_date")
    )
