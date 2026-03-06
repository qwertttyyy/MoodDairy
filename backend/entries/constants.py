from django.conf import settings

CACHE_TTL: int = settings.CACHE_TTL
CACHE_PREFIX: str = "entries"

DAYS_PER_PAGE: int = 7

PERIOD_DAYS: dict[str, int] = {
    "year": 365,
    "6months": 182,
    "month": 30,
    "2weeks": 14,
}
