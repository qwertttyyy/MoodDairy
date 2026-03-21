from __future__ import annotations

from rest_framework import serializers


class CreateShareSerializer(serializers.Serializer):
    data_blob = serializers.CharField()
    is_encrypted = serializers.BooleanField(default=True)
