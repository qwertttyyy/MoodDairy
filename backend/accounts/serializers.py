from __future__ import annotations

import base64

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import UserProfile


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    encryption_salt = serializers.CharField(max_length=64)

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Имя пользователя занято.")
        return value

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def validate_encryption_salt(self, value: str) -> str:
        try:
            decoded = base64.b64decode(value)
            if len(decoded) < 8:
                raise ValueError
        except Exception:
            raise serializers.ValidationError("Некорректный base64 salt.")
        return value

    def create(self, validated_data: dict) -> User:
        user = User.objects.create_user(
            username=validated_data["username"],
            password=validated_data["password"],
        )
        UserProfile.objects.create(
            user=user,
            encryption_salt=validated_data["encryption_salt"],
        )
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs: dict) -> dict:
        user = authenticate(
            username=attrs["username"],
            password=attrs["password"],
        )
        if user is None:
            raise serializers.ValidationError("Неверный логин или пароль.")
        if not user.is_active:
            raise serializers.ValidationError("Аккаунт деактивирован.")
        attrs["user"] = user
        return attrs


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
