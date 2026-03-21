from __future__ import annotations

import logging
from datetime import date, datetime

from django.http import JsonResponse
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .cache import cached_action, invalidate_user_cache
from .models import MoodEntry, Tag
from .serializers import (
    MoodEntryReadSerializer,
    MoodEntryWriteSerializer,
    TagSerializer,
)
from .services import (
    fetch_date_page,
    filter_by_month,
    filter_by_period,
    get_first_entry_date,
    parse_before,
)

logger = logging.getLogger("entries")


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
        """
        Плоский список записей для графиков.
        Фильтры:
          ?period=month|year|6months|2weeks
          ?year=2026&month=3  — конкретный календарный месяц
        """
        qs = self.get_queryset()

        year = request.query_params.get("year")
        month = request.query_params.get("month")

        if year and month:
            qs = filter_by_month(qs, year, month)
        else:
            period = request.query_params.get("period")
            if period:
                qs = filter_by_period(qs, period)

        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="date-range")
    @cached_action
    def date_range(self, request: Request) -> Response:
        """Возвращает дату первой записи пользователя."""
        first = get_first_entry_date(request.user.id)
        return Response(
            {
                "first_date": first.isoformat() if first else None,
            }
        )

    @action(detail=False, methods=["get"], url_path="grouped")
    @cached_action
    def grouped(self, request: Request) -> Response:
        """Записи, сгруппированные по дням. Курсор ?before=YYYY-MM-DD."""
        before = parse_before(request.query_params.get("before"))
        dates, has_next = fetch_date_page(request.user.id, before)

        if not dates:
            return Response({"results": {}, "next_before": None})

        entries = MoodEntry.objects.filter(
            user=request.user,
            timestamp__date__in=dates,
        ).prefetch_related("tags")

        serializer = self.get_serializer(entries, many=True)

        grouped: dict[str, list] = {}
        for item in serializer.data:
            day = datetime.fromisoformat(item["timestamp"]).date().isoformat()
            grouped.setdefault(day, []).append(item)

        next_before = dates[-1].isoformat() if has_next else None

        return Response({"results": grouped, "next_before": next_before})

    @action(detail=False, methods=["get"], url_path="export")
    def export(self, request: Request) -> JsonResponse:
        """Экспорт всех записей в JSON-файл."""
        logger.info("User id=%d exported data", request.user.id)
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
        logger.info("Entry created by user_id=%d", self.request.user.id)

    def perform_update(self, serializer: MoodEntryWriteSerializer) -> None:
        serializer.save()
        invalidate_user_cache(self.request.user.id)
        logger.info(
            "Entry id=%d updated by user_id=%d",
            serializer.instance.id,
            self.request.user.id,
        )

    def perform_destroy(self, instance: MoodEntry) -> None:
        user_id = instance.user_id
        entry_id = instance.id
        instance.delete()
        invalidate_user_cache(user_id)
        logger.info("Entry id=%d deleted by user_id=%d", entry_id, user_id)


class TagViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Список тегов (read-only)."""

    queryset = Tag.objects.all()
    serializer_class = TagSerializer
