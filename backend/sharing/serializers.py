from __future__ import annotations

from rest_framework import serializers

from .constants import SHARE_BLOB_MAX_LENGTH


class CreateShareSerializer(serializers.Serializer):
    """Снапшот записей для врача.

    Флага is_encrypted здесь нет намеренно: это состояние сервера
    (settings.ENCRYPTION_ENABLED), а не выбор клиента. Иначе укравший сессию
    мог бы создать ссылку, помеченную как незашифрованная.
    """

    data_blob = serializers.CharField(max_length=SHARE_BLOB_MAX_LENGTH)
