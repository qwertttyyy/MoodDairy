from __future__ import annotations

from rest_framework import serializers

from .constants import SHARE_BLOB_MAX_LENGTH


class CreateShareSerializer(serializers.Serializer):
    """Проверяет блоб снапшота для создания ссылки врачу."""

    data_blob = serializers.CharField(max_length=SHARE_BLOB_MAX_LENGTH)
