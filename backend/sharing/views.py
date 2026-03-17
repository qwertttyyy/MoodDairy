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

logger = logging.getLogger("sharing")


class ShareView(APIView):
    """GET — метаданные активной ссылки.
    POST — создать (деактивирует предыдущую).
    DELETE — отозвать."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        share = SharedAccess.objects.filter(
            user=request.user, is_active=True
        ).first()
        if not share or share.is_expired:
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
        share = serializer.save(user=request.user)

        logger.info(
            "Share created by user_id=%d, token=%s",
            request.user.id,
            share.token[:8],
        )
        return Response({"token": share.token}, status=status.HTTP_201_CREATED)

    def delete(self, request: Request) -> Response:
        try:
            shared = request.user.shared_access
        except SharedAccess.DoesNotExist:
            return Response(
                {"detail": "Ссылки нет, создайте новую"},
                status=status.HTTP_204_NO_CONTENT,
            )
        shared.is_active = False
        shared.save(update_fields=["is_active"])
        logger.info("Share inactivated by user_id=%d", request.user.id)
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
