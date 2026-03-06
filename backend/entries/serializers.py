from __future__ import annotations

import base64

from django.utils import timezone
from rest_framework import serializers

from .models import MoodEntry, Tag


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ("id", "name")
        read_only_fields = ("id", "name")


def _validate_encrypted_field(value: str) -> str:
    """Проверяет формат iv:ciphertext (оба — валидный base64)."""
    if not value:
        return value
    parts = value.split(":", 1)
    if len(parts) != 2:
        raise serializers.ValidationError("Ожидается формат iv:ciphertext.")
    for part in parts:
        try:
            base64.b64decode(part)
        except Exception:
            raise serializers.ValidationError("Некорректный base64.")
    return value


class MoodEntryReadSerializer(serializers.ModelSerializer):
    """Чтение — теги как вложенные объекты."""

    tags = TagSerializer(many=True, read_only=True)

    class Meta:
        model = MoodEntry
        fields = (
            "id",
            "mood",
            "note",
            "tags",
            "timestamp",
            "created_at",
            "updated_at",
        )


class MoodEntryWriteSerializer(serializers.ModelSerializer):
    """Запись — mood/note как зашифрованные строки, теги как список id."""

    tags = serializers.PrimaryKeyRelatedField(
        queryset=Tag.objects.all(),
        many=True,
        required=False,
    )

    class Meta:
        model = MoodEntry
        fields = (
            "id",
            "mood",
            "note",
            "tags",
            "timestamp",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_mood(self, value: str) -> str:
        return _validate_encrypted_field(value)

    def validate_note(self, value: str) -> str:
        if not value:
            return value
        return _validate_encrypted_field(value)

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
