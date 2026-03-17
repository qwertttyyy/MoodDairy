import base64
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, APITestCase

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


def _enc(value: str) -> str:
    """Формирует валидную зашифрованную строку iv:ciphertext."""
    iv = base64.b64encode(b"test_iv_").decode()
    ct = base64.b64encode(value.encode()).decode()
    return f"{iv}:{ct}"


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
        return {
            "mood": _enc("5"),
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
#  MoodEntryWriteSerializer — anxiety field
# ===================================================================
class AnxietyFieldTest(TestCase):
    """validate_anxiety — пустое значение, валидный формат, невалидный формат."""

    def _make_data(self, anxiety=""):
        ts = (timezone.now() - timedelta(hours=1)).isoformat()
        data = {"mood": _enc("5"), "timestamp": ts}
        if anxiety is not None:
            data["anxiety"] = anxiety
        return data

    def test_empty_anxiety_accepted(self):
        """Поле anxiety необязательное — пустая строка проходит."""
        s = MoodEntryWriteSerializer(data=self._make_data(anxiety=""))
        self.assertTrue(s.is_valid(), s.errors)

    def test_missing_anxiety_accepted(self):
        """Поле anxiety отсутствует в payload — тоже допустимо."""
        data = {"mood": _enc("5"),
                "timestamp": (timezone.now() - timedelta(hours=1)).isoformat()}
        s = MoodEntryWriteSerializer(data=data)
        self.assertTrue(s.is_valid(), s.errors)

    def test_valid_encrypted_anxiety(self):
        """Корректный формат iv:ciphertext принимается."""
        s = MoodEntryWriteSerializer(data=self._make_data(anxiety=_enc("3")))
        self.assertTrue(s.is_valid(), s.errors)

    def test_invalid_anxiety_format_rejected(self):
        """Строка без разделителя ':' — ошибка валидации."""
        s = MoodEntryWriteSerializer(
            data=self._make_data(anxiety="not_encrypted"))
        self.assertFalse(s.is_valid())
        self.assertIn("anxiety", s.errors)

    def test_invalid_base64_anxiety_rejected(self):
        """Невалидный base64 в anxiety — ошибка."""
        s = MoodEntryWriteSerializer(
            data=self._make_data(anxiety="abc:not!base64"))
        self.assertFalse(s.is_valid())
        self.assertIn("anxiety", s.errors)


class AnxietyModelTest(TestCase):
    """Проверка сохранения anxiety в БД."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="anx_user", password="Str0ng!Pass99"
        )

    def test_create_entry_with_anxiety(self):
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("7"),
            anxiety=_enc("3"),
        )
        entry.refresh_from_db()
        self.assertEqual(entry.anxiety, _enc("3"))

    def test_create_entry_without_anxiety(self):
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
        )
        entry.refresh_from_db()
        self.assertEqual(entry.anxiety, "")

    def test_update_anxiety(self):
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
        )
        entry.anxiety = _enc("4")
        entry.save()
        entry.refresh_from_db()
        self.assertEqual(entry.anxiety, _enc("4"))


class AnxietySerializerCreateUpdateTest(TestCase):
    """Проверка create / update через сериализатор с anxiety."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="anx_crud", password="Str0ng!Pass99"
        )

    def test_create_with_anxiety(self):
        ts = (timezone.now() - timedelta(hours=1)).isoformat()
        data = {
            "mood": _enc("6"),
            "anxiety": _enc("2"),
            "timestamp": ts,
        }
        s = MoodEntryWriteSerializer(data=data)
        s.is_valid(raise_exception=True)
        entry = s.save(user=self.user)
        self.assertEqual(entry.anxiety, _enc("2"))

    def test_update_anxiety(self):
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
            anxiety=_enc("1"),
        )
        data = {
            "mood": _enc("5"),
            "anxiety": _enc("4"),
            "timestamp": entry.timestamp.isoformat(),
        }
        s = MoodEntryWriteSerializer(instance=entry, data=data)
        s.is_valid(raise_exception=True)
        updated = s.save()
        self.assertEqual(updated.anxiety, _enc("4"))

    def test_clear_anxiety(self):
        """Очистка anxiety — передаём пустую строку."""
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
            anxiety=_enc("3"),
        )
        data = {
            "mood": _enc("5"),
            "anxiety": "",
            "timestamp": entry.timestamp.isoformat(),
        }
        s = MoodEntryWriteSerializer(instance=entry, data=data)
        s.is_valid(raise_exception=True)
        updated = s.save()
        self.assertEqual(updated.anxiety, "")


class AnxietyReadSerializerTest(TestCase):
    """MoodEntryReadSerializer включает поле anxiety."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="anx_read", password="Str0ng!Pass99"
        )

    def test_anxiety_in_read_output(self):
        from entries.serializers import MoodEntryReadSerializer

        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("8"),
            anxiety=_enc("2"),
        )
        data = MoodEntryReadSerializer(entry).data
        self.assertIn("anxiety", data)
        self.assertEqual(data["anxiety"], _enc("2"))

    def test_empty_anxiety_in_read_output(self):
        from entries.serializers import MoodEntryReadSerializer

        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
        )
        data = MoodEntryReadSerializer(entry).data
        self.assertIn("anxiety", data)
        self.assertEqual(data["anxiety"], "")


# ===================================================================
#  Anxiety in API endpoints (integration)
# ===================================================================
class AnxietyAPITest(APITestCase):
    """Интеграционные тесты: создание и получение записей с anxiety."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="api_anx", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_create_entry_with_anxiety_via_api(self):
        ts = (timezone.now() - timedelta(hours=1)).isoformat()
        resp = self.client.post(
            "/api/entries/",
            {
                "mood": _enc("7"),
                "anxiety": _enc("3"),
                "timestamp": ts,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["anxiety"], _enc("3"))

    def test_create_entry_without_anxiety_via_api(self):
        ts = (timezone.now() - timedelta(hours=1)).isoformat()
        resp = self.client.post(
            "/api/entries/",
            {
                "mood": _enc("5"),
                "timestamp": ts,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["anxiety"], "")

    def test_list_entries_includes_anxiety(self):
        MoodEntry.objects.create(
            user=self.user,
            mood=_enc("6"),
            anxiety=_enc("2"),
        )
        resp = self.client.get("/api/entries/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("anxiety", resp.data[0])

    def test_update_entry_anxiety_via_api(self):
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
            anxiety=_enc("1"),
        )
        resp = self.client.put(
            f"/api/entries/{entry.id}/",
            {
                "mood": _enc("5"),
                "anxiety": _enc("4"),
                "timestamp": entry.timestamp.isoformat(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        entry.refresh_from_db()
        self.assertEqual(entry.anxiety, _enc("4"))


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
        invalidate_user_cache(777)
        self.assertEqual(cache.get(_version_key(777)), 1)


class MakeKeyTest(TestCase):
    """_make_key — детерминированность при разном порядке параметров."""

    def setUp(self):
        cache.clear()

    def test_same_params_different_order_same_key(self):
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
        self.assertEqual(resp2.data["count"], 1)
        self.assertEqual(self.call_count, 1)

    def test_non_200_not_cached(self):
        class FakeView:
            @cached_action
            def bad_action(inner_self, request):
                self.call_count += 1
                return Response({"error": "bad"}, status=400)

        view = FakeView()
        req = self._make_request()

        view.bad_action(req)
        view.bad_action(req)

        self.assertEqual(self.call_count, 2)
