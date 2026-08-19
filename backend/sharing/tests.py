from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from sharing.constants import SHARE_BLOB_MAX_LENGTH
from sharing.models import SharedAccess, generate_token


class GenerateTokenTest(TestCase):
    """Уникальность генерируемых токенов."""

    def test_two_calls_produce_different_tokens(self):
        """Проверяет случайность двух сгенерированных токенов."""
        self.assertNotEqual(generate_token(), generate_token())

    def test_token_is_nonempty_string(self):
        """Проверяет непустое строковое представление токена."""
        token = generate_token()
        self.assertIsInstance(token, str)
        self.assertTrue(len(token) > 0)


class SharedAccessIsExpiredTest(TestCase):
    """is_expired — None / прошлое / будущее."""

    def setUp(self):
        """Создаёт владельца ссылок для тестов."""
        self.user = User.objects.create_user(
            username="share_user", password="Str0ng!Pass99"
        )

    def _make(self, expires_at=None, **kwargs):
        """Создаёт ссылку с переданными параметрами срока действия."""
        return SharedAccess.objects.create(
            user=self.user,
            data_blob="test_blob",
            expires_at=expires_at,
            **kwargs,
        )

    def test_no_expiry_not_expired(self):
        """Проверяет бессрочную ссылку."""
        share = self._make(expires_at=None)
        self.assertFalse(share.is_expired)

    def test_past_expiry_is_expired(self):
        """Проверяет ссылку с истёкшим сроком."""
        share = self._make(expires_at=timezone.now() - timedelta(hours=1))
        self.assertTrue(share.is_expired)

    def test_future_expiry_not_expired(self):
        """Проверяет ссылку с будущим сроком действия."""
        share = self._make(expires_at=timezone.now() + timedelta(hours=1))
        self.assertFalse(share.is_expired)


class SharedAccessIsValidTest(TestCase):
    """is_valid — комбинации is_active и is_expired."""

    def setUp(self):
        """Создаёт владельца ссылок для проверки валидности."""
        self.user = User.objects.create_user(
            username="valid_user", password="Str0ng!Pass99"
        )

    def _make(self, is_active=True, expires_at=None):
        """Создаёт ссылку с переданными состоянием и сроком."""
        return SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=is_active,
            expires_at=expires_at,
        )

    def test_active_no_expiry_is_valid(self):
        """Проверяет активную бессрочную ссылку."""
        share = self._make(is_active=True, expires_at=None)
        self.assertTrue(share.is_valid)

    def test_inactive_is_not_valid(self):
        """Проверяет невалидность деактивированной ссылки."""
        share = self._make(is_active=False)
        self.assertFalse(share.is_valid)

    def test_active_but_expired_is_not_valid(self):
        """Проверяет невалидность активной, но истёкшей ссылки."""
        share = self._make(
            is_active=True,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        self.assertFalse(share.is_valid)

    def test_active_not_expired_is_valid(self):
        """Проверяет активную ссылку с будущим сроком."""
        share = self._make(
            is_active=True,
            expires_at=timezone.now() + timedelta(days=7),
        )
        self.assertTrue(share.is_valid)


class ShareDataViewTest(APITestCase):
    """GET /api/sharing/{token}/data/ — валидная / невалидная ссылка."""

    def setUp(self):
        """Создаёт владельца публичной ссылки."""
        self.user = User.objects.create_user(
            username="data_user", password="Str0ng!Pass99"
        )

    def test_valid_share_returns_200(self):
        """Проверяет выдачу данных действующей ссылки."""
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
        """Проверяет статус неактивной ссылки."""
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=False,
        )
        resp = self.client.get(f"/api/sharing/{share.token}/data/")
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)

    def test_expired_share_returns_410(self):
        """Проверяет статус ссылки с истёкшим сроком."""
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=True,
            expires_at=timezone.now() - timedelta(hours=1),
        )
        resp = self.client.get(f"/api/sharing/{share.token}/data/")
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)

    def test_nonexistent_token_returns_404(self):
        """Проверяет ответ для неизвестного токена."""
        resp = self.client.get("/api/sharing/nonexistent_token/data/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class ShareViewTest(APITestCase):
    """CRUD для sharing: создание, получение статуса, отзыв."""

    def setUp(self):
        """Создаёт и аутентифицирует владельца ссылки."""
        self.user = User.objects.create_user(
            username="sharer", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_get_no_active_share(self):
        """Проверяет ответ без активной ссылки."""
        resp = self.client.get("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["active"])

    def test_post_creates_share(self):
        """Проверяет создание ссылки из переданного блоба."""
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

    def test_post_replaces_share_and_rotates_token(self):
        """Повторный POST заменяет блоб и делает старый токен нерабочим."""
        share = SharedAccess.objects.create(
            user=self.user,
            data_blob="share",
            is_active=False,
        )
        old_token = share.token

        self.client.post(
            "/api/sharing/",
            {"data_blob": "new_data"},
            format="json",
        )

        share.refresh_from_db()
        self.assertTrue(share.is_active)
        self.assertEqual(share.data_blob, "new_data")
        self.assertNotEqual(share.token, old_token)

        stale = self.client.get(f"/api/sharing/{old_token}/data/")
        self.assertEqual(stale.status_code, status.HTTP_404_NOT_FOUND)

    def test_is_encrypted_comes_from_settings_not_client(self):
        """Клиент не может пометить блоб как незашифрованный."""
        resp = self.client.post(
            "/api/sharing/",
            {"data_blob": "encrypted_data", "is_encrypted": False},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        share = SharedAccess.objects.get(user=self.user)
        self.assertTrue(share.is_encrypted)

    def test_blob_size_is_limited(self):
        """Без ограничения один пользователь мог бы занять всю память кэша."""
        resp = self.client.post(
            "/api/sharing/",
            {"data_blob": "x" * (SHARE_BLOB_MAX_LENGTH + 1)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("data_blob", resp.data["error"]["fields"])

    def test_get_active_share_returns_metadata(self):
        """Проверяет метаданные действующей ссылки."""
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
        """Проверяет отзыв действующей ссылки."""
        SharedAccess.objects.create(
            user=self.user,
            data_blob="blob",
            is_active=True,
        )
        resp = self.client.delete("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(
            SharedAccess.objects.filter(
                user=self.user, is_active=True
            ).exists(),
        )

    def test_delete_is_idempotent(self):
        """Отзыв несуществующей ссылки — не ошибка, результат тот же."""
        resp = self.client.delete("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

    def test_anonymous_cannot_manage_shares(self):
        """Проверяет запрет управления ссылками для анонима."""
        self.client.logout()
        resp = self.client.get("/api/sharing/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class CleanupSharesCommandTest(TestCase):
    """Отработавшие ссылки удаляются, действующие остаются."""

    def setUp(self):
        """Задаёт дату старых ссылок."""
        self.old = timezone.now() - timedelta(days=30)

    def _make(self, username, **kwargs):
        """Создаёт ссылку с искусственно старой датой создания."""
        user = User.objects.create_user(
            username=username, password="Str0ng!Pass99"
        )
        share = SharedAccess.objects.create(
            user=user, data_blob="blob", **kwargs
        )
        SharedAccess.objects.filter(pk=share.pk).update(created_at=self.old)
        return share

    def test_revoked_share_removed(self):
        """Проверяет удаление старой отозванной ссылки."""
        share = self._make("revoked", is_active=False)
        call_command("cleanup_shares")
        self.assertFalse(SharedAccess.objects.filter(pk=share.pk).exists())

    def test_expired_share_removed(self):
        """Проверяет удаление старой истёкшей ссылки."""
        share = self._make(
            "expired", expires_at=timezone.now() - timedelta(hours=1)
        )
        call_command("cleanup_shares")
        self.assertFalse(SharedAccess.objects.filter(pk=share.pk).exists())

    def test_active_share_kept(self):
        """Проверяет сохранение действующей ссылки."""
        share = self._make(
            "active", expires_at=timezone.now() + timedelta(hours=5)
        )
        call_command("cleanup_shares")
        self.assertTrue(SharedAccess.objects.filter(pk=share.pk).exists())

    def test_recent_revoked_share_kept(self):
        """Свежие записи хранятся на случай разбора жалобы."""
        user = User.objects.create_user(
            username="fresh", password="Str0ng!Pass99"
        )
        share = SharedAccess.objects.create(
            user=user, data_blob="blob", is_active=False
        )
        call_command("cleanup_shares")
        self.assertTrue(SharedAccess.objects.filter(pk=share.pk).exists())

    def test_dry_run_deletes_nothing(self):
        """Проверяет отсутствие удаления в режиме dry-run."""
        share = self._make("dry", is_active=False)
        call_command("cleanup_shares", "--dry-run")
        self.assertTrue(SharedAccess.objects.filter(pk=share.pk).exists())
