"""Ограничения частоты для тяжёлых операций приложения."""

from rest_framework.throttling import UserRateThrottle


class SnapshotRateThrottle(UserRateThrottle):
    """Применяет отдельный лимит к выгрузке полной истории."""

    scope = "snapshot"
