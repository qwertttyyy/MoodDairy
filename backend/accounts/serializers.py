from __future__ import annotations

import base64
import binascii

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .constants import MIN_SALT_BYTES
from .models import UserProfile
from .services import register_user

User = get_user_model()


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    # При ENCRYPTION_ENABLED=0 клиент не шифрует данные и соль ему не нужна,
    # поэтому пустое значение допустимо (см. validate_encryption_salt).
    encryption_salt = serializers.CharField(
        max_length=64,
        allow_blank=True,
        default="",
    )

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Имя пользователя занято.")
        return value

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def validate_encryption_salt(self, value: str) -> str:
        if not value:
            if settings.ENCRYPTION_ENABLED:
                raise serializers.ValidationError(
                    "Salt обязателен при включённом шифровании.",
                )
            return ""

        # validate=True обязателен: без него b64decode молча отбрасывает
        # символы вне алфавита и пропускает мусор вроде "abcd!!!!".
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise serializers.ValidationError(
                "Некорректный base64 salt."
            ) from exc

        if len(decoded) < MIN_SALT_BYTES:
            raise serializers.ValidationError(
                f"Salt короче {MIN_SALT_BYTES} байт."
            )
        return value

    def create(self, validated_data: dict) -> User:
        return register_user(
            username=validated_data["username"],
            password=validated_data["password"],
            encryption_salt=validated_data["encryption_salt"],
        )


class LoginSerializer(serializers.Serializer):
    """Только форма запроса. Проверку учётных данных делает сервис."""

    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username")
        read_only_fields = ("id", "username")


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ("encryption_salt",)
        read_only_fields = ("encryption_salt",)
