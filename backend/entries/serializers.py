from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .constants import (
    ANXIETY_MAX_LENGTH,
    MAX_YEAR,
    MIN_YEAR,
    MOOD_MAX_LENGTH,
    NOTE_MAX_LENGTH,
    PERIOD_DAYS,
)
from .fields import EncryptedField
from .models import MoodEntry, Tag


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ("id", "name")
        read_only_fields = ("id",)

    def validate_name(self, value: str) -> str:
        """Имя уникально в пределах пользователя.

        В БД это гарантирует UniqueConstraint, но проверка здесь даёт
        понятное сообщение вместо ошибки о конфликте данных.
        """
        user = self.context["request"].user
        duplicates = Tag.objects.filter(user=user, name=value)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(
                "Тег с таким названием уже есть."
            )
        return value


class UserTagsRelatedField(serializers.PrimaryKeyRelatedField):
    """Разрешает привязывать к записи только собственные теги.

    Без ограничения queryset пользователь мог бы указать чужой id и прочитать
    название чужого тега в ответе.
    """

    def get_queryset(self):
        return Tag.objects.filter(user=self.context["request"].user)


class _MoodEntryBaseSerializer(serializers.ModelSerializer):
    """Базовый класс — единый набор полей для Read и Write."""

    class Meta:
        model = MoodEntry
        fields = (
            "id",
            "mood",
            "note",
            "anxiety",
            "tags",
            "timestamp",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class MoodEntryReadSerializer(_MoodEntryBaseSerializer):
    """Чтение — теги как вложенные объекты."""

    tags = TagSerializer(many=True, read_only=True)


class MoodEntryWriteSerializer(_MoodEntryBaseSerializer):
    """Запись — зашифрованные поля строками, теги списком id.

    Сохранение делает ModelSerializer: связь many-to-many он обрабатывает сам.
    """

    mood = EncryptedField(max_length=MOOD_MAX_LENGTH)
    note = EncryptedField(
        max_length=NOTE_MAX_LENGTH, required=False, allow_blank=True
    )
    anxiety = EncryptedField(
        max_length=ANXIETY_MAX_LENGTH, required=False, allow_blank=True
    )
    tags = UserTagsRelatedField(many=True, required=False)

    def validate_timestamp(self, value):
        if value > timezone.now():
            raise serializers.ValidationError("Дата не может быть в будущем.")
        return value


class MoodEntryChartSerializer(serializers.ModelSerializer):
    """Минимум полей для графиков: без заметок, тегов и служебных дат.

    Заметки в графике не участвуют, а весят больше всего остального вместе
    взятого — и в ответе, и в кэше.
    """

    class Meta:
        model = MoodEntry
        fields = ("id", "timestamp", "mood", "anxiety")


class MoodEntrySnapshotSerializer(serializers.ModelSerializer):
    """Полная запись для снапшота врачу: без id, тегов и служебных дат.

    Снапшот расшифровывается на клиенте и перешифровывается ключом ссылки,
    поэтому в него входит ровно то, что увидит врач.
    """

    class Meta:
        model = MoodEntry
        fields = ("mood", "note", "anxiety", "timestamp")


class ChartFilterSerializer(serializers.Serializer):
    """Период выборки для графиков.

    Период обязателен: без него запрос вернул бы всю историю пользователя
    одним ответом, который потом ещё и осядет в кэше целиком.
    """

    period = serializers.ChoiceField(
        choices=sorted(PERIOD_DAYS), required=False
    )
    year = serializers.IntegerField(
        min_value=MIN_YEAR, max_value=MAX_YEAR, required=False
    )
    month = serializers.IntegerField(min_value=1, max_value=12, required=False)

    def validate(self, attrs: dict) -> dict:
        period, year, month = (
            attrs.get("period"),
            attrs.get("year"),
            attrs.get("month"),
        )
        if period and year:
            raise serializers.ValidationError(
                "Укажите либо period, либо year (с month) — но не оба сразу."
            )
        if not period and not year:
            periods = "|".join(sorted(PERIOD_DAYS))
            raise serializers.ValidationError(
                f"Укажите период: period={periods} либо year (и month)."
            )
        if month and not year:
            raise serializers.ValidationError(
                "Параметр month указывается только вместе с year."
            )
        return attrs


class GroupedFilterSerializer(serializers.Serializer):
    """Курсор ленты: выдаются записи строго раньше указанной даты."""

    before = serializers.DateField(required=False)
