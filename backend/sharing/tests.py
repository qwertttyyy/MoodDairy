from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from sharing.models import SharedAccess, generate_token


# ===================================================================
#  _generate_token
# ===================================================================
class GenerateTokenTest(TestCase):
    """Уникальность генерируемых токенов."""

    def test_two_calls_produce_different_tokens(self):
        self.assertNotEqual(generate_token(), generate_token())

    def test_token_is_nonempty_string(self):
        token = generate_token()
        self.assertIsInstance(token, str)
        self.assertTrue(len(token) > 0)


# ===================================================================
#  SharedAccess model — is_expired, is_valid
# ===================================================================
class SharedAccessIsExpiredTest(TestCase):
    """is_expired — None / прошлое / будущее."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="share_user", password="Str0ng!Pass99"
        )

    def _make(self, expires_at=None, **kwargs):
        return SharedAccess.objects.create(
            user=self.user,
            data_blob="test_blob",
            expires_at=expires_at,
            **kwargs,
        )

    def test_no_expiry_not_expired(self):
        share = self._make(expires_at=None)
        self.assertFalse(share.is_expired)

    def test_past_expiry_is_expired(self):
        share = self._make(expires_at=timezone.now() - timedelta(hours=1))
        self.assertTrue(share.is_expired)

    def test_future_expiry_not_expired(self):
        share = self._make(expires_at=timezone.now() + timedelta(hours=1))
        self.assertFalse(share.is_expired)


class SharedAccessIsValidTest(TestCase):
    """is_valid — комбинации is_active и is_expired."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="valid_user", password="Str0ng!Pass99"
        )

    def _make(self, is_active=True, expires_at=None):
        return SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=is_active,
            expires_at=expires_at,
        )

    def test_active_no_expiry_is_valid(self):
        share = self._make(is_active=True, expires_at=None)
        self.assertTrue(share.is_valid)

    def test_inactive_is_not_valid(self):
        share = self._make(is_active=False)
        self.assertFalse(share.is_valid)

    def test_active_but_expired_is_not_valid(self):
        share = self._make(
            is_active=True,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        self.assertFalse(share.is_valid)

    def test_active_not_expired_is_valid(self):
        share = self._make(
            is_active=True,
            expires_at=timezone.now() + timedelta(days=7),
        )
        self.assertTrue(share.is_valid)


# ===================================================================
#  ShareDataView (публичный endpoint)
# ===================================================================
class ShareDataViewTest(APITestCase):
    """GET /api/sharing/{token}/data/ — валидная / невалидная ссылка."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="data_user", password="Str0ng!Pass99"
        )

    def test_valid_share_returns_200(self):
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob='{"entries": []}',
            is_active=True,
        )
        resp = self.client.get(f"/api/sharing/{share.token}/data/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["data_blob"], '{"entries": []}')
        self.assertIn("is_encrypted", resp.data)

    def test_inactive_share_returns_410(self):
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=False,
        )
        resp = self.client.get(f"/api/sharing/{share.token}/data/")
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)

    def test_expired_share_returns_410(self):
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=True,
            expires_at=timezone.now() - timedelta(hours=1),
        )
        resp = self.client.get(f"/api/sharing/{share.token}/data/")
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)

    def test_nonexistent_token_returns_404(self):
        resp = self.client.get("/api/sharing/nonexistent_token/data/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ===================================================================
#  ShareView — GET / POST / DELETE (authenticated)
# ===================================================================
class ShareViewTest(APITestCase):
    """CRUD для sharing: создание, получение статуса, отзыв."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="sharer", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_get_no_active_share(self):
        resp = self.client.get("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["active"])

    def test_post_creates_share(self):
        resp = self.client.post(
            "/api/sharing/",
            {"data_blob": "encrypted_data", "is_encrypted": True},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("token", resp.data)
        self.assertTrue(
            SharedAccess.objects.filter(
                user=self.user, is_active=True
            ).exists()
        )

    def test_post_deactivates_previous_share(self):
        """Новая созданная ссылка активна"""
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob="share",
            is_active=False,
        )
        self.client.post(
            "/api/sharing/",
            {"data_blob": "new_data", "is_encrypted": True},
            format="json",
        )
        share.refresh_from_db()
        self.assertTrue(share.is_active)

    def test_get_active_share_returns_metadata(self):
        SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=True,
        )
        resp = self.client.get("/api/sharing/")
        self.assertTrue(resp.data["active"])
        self.assertIn("token", resp.data)
        self.assertIn("created_at", resp.data)

    def test_delete_revokes_share(self):
        SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=True,
        )
        resp = self.client.delete("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(
            SharedAccess.objects.filter(
                user=self.user, is_active=True
            ).exists(),
        )

    def test_delete_no_active_returns_204(self):
        resp = self.client.delete("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_anonymous_cannot_manage_shares(self):
        self.client.logout()
        resp = self.client.get("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
