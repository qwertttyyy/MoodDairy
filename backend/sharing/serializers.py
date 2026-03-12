from __future__ import annotations

from rest_framework import serializers

from .models import SharedAccess


class CreateShareSerializer(serializers.Serializer):
    data_blob = serializers.CharField()
    is_encrypted = serializers.BooleanField(default=True)

    def create(self, validated_data: dict) -> SharedAccess:
        return SharedAccess.objects.create(**validated_data)
