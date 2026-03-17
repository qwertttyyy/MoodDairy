from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from .constants import SHARED_ACCESS_EXPIRE_HOURS
from .models import SharedAccess


class CreateShareSerializer(serializers.Serializer):
    data_blob = serializers.CharField()
    is_encrypted = serializers.BooleanField(default=True)

    def create(self, validated_data: dict) -> SharedAccess:
        validated_data['expires_at'] = timezone.now() + timedelta(hours=SHARED_ACCESS_EXPIRE_HOURS)
        user = validated_data.pop('user')
        shared, _ = SharedAccess.objects.update_or_create(user=user, defaults=validated_data)
        return shared
