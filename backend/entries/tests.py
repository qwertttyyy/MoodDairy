# backend/entries/tests.py

import base64
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory

from entries.cache import (
    _get_version,
    _make_key,
    _version_key,
    cached_action,
    invalidate_user_cache,
)
from entries.constants import CACHE_PREFIX
from entries.models import MoodEntry, Tag
from entries.serializers import (
    MoodEntryWriteSerializer,
    _validate_encrypted_field,
)
from entries.views import MoodEntryViewSet


# ===================================================================
#  _validate_encrypted_field
# ===================================================================
class ValidateEncryptedFieldTest(TestCase):
    """Проверка формата iv:ciphertext (base64:base64)."""

    def test_valid_format(self):
        iv = base64.b64encode(b"iv_bytes").decode()
        ct = base64.b64encode(b"ciphertext").decode()
        value = f"{iv}:{ct}"
        self.assertEqual(_validate_encrypted_field(value), value)

    def test_no_colon_separator(self):
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError) as ctx:
            _validate_encrypted_field("nocolon")
        self.assertIn("iv:ciphertext", str(ctx.exception.detail))

    def test_invalid_base64_in_ciphertext(self):
        from rest_framework.exceptions import ValidationError

        iv = base64.b64encode(b"iv").decode()
        with self.assertRaises(ValidationError):
            _validate_encrypted_field(f"{iv}:not!base64")

    def test_empty_string_passes(self):
        self.assertEqual(_validate_encrypted_field(""), "")

    def test_both_parts_valid_base64_with_colon_in_ct(self):
        """Если вторая часть (после первого ':') — валидный base64, то без ошибок."""
        iv = base64.b64encode(b"iv_data").decode()
        ct = base64.b64encode(b"cipher:text:with:colons").decode()
        value = f"{iv}:{ct}"
        self.assertEqual(_validate_encrypted_field(value), value)


# ===================================================================
#  MoodEntryWriteSerializer — validate_timestamp, validate_note
# ===================================================================
class TimestampValidationTest(TestCase):
    """validate_timestamp — прошлое / будущее."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="ts_user", password="Str0ng!Pass99"
        )
        Tag.objects.get_or_create(name="Работа")

    def _make_data(self, ts):
        iv = base64.b64encode(b"test_iv_").decode()
        ct = base64.b64encode(b"test_ct_").decode()
        return {
            "mood": f"{iv}:{ct}",
            "timestamp": ts.isoformat(),
        }

    def test_past_timestamp_accepted(self):
        ts = timezone.now() - timedelta(days=1)
        s = MoodEntryWriteSerializer(data=self._make_data(ts))
        self.assertTrue(s.is_valid(), s.errors)

    def test_future_timestamp_rejected(self):
        ts = timezone.now() + timedelta(hours=1)
        s = MoodEntryWriteSerializer(data=self._make_data(ts))
        self.assertFalse(s.is_valid())
        self.assertIn("timestamp", s.errors)

    def test_empty_note_accepted(self):
        ts = timezone.now() - timedelta(hours=1)
        data = {**self._make_data(ts), "note": ""}
        s = MoodEntryWriteSerializer(data=data)
        self.assertTrue(s.is_valid(), s.errors)


# ===================================================================
#  MoodEntryViewSet — статические методы
# ===================================================================
class FilterByMonthTest(TestCase):
    """_filter_by_month — обычный месяц, декабрь, некорректные данные."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="filter_user", password="Str0ng!Pass99"
        )
        self.qs = MoodEntry.objects.filter(user=self.user)

    def test_regular_month(self):
        filtered = MoodEntryViewSet._filter_by_month(self.qs, "2026", "3")
        query_str = str(filtered.query)
        self.assertIn("2026-03-01", query_str)
        self.assertIn("2026-04-01", query_str)

    def test_december_crosses_year(self):
        filtered = MoodEntryViewSet._filter_by_month(self.qs, "2025", "12")
        sql = str(filtered.query)
        self.assertIn("timestamp", sql)

    def test_invalid_data_returns_original_qs(self):
        original_sql = str(self.qs.query)
        filtered = MoodEntryViewSet._filter_by_month(self.qs, "abc", "xyz")
        self.assertEqual(str(filtered.query), original_sql)

    def test_december_entries_filtered_correctly(self):
        """Интеграционная проверка: записи декабря 2025 возвращаются, январь 2026 — нет."""
        tz = timezone.get_current_timezone()
        from datetime import datetime as dt

        MoodEntry.objects.create(
            user=self.user,
            mood="enc",
            timestamp=dt(2025, 12, 15, 12, 0, tzinfo=tz),
        )
        MoodEntry.objects.create(
            user=self.user,
            mood="enc",
            timestamp=dt(2026, 1, 1, 0, 0, tzinfo=tz),
        )

        qs = MoodEntry.objects.filter(user=self.user)
        filtered = MoodEntryViewSet._filter_by_month(qs, "2025", "12")
        self.assertEqual(filtered.count(), 1)
        self.assertEqual(filtered.first().timestamp.month, 12)


class ParseBeforeTest(TestCase):
    """_parse_before — валидная дата, невалидная строка, None."""

    def test_valid_date_string(self):
        result = MoodEntryViewSet._parse_before("2026-03-01")
        self.assertEqual(result, date(2026, 3, 1))

    def test_invalid_string_returns_none(self):
        self.assertIsNone(MoodEntryViewSet._parse_before("not-a-date"))

    def test_none_returns_none(self):
        self.assertIsNone(MoodEntryViewSet._parse_before(None))


# ===================================================================
#  entries/cache.py
# ===================================================================
class VersionKeyTest(TestCase):
    """_version_key — формат ключа."""

    def test_format(self):
        key = _version_key(42)
        self.assertEqual(key, f"{CACHE_PREFIX}:ver:42")


class GetVersionTest(TestCase):
    """_get_version — первый вызов и последующие."""

    def setUp(self):
        cache.clear()

    def test_first_call_returns_1(self):
        ver = _get_version(99)
        self.assertEqual(ver, 1)
        # Убеждаемся что записано в cache
        self.assertEqual(cache.get(_version_key(99)), 1)

    def test_subsequent_call_returns_current(self):
        cache.set(_version_key(99), 5, 86400)
        self.assertEqual(_get_version(99), 5)


class InvalidateUserCacheTest(TestCase):
    """invalidate_user_cache — инкремент версии."""

    def setUp(self):
        cache.clear()

    def test_increments_existing_version(self):
        cache.set(_version_key(1), 3, 86400)
        invalidate_user_cache(1)
        self.assertEqual(cache.get(_version_key(1)), 4)

    def test_cold_cache_sets_to_1(self):
        """Нет ключа в cache → incr бросит ValueError → ставим 1."""
        invalidate_user_cache(777)
        self.assertEqual(cache.get(_version_key(777)), 1)


class MakeKeyTest(TestCase):
    """_make_key — детерминированность при разном порядке параметров."""

    def setUp(self):
        cache.clear()

    def test_same_params_different_order_same_key(self):
        from django.http import QueryDict

        params_a = {"year": "2026", "month": "3"}
        params_b = {"month": "3", "year": "2026"}
        key_a = _make_key(1, "list", params_a)
        key_b = _make_key(1, "list", params_b)
        self.assertEqual(key_a, key_b)


class CachedActionTest(TestCase):
    """cached_action — кэширование, non-200 не кэшируется."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="cache_user", password="Str0ng!Pass99"
        )
        self.factory = APIRequestFactory()
        self.call_count = 0

    def _make_request(self):
        request = self.factory.get("/fake/")
        request.user = self.user
        request.query_params = {}
        return request

    def test_returns_cached_on_second_call(self):
        """Повторный вызов с теми же параметрами → функция не вызывается второй раз."""

        class FakeView:
            @cached_action
            def my_action(inner_self, request):
                self.call_count += 1
                return Response({"count": self.call_count})

        view = FakeView()
        req = self._make_request()

        resp1 = view.my_action(req)
        resp2 = view.my_action(req)

        self.assertEqual(resp1.data["count"], 1)
        self.assertEqual(resp2.data["count"], 1)  # из кэша
        self.assertEqual(self.call_count, 1)

    def test_non_200_not_cached(self):
        """Ответ с кодом != 200 не записывается в cache."""

        class FakeView:
            @cached_action
            def bad_action(inner_self, request):
                self.call_count += 1
                return Response({"error": "bad"}, status=400)

        view = FakeView()
        req = self._make_request()

        view.bad_action(req)
        view.bad_action(req)

        # Функция вызвана дважды — кэш не сработал
        self.assertEqual(self.call_count, 2)
