import base64
from unittest.mock import patch

from django.contrib.auth.models import User
from django.contrib.sessions.backends.base import SessionBase
from django.core.cache import cache
from django.db import DatabaseError
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import (
    APIClient,
    APIRequestFactory,
    APITestCase,
)
from rest_framework.throttling import SimpleRateThrottle

from accounts.constants import WRAPPING_KEY_BYTES, WRAPPING_KEY_SESSION_KEY
from accounts.models import UserProfile
from accounts.serializers import LoginSerializer, RegisterSerializer
from accounts.services import (
    authenticate_user,
    generate_wrapping_key,
    store_wrapping_key,
)
from core.exceptions import InvalidCredentials


class RegisterSerializerUsernameTest(TestCase):
    """validate_username — уникальность."""

    def setUp(self):
        self.existing_user = User.objects.create_user(
            username="taken",
            password="Str0ng!Pass99",
        )

    def test_existing_username_rejected(self):
        serializer = RegisterSerializer(
            data={
                "username": "taken",
                "password": "Str0ng!Pass99",
                "encryption_salt": base64.b64encode(b"12345678").decode(),
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("username", serializer.errors)
        self.assertEqual(
            serializer.errors["username"][0],
            "Имя пользователя занято.",
        )

    def test_new_username_accepted(self):
        serializer = RegisterSerializer(
            data={
                "username": "fresh",
                "password": "Str0ng!Pass99",
                "encryption_salt": base64.b64encode(b"12345678").decode(),
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)


class RegisterSerializerSaltTest(TestCase):
    """validate_encryption_salt — формат base64 и длина >= 8 байт."""

    VALID_PAYLOAD = {
        "username": "saltuser",
        "password": "Str0ng!Pass99",
    }

    def _make(self, salt: str) -> RegisterSerializer:
        return RegisterSerializer(
            data={**self.VALID_PAYLOAD, "encryption_salt": salt}
        )

    def test_valid_base64_salt_8_bytes(self):
        s = self._make(base64.b64encode(b"12345678").decode())
        self.assertTrue(s.is_valid(), s.errors)

    def test_valid_base64_salt_longer(self):
        s = self._make(base64.b64encode(b"a" * 32).decode())
        self.assertTrue(s.is_valid(), s.errors)

    def test_invalid_base64_string(self):
        s = self._make("not_base64!!")
        self.assertFalse(s.is_valid())
        self.assertIn("encryption_salt", s.errors)

    def test_salt_too_short_7_bytes(self):
        s = self._make(base64.b64encode(b"1234567").decode())
        self.assertFalse(s.is_valid())
        self.assertIn("encryption_salt", s.errors)

    def test_salt_exactly_8_bytes(self):
        s = self._make(base64.b64encode(b"12345678").decode())
        self.assertTrue(s.is_valid(), s.errors)


class RegisterSerializerBlankSaltTest(TestCase):
    """Пустой salt допустим только при выключенном шифровании."""

    PAYLOAD = {"username": "nosalt", "password": "Str0ng!Pass99"}

    @override_settings(ENCRYPTION_ENABLED=False)
    def test_blank_salt_accepted_when_encryption_off(self):
        s = RegisterSerializer(data={**self.PAYLOAD, "encryption_salt": ""})
        self.assertTrue(s.is_valid(), s.errors)
        user = s.save()
        self.assertEqual(user.profile.encryption_salt, "")

    @override_settings(ENCRYPTION_ENABLED=False)
    def test_missing_salt_accepted_when_encryption_off(self):
        s = RegisterSerializer(data=self.PAYLOAD)
        self.assertTrue(s.is_valid(), s.errors)

    @override_settings(ENCRYPTION_ENABLED=True)
    def test_blank_salt_rejected_when_encryption_on(self):
        s = RegisterSerializer(data={**self.PAYLOAD, "encryption_salt": ""})
        self.assertFalse(s.is_valid())
        self.assertIn("encryption_salt", s.errors)

    @override_settings(ENCRYPTION_ENABLED=True)
    def test_missing_salt_rejected_when_encryption_on(self):
        s = RegisterSerializer(data=self.PAYLOAD)
        self.assertFalse(s.is_valid())
        self.assertIn("encryption_salt", s.errors)


class RegisterSerializerCreateTest(TestCase):
    """create — атомарность: User + UserProfile."""

    def test_creates_user_and_profile(self):
        serializer = RegisterSerializer(
            data={
                "username": "newguy",
                "password": "Str0ng!Pass99",
                "encryption_salt": base64.b64encode(b"12345678").decode(),
            }
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        self.assertIsInstance(user, User)
        self.assertTrue(UserProfile.objects.filter(user=user).exists())

    @patch(
        "accounts.services.UserProfile.objects.create",
        side_effect=DatabaseError("DB error"),
    )
    def test_profile_failure_rolls_back_user(self, _mock):
        """transaction.atomic откатывает User если Profile не создался."""
        serializer = RegisterSerializer(
            data={
                "username": "orphan",
                "password": "Str0ng!Pass99",
                "encryption_salt": base64.b64encode(b"12345678").decode(),
            }
        )
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(DatabaseError):
            serializer.save()
        # Оба откатились
        self.assertFalse(User.objects.filter(username="orphan").exists())
        self.assertFalse(
            UserProfile.objects.filter(user__username="orphan").exists(),
        )


# ---------------------------------------------------------------------------
#  LoginSerializer
# ---------------------------------------------------------------------------
class LoginSerializerTest(TestCase):
    """Сериализатор проверяет только форму запроса."""

    def test_both_fields_required(self):
        s = LoginSerializer(data={"username": "alice"})
        self.assertFalse(s.is_valid())
        self.assertIn("password", s.errors)

    def test_valid_shape_passes(self):
        s = LoginSerializer(data={"username": "alice", "password": "any"})
        self.assertTrue(s.is_valid(), s.errors)


class AuthenticateUserTest(TestCase):
    """authenticate_user — проверка учётных данных и статуса аккаунта."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="alice",
            password="Str0ng!Pass99",
        )

    def test_valid_credentials(self):
        user = authenticate_user(username="alice", password="Str0ng!Pass99")
        self.assertEqual(user, self.user)

    def test_wrong_password(self):
        with self.assertRaises(InvalidCredentials):
            authenticate_user(username="alice", password="wrong")

    def test_nonexistent_user(self):
        with self.assertRaises(InvalidCredentials):
            authenticate_user(username="ghost", password="any")

    def test_inactive_user(self):
        self.user.is_active = False
        self.user.save()
        with self.assertRaises(InvalidCredentials):
            authenticate_user(username="alice", password="Str0ng!Pass99")


# ---------------------------------------------------------------------------
#  Helper functions: generate_wrapping_key, store_wrapping_key
# ---------------------------------------------------------------------------
class GenerateWrappingKeyTest(TestCase):
    """generate_wrapping_key — формат, длина, уникальность."""

    def test_returns_valid_base64(self):
        key = generate_wrapping_key()
        raw = base64.b64decode(key)
        self.assertEqual(len(raw), WRAPPING_KEY_BYTES)

    def test_two_calls_produce_different_keys(self):
        self.assertNotEqual(generate_wrapping_key(), generate_wrapping_key())


class StoreWrappingKeyTest(TestCase):
    """store_wrapping_key — сохранение в сессию."""

    def test_key_stored_in_session(self):
        factory = APIRequestFactory()
        request = factory.get("/fake/")
        request.session = SessionBase()
        request.session.save = lambda: None

        key = store_wrapping_key(request)

        self.assertIn(WRAPPING_KEY_SESSION_KEY, request.session)
        self.assertEqual(request.session[WRAPPING_KEY_SESSION_KEY], key)
        raw = base64.b64decode(key)
        self.assertEqual(len(raw), WRAPPING_KEY_BYTES)


# ---------------------------------------------------------------------------
#  UnwrapKeyView
# ---------------------------------------------------------------------------
class UnwrapKeyViewTest(APITestCase):
    """GET /api/auth/unwrap-key/ — ключ есть / нет в сессии."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="bob",
            password="Str0ng!Pass99",
        )
        self.client.force_login(self.user)

    def test_key_present_returns_200(self):
        session = self.client.session
        session[WRAPPING_KEY_SESSION_KEY] = "dGVzdGtleQ=="
        session.save()

        resp = self.client.get("/api/auth/unwrap-key/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["wrapping_key"], "dGVzdGtleQ==")

    def test_key_missing_returns_401(self):
        resp = self.client.get("/api/auth/unwrap-key/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_anonymous_returns_403(self):
        self.client.logout()
        resp = self.client.get("/api/auth/unwrap-key/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ---------------------------------------------------------------------------
#  Троттлинг и CSRF на входе
# ---------------------------------------------------------------------------
@patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"auth": "3/minute"})
class AuthThrottleTest(APITestCase):
    """Перебор паролей ограничен по частоте.

    Ставки патчатся напрямую в классе: DRF читает DEFAULT_THROTTLE_RATES один
    раз при импорте и кладёт в атрибут класса, поэтому override_settings
    на них не влияет.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="throttled", password="Str0ng!Pass99"
        )

    def test_login_attempts_are_limited(self):
        payload = {"username": "throttled", "password": "wrong"}
        for _ in range(3):
            resp = self.client.post("/api/auth/login/", payload, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        resp = self.client.post("/api/auth/login/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(resp.data["error"]["code"], "rate_limited")

    def test_registration_attempts_are_limited(self):
        """Считаются и неудачные попытки: лимит проверяется до валидации."""
        payload = {"username": "", "password": "short"}
        for _ in range(3):
            resp = self.client.post(
                "/api/auth/register/", payload, format="json"
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        resp = self.client.post("/api/auth/register/", payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)


class CsrfProtectionTest(APITestCase):
    """Вход и регистрация защищены от login CSRF.

    SessionAuthentication проверяет токен только для уже аутентифицированных
    запросов, поэтому на анонимных эндпоинтах он навешен явно.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)
        User.objects.create_user(
            username="csrf_user", password="Str0ng!Pass99"
        )

    def test_login_without_token_rejected(self):
        resp = self.client.post(
            "/api/auth/login/",
            {"username": "csrf_user", "password": "Str0ng!Pass99"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resp.data["error"]["code"], "csrf_failed")

    def test_register_without_token_rejected(self):
        resp = self.client.post(
            "/api/auth/register/",
            {
                "username": "newbie",
                "password": "Str0ng!Pass99",
                "encryption_salt": base64.b64encode(b"12345678").decode(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_login_with_token_passes(self):
        """Токен фронтенд получает из GET /api/config/."""
        self.client.get("/api/config/")
        token = self.client.cookies["csrftoken"].value

        resp = self.client.post(
            "/api/auth/login/",
            {"username": "csrf_user", "password": "Str0ng!Pass99"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
