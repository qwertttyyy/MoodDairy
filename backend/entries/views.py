from __future__ import annotations

import logging

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .cache import entries_cache
from .models import MoodEntry, Tag
from .serializers import (
    ChartFilterSerializer,
    GroupedFilterSerializer,
    MoodEntryChartSerializer,
    MoodEntryReadSerializer,
    MoodEntrySnapshotSerializer,
    MoodEntryWriteSerializer,
    TagSerializer,
)
from .services import (
    fetch_date_page,
    fetch_entries_for_days,
    filter_by_calendar,
    filter_by_period,
    get_first_entry_timestamp,
    group_entries_by_day,
)
from .throttling import SnapshotRateThrottle

logger = logging.getLogger("entries")

WRITE_ACTIONS = ("create", "update", "partial_update")


class MoodEntryViewSet(viewsets.ModelViewSet):
    """CRUD записей настроения."""

    def get_serializer_class(self):
        # Пишем — Write, всё остальное читаем Read. Условие именно в эту
        # сторону: новое действие по умолчанию получает безопасный вариант.
        if self.action in WRITE_ACTIONS:
            return MoodEntryWriteSerializer
        return MoodEntryReadSerializer

    def get_queryset(self):
        return MoodEntry.objects.filter(
            user=self.request.user
        ).prefetch_related("tags")

    def create(self, request: Request, *args, **kwargs) -> Response:
        """Ответ отдаём в том же виде, что и GET: теги объектами, не id."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(
            MoodEntryReadSerializer(serializer.instance).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request: Request, *args, **kwargs) -> Response:
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(
            instance, data=request.data, partial=partial
        )
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(MoodEntryReadSerializer(serializer.instance).data)

    @entries_cache.cache_response(key_params=("period", "year", "month"))
    def list(self, request: Request, *args, **kwargs) -> Response:
        """Данные для графиков за период.

        Период обязателен:
          ?period=2weeks|month|6months|year — относительный отрезок
          ?year=2026&month=3                — конкретный месяц
          ?year=2025                        — конкретный год
        """
        filters = ChartFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)
        params = filters.validated_data

        qs = (
            MoodEntry.objects.filter(user=request.user)
            .only("id", "timestamp", "mood", "anxiety")
            .order_by("timestamp")
        )
        if params.get("period"):
            qs = filter_by_period(qs, params["period"])
        else:
            qs = filter_by_calendar(qs, params["year"], params.get("month"))

        return Response(MoodEntryChartSerializer(qs, many=True).data)

    @action(
        detail=False,
        methods=["get"],
        url_path="snapshot",
        throttle_classes=[SnapshotRateThrottle],
    )
    def snapshot(self, request: Request) -> Response:
        """Вся история со всеми полями — для сборки ссылки врачу.

        Единственное место, где выдача не ограничена периодом: снапшот по
        смыслу содержит весь дневник, иначе врач увидит обрывок. Поэтому у
        эндпоинта отдельный лимит частоты, а результат не кэшируется —
        ссылку создают редко, а держать в Redis полную историю дорого.
        """
        entries = (
            MoodEntry.objects.filter(user=request.user)
            .only("mood", "note", "anxiety", "timestamp")
            .order_by("timestamp")
        )
        logger.info("Snapshot built by user_id=%d", request.user.id)
        return Response(MoodEntrySnapshotSerializer(entries, many=True).data)

    @action(detail=False, methods=["get"], url_path="date-range")
    @entries_cache.cache_response()
    def date_range(self, request: Request) -> Response:
        """Дата первой записи: по ней клиент строит список доступных лет."""
        first = get_first_entry_timestamp(request.user.id)
        return Response(
            {"first_date": first.date().isoformat() if first else None}
        )

    @action(detail=False, methods=["get"], url_path="grouped")
    @entries_cache.cache_response(key_params=("before",))
    def grouped(self, request: Request) -> Response:
        """Лента записей по дням. Курсор ?before=YYYY-MM-DD."""
        filters = GroupedFilterSerializer(data=request.query_params)
        filters.is_valid(raise_exception=True)

        days, has_next = fetch_date_page(
            request.user.id, filters.validated_data.get("before")
        )
        if not days:
            return Response({"results": {}, "next_before": None})

        entries = fetch_entries_for_days(request.user.id, days)
        serializer = MoodEntryReadSerializer(entries, many=True)

        return Response(
            {
                "results": group_entries_by_day(serializer.data),
                "next_before": days[-1].isoformat() if has_next else None,
            }
        )

    def perform_create(self, serializer: MoodEntryWriteSerializer) -> None:
        serializer.save(user=self.request.user)
        entries_cache.invalidate_on_commit(self.request.user.id)
        logger.info("Entry created by user_id=%d", self.request.user.id)

    def perform_update(self, serializer: MoodEntryWriteSerializer) -> None:
        serializer.save()
        entries_cache.invalidate_on_commit(self.request.user.id)
        logger.info(
            "Entry id=%d updated by user_id=%d",
            serializer.instance.id,
            self.request.user.id,
        )

    def perform_destroy(self, instance: MoodEntry) -> None:
        user_id = instance.user_id
        entry_id = instance.id
        instance.delete()
        entries_cache.invalidate_on_commit(user_id)
        logger.info("Entry id=%d deleted by user_id=%d", entry_id, user_id)


class TagViewSet(viewsets.ModelViewSet):
    """CRUD тегов текущего пользователя.

    Удаление тега не трогает записи: пропадает только связь с ними.
    """

    serializer_class = TagSerializer

    def get_queryset(self):
        return Tag.objects.filter(user=self.request.user)

    def perform_create(self, serializer: TagSerializer) -> None:
        serializer.save(user=self.request.user)
        # Теги входят в ответ grouped, поэтому кэш записей тоже устарел.
        entries_cache.invalidate_on_commit(self.request.user.id)

    def perform_update(self, serializer: TagSerializer) -> None:
        serializer.save()
        entries_cache.invalidate_on_commit(self.request.user.id)

    def perform_destroy(self, instance: Tag) -> None:
        user_id = instance.user_id
        instance.delete()
        entries_cache.invalidate_on_commit(user_id)
