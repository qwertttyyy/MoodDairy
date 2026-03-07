from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timedelta
from typing import Optional, Tuple, List

from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .constants import PERIOD_DAYS, DAYS_PER_PAGE
from .models import MoodEntry, Tag
from .serializers import (
    MoodEntryReadSerializer,
    MoodEntryWriteSerializer,
    TagSerializer,
)
from .cache import cached_action, invalidate_user_cache


class MoodEntryViewSet(viewsets.ModelViewSet):
    """CRUD записей настроения."""

    def get_serializer_class(self):
        if self.action in ("list", "retrieve", "export", "grouped"):
            return MoodEntryReadSerializer
        return MoodEntryWriteSerializer

    def get_queryset(self):
        return MoodEntry.objects.filter(
            user=self.request.user
        ).prefetch_related("tags")

    @cached_action
    def list(self, request: Request, *args, **kwargs) -> Response:
        """Плоский список записей для графиков. Фильтр ?period=month."""
        qs = self.get_queryset()
        period = request.query_params.get("period")
        if period in PERIOD_DAYS:
            cutoff = timezone.now() - timedelta(days=PERIOD_DAYS[period])
            qs = qs.filter(timestamp__gte=cutoff)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="grouped")
    @cached_action
    def grouped(self, request: Request) -> Response:
        """Записи, сгруппированные по дням. Курсор ?before=YYYY-MM-DD."""
        before = self._parse_before(request.query_params.get("before"))
        dates, has_next = self._fetch_date_page(request.user.id, before)

        if not dates:
            return Response({"results": {}, "next_before": None})

        entries = MoodEntry.objects.filter(
            user=request.user,
            timestamp__date__in=dates,
        ).prefetch_related("tags")

        serializer = self.get_serializer(entries, many=True)

        grouped: OrderedDict[str, list] = OrderedDict()
        for item in serializer.data:
            day = datetime.fromisoformat(item["timestamp"]).date().isoformat()
            grouped.setdefault(day, []).append(item)

        next_before = dates[-1].isoformat() if has_next else None

        return Response({"results": grouped, "next_before": next_before})

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request: Request) -> JsonResponse:
        """Экспорт всех записей в JSON-файл."""
        serializer = MoodEntryReadSerializer(self.get_queryset(), many=True)
        response = JsonResponse(
            serializer.data,
            safe=False,
            json_dumps_params={"ensure_ascii": False, "indent": 2},
        )
        filename = f"moods-export-{date.today()}.json"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    def perform_create(self, serializer: MoodEntryWriteSerializer) -> None:
        serializer.save(user=self.request.user)
        invalidate_user_cache(self.request.user.id)

    def perform_update(self, serializer: MoodEntryWriteSerializer) -> None:
        serializer.save()
        invalidate_user_cache(self.request.user.id)

    def perform_destroy(self, instance: MoodEntry) -> None:
        user_id = instance.user_id
        instance.delete()
        invalidate_user_cache(user_id)

    @staticmethod
    def _parse_before(value: str | None) -> date | None:
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None

    @staticmethod
    def _fetch_date_page(
        user_id: int, before: Optional[date]
    ) -> Tuple[List[date], bool]:
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

        dates: List[date] = list(qs[: DAYS_PER_PAGE + 1])
        has_next = len(dates) > DAYS_PER_PAGE
        return dates[:DAYS_PER_PAGE], has_next


class TagViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Список тегов (read-only)."""

    queryset = Tag.objects.all()
    serializer_class = TagSerializer
