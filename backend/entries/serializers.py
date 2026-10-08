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
from .fields import EncryptedField, UserTagsRelatedField
from .models import MoodEntry, Tag


class TagSerializer(serializers.ModelSerializer):
    """Сериализует тег и проверяет его уникальность у владельца."""

    class Meta:
        """Описывает поля тега, доступные в API."""

        model = Tag
        fields = ("id", "name")
        read_only_fields = ("id",)

    def validate_name(self, value: str) -> str:
        """Проверяет уникальность имени среди тегов текущего пользователя."""
        user = self.context["request"].user
        duplicates = Tag.objects.filter(user=user, name=value)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(
                "Тег с таким названием уже есть."
            )
        return value


class _MoodEntryBaseSerializer(serializers.ModelSerializer):
    """Базовый класс — единый набор полей для Read и Write."""

    class Meta:
        """Описывает общие поля сериализаторов записи."""

        model = MoodEntry
        fields = (
            "id",
            "mood",
            "note",
            "anxiety",
            "tags",
            "timestamp",
        )


class MoodEntryReadSerializer(_MoodEntryBaseSerializer):
    """Чтение — теги как вложенные объекты."""

    tags = TagSerializer(many=True, read_only=True)


class MoodEntryWriteSerializer(_MoodEntryBaseSerializer):
    """Принимает запись с шифротекстом и идентификаторами тегов."""

    mood = EncryptedField(max_length=MOOD_MAX_LENGTH)
    note = EncryptedField(
        max_length=NOTE_MAX_LENGTH, required=False, allow_blank=True
    )
    anxiety = EncryptedField(
        max_length=ANXIETY_MAX_LENGTH, required=False, allow_blank=True
    )
    tags = UserTagsRelatedField(many=True, required=False)

    def validate_timestamp(self, value):
        """Не допускает дату записи в будущем."""
        if value > timezone.now():
            raise serializers.ValidationError("Дата не может быть в будущем.")
        return value


class MoodEntryChartSerializer(serializers.ModelSerializer):
    """Сериализует поля записи, нужные для построения графика."""

    class Meta:
        """Ограничивает ответ временной меткой и значениями шкал."""

        model = MoodEntry
        fields = ("timestamp", "mood", "anxiety")


class MoodEntrySnapshotSerializer(serializers.ModelSerializer):
    """Сериализует данные записи для передаваемого врачу снапшота."""

    class Meta:
        """Ограничивает снапшот содержимым дневниковой записи."""

        model = MoodEntry
        fields = ("mood", "note", "anxiety", "timestamp")


class ChartFilterSerializer(serializers.Serializer):
    """Проверяет параметры ограниченной выборки записей для графика."""

    period = serializers.ChoiceField(
        choices=sorted(PERIOD_DAYS), required=False
    )
    year = serializers.IntegerField(
        min_value=MIN_YEAR, max_value=MAX_YEAR, required=False
    )
    month = serializers.IntegerField(min_value=1, max_value=12, required=False)

    def validate(self, attrs: dict) -> dict:
        """Проверяет совместимость относительного и календарного периода."""
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
