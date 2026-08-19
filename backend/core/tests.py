import json
import logging
import sys
from unittest.mock import patch

from django.contrib.auth.models import AnonymousUser, User
from django.db import OperationalError
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIRequestFactory, APITestCase

from accounts.constants import WRAPPING_KEY_SESSION_KEY
from core.logging_utils import (
    JSONFormatter,
    RequestContextFilter,
    clear_request_context,
    get_request_context,
    set_request_context,
)
from core.middleware import RequestLoggingMiddleware
from sharing.models import SharedAccess


class ConfigViewTest(APITestCase):
    """GET /api/config/ — публичный флаг шифрования и CSRF-cookie."""

    URL = "/api/config/"

    @override_settings(ENCRYPTION_ENABLED=True)
    def test_anonymous_gets_encryption_enabled_true(self):
        """Проверяет включённый флаг шифрования для анонимного клиента."""
        response = self.client.get(self.URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"encryption_enabled": True})

    @override_settings(ENCRYPTION_ENABLED=False)
    def test_anonymous_gets_encryption_enabled_false(self):
        """Проверяет выключенный флаг шифрования для анонимного клиента."""
        response = self.client.get(self.URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"encryption_enabled": False})

    def test_response_sets_csrf_cookie(self):
        """Проверяет установку CSRF-cookie в ответе конфигурации."""
        response = self.client.get(self.URL)

        self.assertIn("csrftoken", response.cookies)
        self.assertTrue(response.cookies["csrftoken"].value)


class ErrorContractTest(APITestCase):
    """Любая ошибка приходит в конверте {"error": {code, message, ...}}."""

    KNOWN_CODES = {
        "validation_error",
        "invalid_credentials",
        "not_authenticated",
        "wrapping_key_missing",
        "csrf_failed",
        "permission_denied",
        "not_found",
        "method_not_allowed",
        "unsupported_media_type",
        "gone",
        "rate_limited",
        "internal_error",
        "error",
    }

    def setUp(self):
        """Создаёт пользователя для авторизованных сценариев ошибок."""
        self.user = User.objects.create_user(
            username="err_user", password="Str0ng!Pass99"
        )

    def _assert_envelope(self, response, expected_code):
        """Проверяет обязательные поля конверта и код из известного списка."""
        self.assertIn("error", response.data)
        error = response.data["error"]
        self.assertIn(error["code"], self.KNOWN_CODES)
        self.assertEqual(error["code"], expected_code)
        self.assertTrue(error["message"])
        self.assertIn("request_id", error)
        return error

    def test_not_found(self):
        """Проверяет формат ответа для отсутствующей записи."""
        self.client.force_login(self.user)
        resp = self.client.get("/api/entries/999999/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self._assert_envelope(resp, "not_found")

    def test_not_authenticated(self):
        """Проверяет формат ответа для анонимного доступа."""
        resp = self.client.get("/api/entries/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self._assert_envelope(resp, "not_authenticated")

    def test_validation_error_lists_fields(self):
        """Проверяет поля в ответе ошибки валидации."""
        self.client.force_login(self.user)
        resp = self.client.post(
            "/api/entries/",
            {"mood": "не-шифротекст"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        error = self._assert_envelope(resp, "validation_error")
        self.assertIn("mood", error["fields"])
        self.assertIsInstance(error["fields"]["mood"], list)

    def test_invalid_credentials_has_own_code(self):
        """Неверный пароль отличается от ошибки формата отдельным кодом."""
        resp = self.client.post(
            "/api/auth/login/",
            {"username": "err_user", "password": "wrong"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        error = self._assert_envelope(resp, "invalid_credentials")
        self.assertEqual(error["message"], "Неверный логин или пароль.")

    def test_missing_login_field_is_validation_error(self):
        """Отсутствие поля — это формат запроса, а не неверные данные."""
        resp = self.client.post(
            "/api/auth/login/", {"username": "err_user"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        error = self._assert_envelope(resp, "validation_error")
        self.assertIn("password", error["fields"])

    def test_method_not_allowed(self):
        """Проверяет формат ответа для неподдерживаемого метода."""
        self.client.force_login(self.user)
        resp = self.client.delete("/api/config/")
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self._assert_envelope(resp, "method_not_allowed")

    def test_gone_for_revoked_share(self):
        """Проверяет статус отозванной ссылки."""
        share = SharedAccess.objects.create(
            user=self.user, data_blob="blob", is_active=False
        )
        resp = self.client.get(f"/api/sharing/{share.token}/data/")
        self.assertEqual(resp.status_code, status.HTTP_410_GONE)
        self._assert_envelope(resp, "gone")

    def test_wrapping_key_missing(self):
        """Проверяет код ошибки при отсутствии ключа в сессии."""
        self.client.force_login(self.user)
        resp = self.client.get("/api/auth/unwrap-key/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self._assert_envelope(resp, "wrapping_key_missing")

    def test_wrapping_key_present_is_not_an_error(self):
        """Проверяет успешное получение ключа из сессии."""
        self.client.force_login(self.user)
        session = self.client.session
        session[WRAPPING_KEY_SESSION_KEY] = "dGVzdGtleQ=="
        session.save()

        resp = self.client.get("/api/auth/unwrap-key/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn("error", resp.data)

    def test_object_does_not_exist_becomes_404(self):
        """Голый DoesNotExist из связанного объекта не превращается в 500."""
        self.client.force_login(self.user)
        resp = self.client.get("/api/auth/profile/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self._assert_envelope(resp, "not_found")

    def test_request_id_matches_header(self):
        """По request_id из тела ошибку можно найти в логах."""
        self.client.force_login(self.user)
        resp = self.client.get("/api/entries/999999/")
        self.assertEqual(
            resp.data["error"]["request_id"], resp.headers["X-Request-ID"]
        )


class RequestLoggingMiddlewareTest(APITestCase):
    """Идентификатор запроса и очистка контекста."""

    def test_request_id_header_present(self):
        """Проверяет добавление идентификатора запроса в заголовок."""
        resp = self.client.get("/api/config/")
        self.assertIn("X-Request-ID", resp.headers)
        self.assertTrue(resp.headers["X-Request-ID"])

    def test_request_id_is_unique_per_request(self):
        """Проверяет уникальность идентификаторов двух запросов."""
        first = self.client.get("/api/config/").headers["X-Request-ID"]
        second = self.client.get("/api/config/").headers["X-Request-ID"]
        self.assertNotEqual(first, second)

    def test_context_cleared_after_request(self):
        """Контекст живёт в thread-local, поток переиспользуется дальше."""
        self.client.get("/api/config/")
        self.assertEqual(get_request_context(), {})

    def test_context_cleared_after_exception(self):
        """Без finally чужой request_id утёк бы в логи соседнего запроса."""

        def boom(request):
            """Имитирует ошибку обработчика запроса."""
            raise RuntimeError("boom")

        middleware = RequestLoggingMiddleware(boom)
        request = APIRequestFactory().get("/api/boom/")
        request.user = AnonymousUser()

        with self.assertRaises(RuntimeError):
            middleware(request)

        self.assertEqual(get_request_context(), {})


class JSONFormatterTest(TestCase):
    """Каждая запись лога — одна строка валидного JSON."""

    def setUp(self):
        """Создаёт форматтер и очищает контекст запроса."""
        self.formatter = JSONFormatter()
        clear_request_context()

    def _record(self, **extra):
        """Создаёт тестовую запись журнала с дополнительными полями."""
        record = logging.LogRecord(
            name="entries",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="Entry created by user_id=%d",
            args=(42,),
            exc_info=None,
        )
        for key, value in extra.items():
            setattr(record, key, value)
        return record

    def test_output_is_valid_json(self):
        """Проверяет JSON-формат обязательных полей записи."""
        payload = json.loads(self.formatter.format(self._record()))
        self.assertEqual(payload["logger"], "entries")
        self.assertEqual(payload["level"], "INFO")
        self.assertEqual(payload["message"], "Entry created by user_id=42")

    def test_timestamp_is_iso_utc(self):
        """Проверяет UTC-формат временной метки."""
        payload = json.loads(self.formatter.format(self._record()))
        self.assertTrue(payload["timestamp"].endswith("+00:00"))

    def test_request_context_included(self):
        """Проверяет перенос контекста запроса в JSON-запись."""
        set_request_context(
            request_id="abc123",
            user_id=7,
            ip="10.0.0.1",
            method="POST",
            path="/api/entries/",
        )
        record = self._record()
        RequestContextFilter().filter(record)

        payload = json.loads(self.formatter.format(record))
        self.assertEqual(payload["request_id"], "abc123")
        self.assertEqual(payload["user_id"], 7)
        self.assertEqual(payload["ip"], "10.0.0.1")
        self.assertEqual(payload["method"], "POST")
        self.assertEqual(payload["path"], "/api/entries/")

    def test_optional_fields_omitted_when_absent(self):
        """Проверяет отсутствие необязательных полей без значений."""
        payload = json.loads(self.formatter.format(self._record()))
        self.assertNotIn("status_code", payload)
        self.assertNotIn("duration_ms", payload)

    def test_response_fields_included(self):
        """Проверяет запись статуса и длительности ответа."""
        record = self._record(status_code=201, duration_ms=12.5)
        payload = json.loads(self.formatter.format(record))
        self.assertEqual(payload["status_code"], 201)
        self.assertEqual(payload["duration_ms"], 12.5)

    def test_exception_included(self):
        """Проверяет добавление трассировки исключения в журнал."""
        try:
            raise ValueError("что-то пошло не так")
        except ValueError:
            record = logging.LogRecord(
                name="core.errors",
                level=logging.ERROR,
                pathname=__file__,
                lineno=1,
                msg="fail",
                args=(),
                exc_info=sys.exc_info(),
            )
        payload = json.loads(self.formatter.format(record))
        self.assertIn("exception", payload)
        self.assertIn("ValueError", "".join(payload["exception"]))

    def test_cyrillic_not_escaped(self):
        """ensure_ascii=False — иначе в EFK нечитаемые \\uXXXX."""
        record = self._record()
        record.msg = "Пользователь вошёл"
        record.args = ()
        self.assertIn("Пользователь", self.formatter.format(record))


class HealthViewTest(APITestCase):
    """GET /api/health/ — состояние зависимостей."""

    URL = "/api/health/"

    def test_all_dependencies_available(self):
        """Проверяет успешный ответ при доступных зависимостях."""
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], "ok")
        self.assertEqual(resp.data["database"], "ok")
        self.assertEqual(resp.data["cache"], "ok")

    def test_available_without_authentication(self):
        """Мониторинг и Docker обращаются без сессии."""
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    @patch("core.views.connection")
    def test_database_failure_returns_503(self, mock_connection):
        """Проверяет недоступность сервиса при отказе базы данных."""
        mock_connection.cursor.side_effect = OperationalError("нет связи")

        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(resp.data["database"], "error")

    @patch("core.views.cache")
    def test_cache_failure_does_not_break_service(self, mock_cache):
        """Кэш — ускоритель: без него приложение медленнее, но живо."""
        mock_cache.set.side_effect = ConnectionError("redis недоступен")

        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["cache"], "error")
        self.assertEqual(resp.data["status"], "ok")
