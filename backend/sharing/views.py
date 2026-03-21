from __future__ import annotations

import logging

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SharedAccess
from .serializers import CreateShareSerializer
from .services import create_or_update_share, get_active_share, revoke_share

logger = logging.getLogger("sharing")


class ShareView(APIView):
    """GET — метаданные активной ссылки.
    POST — создать/обновить.
    DELETE — отозвать."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
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
        serializer = CreateShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        share = create_or_update_share(
            user=request.user,
            data_blob=serializer.validated_data["data_blob"],
            is_encrypted=serializer.validated_data["is_encrypted"],
        )
        logger.info(
            "Share created by user_id=%d, token=%s",
            request.user.id,
            share.token[:8],
        )
        return Response({"token": share.token}, status=status.HTTP_201_CREATED)

    def delete(self, request: Request) -> Response:
        revoked = revoke_share(request.user)
        if not revoked:
            return Response(
                {"detail": "Активной ссылки нет"},
                status=status.HTTP_204_NO_CONTENT,
            )
        logger.info("Share revoked by user_id=%d", request.user.id)
        return Response(status=status.HTTP_200_OK)


class ShareDataView(APIView):
    """Публичный эндпоинт: отдаёт blob по token."""

    permission_classes = (AllowAny,)
    authentication_classes = []

    def get(self, request: Request, token: str) -> Response:
        share = get_object_or_404(SharedAccess, token=token)
        if not share.is_valid:
            return Response(
                {"detail": "Ссылка недействительна"},
                status=status.HTTP_410_GONE,
            )
        return Response(
            {
                "data_blob": share.data_blob,
                "is_encrypted": share.is_encrypted,
            }
        )
