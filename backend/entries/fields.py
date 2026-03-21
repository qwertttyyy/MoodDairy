from __future__ import annotations

import base64

from rest_framework import serializers


def validate_encrypted_value(value: str) -> str:
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


class EncryptedField(serializers.CharField):
    """CharField с валидацией формата iv:ciphertext.

    Используется для полей, зашифрованных на клиенте (mood, note, anxiety).
    """

    def to_internal_value(self, data: str) -> str:
        value = super().to_internal_value(data)
        return validate_encrypted_value(value)
