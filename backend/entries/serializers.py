from __future__ import annotations

from django.utils import timezone
from rest_framework import serializers

from .fields import EncryptedField
from .models import MoodEntry, Tag


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ("id", "name")
        read_only_fields = ("id", "name")


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
    """Запись — mood/note/anxiety как зашифрованные строки, теги как список id."""

    mood = EncryptedField()
    note = EncryptedField(required=False, allow_blank=True)
    anxiety = EncryptedField(required=False, allow_blank=True)
    tags = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(),
        many=True,
        required=False,
    )

    def validate_timestamp(self, value):
        if value > timezone.now():
            raise serializers.ValidationError("Дата не может быть в будущем.")
        return value

    def create(self, validated_data: dict) -> MoodEntry:
        tags = validated_data.pop("tags", [])
        entry = MoodEntry.objects.create(**validated_data)
        if tags:
            entry.tags.set(tags)
        return entry

    def update(self, instance: MoodEntry, validated_data: dict) -> MoodEntry:
        tags = validated_data.pop("tags", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if tags is not None:
            instance.tags.set(tags)
        return instance
