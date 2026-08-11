from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import Min, QuerySet
from django.db.models.functions import TruncDate
from django.utils import timezone

from .constants import DAYS_PER_PAGE, DEFAULT_TAG_NAMES, PERIOD_DAYS
from .models import MoodEntry, Tag


def create_default_tags(user) -> list[Tag]:
    """Создаёт стартовый набор тегов новому пользователю."""
    return Tag.objects.bulk_create(
        [Tag(user=user, name=name) for name in DEFAULT_TAG_NAMES],
        ignore_conflicts=True,
    )


def day_start(day: date) -> datetime:
    """Начало календарного дня в часовом поясе проекта."""
    tz = timezone.get_current_timezone()
    return datetime.combine(day, time.min, tzinfo=tz)


def day_end(day: date) -> datetime:
    """Начало следующего дня — верхняя граница для сравнения `<`."""
    return day_start(day + timedelta(days=1))


def filter_by_calendar(
    qs: QuerySet[MoodEntry], year: int, month: int | None = None
) -> QuerySet[MoodEntry]:
    """Ограничивает выборку календарным месяцем или годом целиком.

    Сравнение идёт по границам диапазона, а не по извлечению части даты:
    так работает индекс (user, -timestamp).
    """
    tz = timezone.get_current_timezone()
    if month is None:
        start = datetime(year, 1, 1, tzinfo=tz)
        end = datetime(year + 1, 1, 1, tzinfo=tz)
    else:
        start = datetime(year, month, 1, tzinfo=tz)
        end = (
            datetime(year + 1, 1, 1, tzinfo=tz)
            if month == 12
            else datetime(year, month + 1, 1, tzinfo=tz)
        )
    return qs.filter(timestamp__gte=start, timestamp__lt=end)


def filter_by_period(
    qs: QuerySet[MoodEntry], period: str
) -> QuerySet[MoodEntry]:
    """Ограничивает выборку относительным периодом от текущего момента."""
    cutoff = timezone.now() - timedelta(days=PERIOD_DAYS[period])
    return qs.filter(timestamp__gte=cutoff)


def fetch_date_page(
    user_id: int, before: date | None
) -> tuple[list[date], bool]:
    """Достаёт DAYS_PER_PAGE уникальных дат + признак следующей страницы."""
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


def fetch_entries_for_days(
    user_id: int, days: list[date]
) -> QuerySet[MoodEntry]:
    """Записи за перечисленные дни.

    Дни на странице идут подряд, поэтому берём диапазон времени вместо
    `timestamp__date__in`: фильтр по выражению от поля не может использовать
    индекс, а сравнение с границами — может.
    """
    return MoodEntry.objects.filter(
        user_id=user_id,
        timestamp__gte=day_start(days[-1]),
        timestamp__lt=day_end(days[0]),
    ).prefetch_related("tags")


def group_entries_by_day(entries_data: list[dict]) -> dict[str, list[dict]]:
    """Раскладывает сериализованные записи по календарным дням.

    DRF отдаёт timestamp уже в часовом поясе проекта, поэтому дата в ключе
    совпадает с той, по которой считалась страница в fetch_date_page.
    """
    grouped: dict[str, list[dict]] = {}
    for item in entries_data:
        day = datetime.fromisoformat(item["timestamp"]).date().isoformat()
        grouped.setdefault(day, []).append(item)
    return grouped


def get_first_entry_timestamp(user_id: int) -> datetime | None:
    """Момент первой записи пользователя (для выбора доступных периодов)."""
    return (
        MoodEntry.objects.filter(user_id=user_id)
        .aggregate(first=Min("timestamp"))
        .get("first")
    )
