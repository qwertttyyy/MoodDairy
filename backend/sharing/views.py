from __future__ import annotations

import logging

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.exceptions import Gone

from .models import SharedAccess
from .serializers import CreateShareSerializer
from .services import create_or_update_share, get_active_share, revoke_share

logger = logging.getLogger("sharing")


class ShareView(APIView):
    """Управление ссылкой для врача.

    GET — метаданные активной ссылки, POST — создать или заменить,
    DELETE — отозвать.
    """

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        """Возвращает метаданные активной ссылки текущего пользователя."""
        share = get_active_share(request.user)
        if not share:
            return Response({"active": False})
        return Response(
            {
                "active": True,
                "token": share.token,
                "created_at": share.created_at.isoformat(),
                "is_encrypted": share.is_encrypted,
            }
        )

    def post(self, request: Request) -> Response:
        """Создаёт или заменяет ссылку из переданного снапшота."""
        serializer = CreateShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        share = create_or_update_share(
            user=request.user,
            data_blob=serializer.validated_data["data_blob"],
        )
        logger.info(
            "Share created by user_id=%d, token=%s",
            request.user.id,
            share.token[:8],
        )
        return Response({"token": share.token}, status=status.HTTP_201_CREATED)

    def delete(self, request: Request) -> Response:
        """Отзывает ссылку текущего пользователя, если она существует."""
        if revoke_share(request.user):
            logger.info("Share revoked by user_id=%d", request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ShareDataView(APIView):
    """Публичный эндпоинт: отдаёт блоб по токену."""

    permission_classes = (AllowAny,)
    authentication_classes = []
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "share"

    def get(self, request: Request, token: str) -> Response:
        """Возвращает данные активной публичной ссылки по токену."""
        share = get_object_or_404(SharedAccess, token=token)
        if not share.is_valid:
            raise Gone()
        return Response(
            {
                "data_blob": share.data_blob,
                "is_encrypted": share.is_encrypted,
            }
        )
