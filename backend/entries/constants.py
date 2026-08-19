CACHE_PREFIX: str = "entries"

DAYS_PER_PAGE: int = 7

DEFAULT_TAG_NAMES: tuple[str, ...] = (
    "Работа",
    "Семья",
    "Спорт",
    "Отдых",
    "Стресс",
)

PERIOD_DAYS: dict[str, int] = {
    "year": 365,
    "6months": 182,
    "month": 30,
    "2weeks": 14,
}

MIN_YEAR: int = 2000
MAX_YEAR: int = 2100

MOOD_MAX_LENGTH: int = 512
ANXIETY_MAX_LENGTH: int = 512
NOTE_MAX_LENGTH: int = 8192
