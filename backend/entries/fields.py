from __future__ import annotations

import base64
import binascii

from django.conf import settings
from rest_framework import serializers

ENCRYPTED_PARTS = 2


def validate_encrypted_value(value: str) -> str:
    """Проверяет формат `iv:ciphertext` при включённом шифровании."""
    if not value or not settings.ENCRYPTION_ENABLED:
        return value

    parts = value.split(":", 1)
    if len(parts) != ENCRYPTED_PARTS:
        raise serializers.ValidationError("Ожидается формат iv:ciphertext.")

    for part in parts:
        # validate=True запрещает декодеру игнорировать посторонние символы.
        try:
            base64.b64decode(part, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise serializers.ValidationError("Некорректный base64.") from exc
    return value


class EncryptedField(serializers.CharField):
    """CharField с валидацией формата iv:ciphertext.

    Используется для полей, зашифрованных на клиенте (mood, note, anxiety).
    """

    def to_internal_value(self, data: str) -> str:
        """Преобразует строку и проверяет формат клиентского шифротекста."""
        value = super().to_internal_value(data)
        return validate_encrypted_value(value)
