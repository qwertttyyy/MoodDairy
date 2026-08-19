import base64
from datetime import date, datetime, timedelta
from unittest.mock import patch

from django.contrib.auth.models import AnonymousUser, User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, APITestCase
from rest_framework.throttling import SimpleRateThrottle

from entries.cache import entries_cache
from entries.constants import (
    CACHE_PREFIX,
    DEFAULT_TAG_NAMES,
    NOTE_MAX_LENGTH,
    PERIOD_DAYS,
)
from entries.fields import validate_encrypted_value
from entries.models import MoodEntry, Tag
from entries.serializers import MoodEntryWriteSerializer
from entries.services import filter_by_calendar, filter_by_period

CHART_URL = "/api/entries/?period=year"


def _enc(value: str) -> str:
    """Формирует валидную зашифрованную строку iv:ciphertext."""
    iv = base64.b64encode(b"test_iv_").decode()
    ct = base64.b64encode(value.encode()).decode()
    return f"{iv}:{ct}"


class ValidateEncryptedFieldTest(TestCase):
    """Проверка формата iv:ciphertext (base64:base64)."""

    def test_valid_format(self):
        """Проверяет строку с двумя base64-частями."""
        iv = base64.b64encode(b"iv_bytes").decode()
        ct = base64.b64encode(b"ciphertext").decode()
        value = f"{iv}:{ct}"
        self.assertEqual(validate_encrypted_value(value), value)

    def test_no_colon_separator(self):
        """Проверяет ошибку без разделителя шифротекста."""
        from rest_framework.exceptions import ValidationError

        with self.assertRaises(ValidationError) as ctx:
            validate_encrypted_value("nocolon")
        self.assertIn("iv:ciphertext", str(ctx.exception.detail))

    def test_invalid_base64_in_ciphertext(self):
        """Проверяет ошибку для некорректного шифротекста."""
        from rest_framework.exceptions import ValidationError

        iv = base64.b64encode(b"iv").decode()
        with self.assertRaises(ValidationError):
            validate_encrypted_value(f"{iv}:not!base64")

    def test_empty_string_passes(self):
        """Проверяет допустимое пустое необязательное значение."""
        self.assertEqual(validate_encrypted_value(""), "")

    def test_both_parts_valid_base64_with_colon_in_ct(self):
        """Проверяет шифротекст с двоеточиями до base64-кодирования."""
        iv = base64.b64encode(b"iv_data").decode()
        ct = base64.b64encode(b"cipher:text:with:colons").decode()
        value = f"{iv}:{ct}"
        self.assertEqual(validate_encrypted_value(value), value)


@override_settings(ENCRYPTION_ENABLED=False)
class ValidateEncryptedFieldDisabledTest(TestCase):
    """При выключенном шифровании открытый текст проходит без проверки."""

    def test_plain_value_passes(self):
        """Проверяет открытое значение при выключенном шифровании."""
        self.assertEqual(validate_encrypted_value("5"), "5")

    def test_serializer_accepts_plain_values(self):
        """Проверяет принятие открытых полей сериализатором."""
        serializer = MoodEntryWriteSerializer(
            data={"mood": "5", "anxiety": "4", "note": "обычный текст"}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)


class TimestampValidationTest(TestCase):
    """validate_timestamp — прошлое / будущее."""

    def setUp(self):
        """Создаёт пользователя для сценариев сериализатора."""
        self.user = User.objects.create_user(
            username="ts_user", password="Str0ng!Pass99"
        )

    def _make_data(self, ts):
        """Собирает корректные данные записи с заданной датой."""
        return {
            "mood": _enc("5"),
            "timestamp": ts.isoformat(),
        }

    def test_past_timestamp_accepted(self):
        """Проверяет принятие даты из прошлого."""
        ts = timezone.now() - timedelta(days=1)
        s = MoodEntryWriteSerializer(data=self._make_data(ts))
        self.assertTrue(s.is_valid(), s.errors)

    def test_future_timestamp_rejected(self):
        """Проверяет отклонение даты из будущего."""
        ts = timezone.now() + timedelta(hours=1)
        s = MoodEntryWriteSerializer(data=self._make_data(ts))
        self.assertFalse(s.is_valid())
        self.assertIn("timestamp", s.errors)

    def test_empty_note_accepted(self):
        """Проверяет допустимую пустую заметку."""
        ts = timezone.now() - timedelta(hours=1)
        data = {**self._make_data(ts), "note": ""}
        s = MoodEntryWriteSerializer(data=data)
        self.assertTrue(s.is_valid(), s.errors)


class AnxietyFieldTest(TestCase):
    """anxiety — пустое значение, валидный и невалидный формат."""

    def _make_data(self, anxiety=""):
        """Собирает данные записи с переданным значением тревоги."""
        ts = (timezone.now() - timedelta(hours=1)).isoformat()
        data = {"mood": _enc("5"), "timestamp": ts}
        if anxiety is not None:
            data["anxiety"] = anxiety
        return data

    def test_empty_anxiety_accepted(self):
        """Проверяет пустое значение тревоги."""
        s = MoodEntryWriteSerializer(data=self._make_data(anxiety=""))
        self.assertTrue(s.is_valid(), s.errors)

    def test_missing_anxiety_accepted(self):
        """Проверяет отсутствие необязательного значения тревоги."""
        data = {
            "mood": _enc("5"),
            "timestamp": (timezone.now() - timedelta(hours=1)).isoformat(),
        }
        s = MoodEntryWriteSerializer(data=data)
        self.assertTrue(s.is_valid(), s.errors)

    def test_valid_encrypted_anxiety(self):
        """Проверяет зашифрованное значение тревоги."""
        s = MoodEntryWriteSerializer(data=self._make_data(anxiety=_enc("3")))
        self.assertTrue(s.is_valid(), s.errors)

    def test_invalid_anxiety_format_rejected(self):
        """Проверяет ошибку для тревоги вне формата шифротекста."""
        s = MoodEntryWriteSerializer(
            data=self._make_data(anxiety="not_encrypted")
        )
        self.assertFalse(s.is_valid())
        self.assertIn("anxiety", s.errors)

    def test_invalid_base64_anxiety_rejected(self):
        """Проверяет ошибку для тревоги с некорректным base64."""
        s = MoodEntryWriteSerializer(
            data=self._make_data(anxiety="abc:not!base64")
        )
        self.assertFalse(s.is_valid())
        self.assertIn("anxiety", s.errors)


class AnxietyModelTest(TestCase):
    """Проверка сохранения anxiety в БД."""

    def setUp(self):
        """Создаёт владельца записей с тревогой."""
        self.user = User.objects.create_user(
            username="anx_user", password="Str0ng!Pass99"
        )

    def test_create_entry_with_anxiety(self):
        """Проверяет сохранение указанной тревоги."""
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("7"),
            anxiety=_enc("3"),
        )
        entry.refresh_from_db()
        self.assertEqual(entry.anxiety, _enc("3"))

    def test_create_entry_without_anxiety(self):
        """Проверяет значение тревоги по умолчанию."""
        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
        )
        entry.refresh_from_db()
        self.assertEqual(entry.anxiety, "")

    def test_update_anxiety(self):
        """Проверяет обновление значения тревоги."""
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
        """Создаёт пользователя для операций сериализатора."""
        self.user = User.objects.create_user(
            username="anx_crud", password="Str0ng!Pass99"
        )

    def test_create_with_anxiety(self):
        """Проверяет создание записи сериализатором с тревогой."""
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
        """Проверяет обновление тревоги сериализатором."""
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
        """Проверяет очистку тревоги сериализатором."""
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
        """Создаёт пользователя для сериализации записей."""
        self.user = User.objects.create_user(
            username="anx_read", password="Str0ng!Pass99"
        )

    def test_anxiety_in_read_output(self):
        """Проверяет значение тревоги в ответе чтения."""
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
        """Проверяет пустую тревогу в ответе чтения."""
        from entries.serializers import MoodEntryReadSerializer

        entry = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
        )
        data = MoodEntryReadSerializer(entry).data
        self.assertIn("anxiety", data)
        self.assertEqual(data["anxiety"], "")


class AnxietyAPITest(APITestCase):
    """Интеграционные тесты: создание и получение записей с anxiety."""

    def setUp(self):
        """Создаёт и аутентифицирует пользователя API."""
        self.user = User.objects.create_user(
            username="api_anx", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_create_entry_with_anxiety_via_api(self):
        """Проверяет создание записи с тревогой через API."""
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
        """Проверяет создание записи без тревоги через API."""
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
        """Проверяет поле тревоги в списке для графика."""
        MoodEntry.objects.create(
            user=self.user,
            mood=_enc("6"),
            anxiety=_enc("2"),
        )
        resp = self.client.get(CHART_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("anxiety", resp.data[0])

    def test_update_entry_anxiety_via_api(self):
        """Проверяет обновление тревоги через API."""
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


class FilterByCalendarTest(TestCase):
    """Календарный месяц и год целиком."""

    def setUp(self):
        """Создаёт записи на границе декабря и января."""
        self.user = User.objects.create_user(
            username="filter_user", password="Str0ng!Pass99"
        )
        tz = timezone.get_current_timezone()
        self.december = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("5"),
            timestamp=datetime(2025, 12, 15, 12, 0, tzinfo=tz),
        )
        self.january = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("6"),
            timestamp=datetime(2026, 1, 1, 0, 0, tzinfo=tz),
        )
        self.qs = MoodEntry.objects.filter(user=self.user)

    def test_month_bounds(self):
        """Проверяет границы выборки декабря."""
        filtered = filter_by_calendar(self.qs, 2025, 12)
        self.assertEqual(list(filtered), [self.december])

    def test_december_does_not_leak_into_next_year(self):
        """Декабрь — единственный месяц, где верхняя граница меняет год."""
        filtered = filter_by_calendar(self.qs, 2026, 1)
        self.assertEqual(list(filtered), [self.january])

    def test_whole_year(self):
        """Проверяет выборку записей одного календарного года."""
        filtered = filter_by_calendar(self.qs, 2025)
        self.assertEqual(list(filtered), [self.december])


class FilterByPeriodTest(TestCase):
    """Относительные периоды считаются от текущего момента."""

    def setUp(self):
        """Создаёт недавнюю и старую запись."""
        self.user = User.objects.create_user(
            username="period_user", password="Str0ng!Pass99"
        )
        now = timezone.now()
        self.recent = MoodEntry.objects.create(
            user=self.user, mood=_enc("5"), timestamp=now - timedelta(days=3)
        )
        self.old = MoodEntry.objects.create(
            user=self.user, mood=_enc("6"), timestamp=now - timedelta(days=200)
        )
        self.qs = MoodEntry.objects.filter(user=self.user)

    def test_two_weeks_keeps_only_recent(self):
        """Проверяет двухнедельный относительный период."""
        filtered = filter_by_period(self.qs, "2weeks")
        self.assertEqual(list(filtered), [self.recent])

    def test_year_keeps_both(self):
        """Проверяет годовой относительный период."""
        filtered = filter_by_period(self.qs, "year")
        self.assertEqual(filtered.count(), 2)

    def test_all_periods_supported(self):
        """Проверяет поддержку всех объявленных периодов."""
        for period in PERIOD_DAYS:
            with self.subTest(period=period):
                self.assertLessEqual(
                    filter_by_period(self.qs, period).count(), 2
                )


class VersionKeyTest(TestCase):
    """_version_key — формат ключа."""

    def test_format(self):
        """Проверяет формат ключа версии пользователя."""
        key = entries_cache._version_key(42)
        self.assertEqual(key, f"{CACHE_PREFIX}:ver:42")


class GetVersionTest(TestCase):
    """_get_version — первый вызов и последующие."""

    def setUp(self):
        """Очищает кэш перед проверкой версии."""
        cache.clear()

    def test_first_call_returns_1(self):
        """Проверяет создание начальной версии кэша."""
        ver = entries_cache._get_version(99)
        self.assertEqual(ver, 1)
        self.assertEqual(cache.get(entries_cache._version_key(99)), 1)

    def test_subsequent_call_returns_current(self):
        """Проверяет возврат уже сохранённой версии кэша."""
        cache.set(entries_cache._version_key(99), 5, None)
        self.assertEqual(entries_cache._get_version(99), 5)


class InvalidateUserCacheTest(TestCase):
    """invalidate — инкремент версии."""

    def setUp(self):
        """Очищает кэш перед проверкой инвалидации."""
        cache.clear()

    def test_increments_existing_version(self):
        """Проверяет увеличение существующей версии."""
        cache.set(entries_cache._version_key(1), 3, None)
        entries_cache.invalidate(1)
        self.assertEqual(cache.get(entries_cache._version_key(1)), 4)

    def test_cold_cache_sets_to_1(self):
        """Проверяет начальную версию при холодном кэше."""
        entries_cache.invalidate(777)
        self.assertEqual(cache.get(entries_cache._version_key(777)), 1)


class BuildKeyTest(TestCase):
    """_build_key — детерминированность при разном порядке параметров."""

    def setUp(self):
        """Очищает кэш перед проверкой ключей."""
        cache.clear()

    def test_same_params_different_order_same_key(self):
        """Проверяет независимость ключа от порядка параметров."""
        params_a = {"year": "2026", "month": "3"}
        params_b = {"month": "3", "year": "2026"}
        key_a = entries_cache._build_key(1, "list", params_a)
        key_b = entries_cache._build_key(1, "list", params_b)
        self.assertEqual(key_a, key_b)


class CachedActionTest(TestCase):
    """action — кэширование, non-200 не кэшируется, аноним не кэшируется."""

    def setUp(self):
        """Подготавливает пользователя, фабрику запросов и пустой кэш."""
        cache.clear()
        self.user = User.objects.create_user(
            username="cache_user", password="Str0ng!Pass99"
        )
        self.factory = APIRequestFactory()
        self.call_count = 0

    def _make_request(self, user=None):
        """Создаёт запрос с переданным или тестовым пользователем."""
        request = self.factory.get("/fake/")
        request.user = user if user is not None else self.user
        request.query_params = {}
        return request

    def test_returns_cached_on_second_call(self):
        """Проверяет возврат ответа из кэша при повторном вызове."""

        class FakeView:
            """Имитирует представление с успешным кэшируемым действием."""

            @entries_cache.cache_response()
            def my_action(inner_self, request):
                """Возвращает счётчик обращений для проверки кэша."""
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
        """Проверяет отсутствие кэширования ошибочного ответа."""

        class FakeView:
            """Имитирует представление с ошибочным действием."""

            @entries_cache.cache_response()
            def bad_action(inner_self, request):
                """Возвращает ошибочный ответ для проверки кэша."""
                self.call_count += 1
                return Response({"error": "bad"}, status=400)

        view = FakeView()
        req = self._make_request()

        view.bad_action(req)
        view.bad_action(req)

        self.assertEqual(self.call_count, 2)

    def test_anonymous_not_cached(self):
        """У анонима нет id — кэшировать нечего, вызов идёт напрямую."""

        class FakeView:
            """Имитирует представление с кэшируемым действием."""

            @entries_cache.cache_response()
            def my_action(inner_self, request):
                """Возвращает счётчик обращений для проверки кэша."""
                self.call_count += 1
                return Response({"count": self.call_count})

        view = FakeView()
        req = self._make_request(user=AnonymousUser())

        view.my_action(req)
        view.my_action(req)

        self.assertEqual(self.call_count, 2)


class DataIsolationTest(APITestCase):
    """Пользователь не видит и не может изменить чужие записи."""

    def setUp(self):
        """Создаёт пользователей и по одной записи каждому."""
        self.alice = User.objects.create_user(
            username="alice", password="Str0ng!Pass99"
        )
        self.bob = User.objects.create_user(
            username="bob", password="Str0ng!Pass99"
        )
        self.alice_entry = MoodEntry.objects.create(
            user=self.alice, mood=_enc("5")
        )
        self.bob_entry = MoodEntry.objects.create(
            user=self.bob, mood=_enc("7")
        )

    def test_user_sees_only_own_entries(self):
        """Проверяет изоляцию списка записей по владельцу."""
        self.client.force_login(self.alice)
        resp = self.client.get(CHART_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        moods = [e["mood"] for e in resp.data]
        self.assertIn(self.alice_entry.mood, moods)
        self.assertNotIn(self.bob_entry.mood, moods)

    def test_user_cannot_retrieve_others_entry(self):
        """Проверяет запрет чтения чужой записи."""
        self.client.force_login(self.alice)
        resp = self.client.get(f"/api/entries/{self.bob_entry.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_user_cannot_update_others_entry(self):
        """Проверяет запрет изменения чужой записи."""
        self.client.force_login(self.alice)
        resp = self.client.put(
            f"/api/entries/{self.bob_entry.id}/",
            {
                "mood": _enc("1"),
                "timestamp": self.bob_entry.timestamp.isoformat(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_user_cannot_delete_others_entry(self):
        """Проверяет запрет удаления чужой записи."""
        self.client.force_login(self.alice)
        resp = self.client.delete(f"/api/entries/{self.bob_entry.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(
            MoodEntry.objects.filter(id=self.bob_entry.id).exists()
        )


class GroupedEndpointTest(APITestCase):
    """GET /api/entries/grouped/ — группировка по дням, курсорная пагинация."""

    def setUp(self):
        """Создаёт и аутентифицирует пользователя с записями за десять дней."""
        self.user = User.objects.create_user(
            username="grp_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

        now = timezone.now()
        for i in range(10):
            MoodEntry.objects.create(
                user=self.user,
                mood=_enc(str(i)),
                timestamp=now - timedelta(days=i),
            )

    def test_grouped_returns_dict_by_day(self):
        """Проверяет группировку записей по ключам-календарным датам."""
        resp = self.client.get("/api/entries/grouped/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("results", resp.data)
        self.assertIn("next_before", resp.data)
        for key in resp.data["results"]:
            date.fromisoformat(key)

    def test_grouped_pagination(self):
        """Первая страница → next_before → вторая страница."""
        resp1 = self.client.get("/api/entries/grouped/")
        next_before = resp1.data["next_before"]
        self.assertIsNotNone(next_before)

        resp2 = self.client.get(f"/api/entries/grouped/?before={next_before}")
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        days_page1 = set(resp1.data["results"].keys())
        days_page2 = set(resp2.data["results"].keys())
        self.assertTrue(days_page1.isdisjoint(days_page2))

    def test_grouped_empty(self):
        """Проверяет пустой ответ для пользователя без записей."""
        other = User.objects.create_user(
            username="empty_user", password="Str0ng!Pass99"
        )
        self.client.force_login(other)
        resp = self.client.get("/api/entries/grouped/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["results"], {})
        self.assertIsNone(resp.data["next_before"])


class CacheInvalidationIntegrationTest(APITestCase):
    """Кэш list обновляется после создания/обновления/удаления записи."""

    def setUp(self):
        """Очищает кэш и аутентифицирует пользователя."""
        cache.clear()
        self.user = User.objects.create_user(
            username="inv_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_list_updates_after_create(self):
        """Проверяет обновление кэша списка после создания записи."""
        resp1 = self.client.get(CHART_URL)
        self.assertEqual(len(resp1.data), 0)

        ts = (timezone.now() - timedelta(hours=1)).isoformat()
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(
                "/api/entries/",
                {"mood": _enc("5"), "timestamp": ts},
                format="json",
            )

        resp2 = self.client.get(CHART_URL)
        self.assertEqual(len(resp2.data), 1)

    def test_list_updates_after_delete(self):
        """Проверяет обновление кэша списка после удаления записи."""
        entry = MoodEntry.objects.create(user=self.user, mood=_enc("5"))
        resp1 = self.client.get(CHART_URL)
        self.assertEqual(len(resp1.data), 1)

        with self.captureOnCommitCallbacks(execute=True):
            self.client.delete(f"/api/entries/{entry.id}/")

        resp2 = self.client.get(CHART_URL)
        self.assertEqual(len(resp2.data), 0)

    def test_list_updates_after_update(self):
        """Проверяет обновление кэша списка после изменения записи."""
        entry = MoodEntry.objects.create(user=self.user, mood=_enc("5"))
        self.client.get(CHART_URL)

        with self.captureOnCommitCallbacks(execute=True):
            self.client.put(
                f"/api/entries/{entry.id}/",
                {
                    "mood": _enc("9"),
                    "timestamp": entry.timestamp.isoformat(),
                },
                format="json",
            )

        resp = self.client.get(CHART_URL)
        self.assertEqual(resp.data[0]["mood"], _enc("9"))


class TagOwnershipTest(APITestCase):
    """У каждого пользователя свой набор тегов."""

    def setUp(self):
        """Создаёт пользователей и принадлежащие им теги."""
        cache.clear()
        self.alice = User.objects.create_user(
            username="tag_alice", password="Str0ng!Pass99"
        )
        self.bob = User.objects.create_user(
            username="tag_bob", password="Str0ng!Pass99"
        )
        self.alice_tag = Tag.objects.create(user=self.alice, name="Работа")
        self.bob_tag = Tag.objects.create(user=self.bob, name="Спорт")

    def test_list_shows_only_own_tags(self):
        """Проверяет изоляцию списка тегов по владельцу."""
        self.client.force_login(self.alice)
        resp = self.client.get("/api/tags/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [t["name"] for t in resp.data]
        self.assertEqual(names, ["Работа"])

    def test_cannot_retrieve_others_tag(self):
        """Проверяет запрет чтения чужого тега."""
        self.client.force_login(self.alice)
        resp = self.client.get(f"/api/tags/{self.bob_tag.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_delete_others_tag(self):
        """Проверяет запрет удаления чужого тега."""
        self.client.force_login(self.alice)
        resp = self.client.delete(f"/api/tags/{self.bob_tag.id}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Tag.objects.filter(id=self.bob_tag.id).exists())

    def test_cannot_attach_others_tag_to_entry(self):
        """Иначе через ответ API можно прочитать название чужого тега."""
        self.client.force_login(self.alice)
        resp = self.client.post(
            "/api/entries/",
            {
                "mood": _enc("5"),
                "timestamp": (timezone.now() - timedelta(hours=1)).isoformat(),
                "tags": [self.bob_tag.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("tags", resp.data["error"]["fields"])

    def test_same_name_allowed_for_different_users(self):
        """Проверяет повтор имени у разных владельцев."""
        self.client.force_login(self.bob)
        resp = self.client.post(
            "/api/tags/", {"name": "Работа"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_duplicate_name_rejected_for_same_user(self):
        """Проверяет уникальность имени тега у одного владельца."""
        self.client.force_login(self.alice)
        resp = self.client.post(
            "/api/tags/", {"name": "Работа"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", resp.data["error"]["fields"])


class TagCrudTest(APITestCase):
    """Создание, переименование и удаление тега."""

    def setUp(self):
        """Очищает кэш и аутентифицирует пользователя тегов."""
        cache.clear()
        self.user = User.objects.create_user(
            username="tag_crud", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_create(self):
        """Проверяет создание пользовательского тега."""
        resp = self.client.post(
            "/api/tags/", {"name": "Прогулка"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            Tag.objects.filter(user=self.user, name="Прогулка").exists()
        )

    def test_rename(self):
        """Проверяет переименование пользовательского тега."""
        tag = Tag.objects.create(user=self.user, name="Старое")
        resp = self.client.patch(
            f"/api/tags/{tag.id}/", {"name": "Новое"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        tag.refresh_from_db()
        self.assertEqual(tag.name, "Новое")

    def test_delete_keeps_entry_and_drops_link(self):
        """Удаление тега не трогает запись: пропадает только связь."""
        tag = Tag.objects.create(user=self.user, name="Стресс")
        entry = MoodEntry.objects.create(user=self.user, mood=_enc("5"))
        entry.tags.set([tag])

        resp = self.client.delete(f"/api/tags/{tag.id}/")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        entry.refresh_from_db()
        self.assertTrue(MoodEntry.objects.filter(id=entry.id).exists())
        self.assertEqual(list(entry.tags.all()), [])

    def test_tag_change_invalidates_entries_cache(self):
        """Теги входят в ответ grouped, поэтому его кэш обязан обновиться."""
        tag = Tag.objects.create(user=self.user, name="Работа")
        entry = MoodEntry.objects.create(user=self.user, mood=_enc("5"))
        entry.tags.set([tag])

        first = self.client.get("/api/entries/grouped/")
        day = next(iter(first.data["results"]))
        self.assertEqual(
            first.data["results"][day][0]["tags"][0]["name"], "Работа"
        )

        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(
                f"/api/tags/{tag.id}/", {"name": "Отдых"}, format="json"
            )

        second = self.client.get("/api/entries/grouped/")
        self.assertEqual(
            second.data["results"][day][0]["tags"][0]["name"], "Отдых"
        )


class DefaultTagsTest(APITestCase):
    """Новый пользователь получает стартовый набор тегов."""

    def test_registration_creates_default_tags(self):
        """Проверяет создание стандартных тегов при регистрации."""
        resp = self.client.post(
            "/api/auth/register/",
            {
                "username": "fresh_user",
                "password": "Str0ng!Pass99",
                "encryption_salt": base64.b64encode(b"12345678").decode(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(username="fresh_user")
        self.assertEqual(
            set(Tag.objects.filter(user=user).values_list("name", flat=True)),
            set(DEFAULT_TAG_NAMES),
        )


class ChartEndpointTest(APITestCase):
    """GET /api/entries/ — выборка за период, только поля для графика."""

    def setUp(self):
        """Создаёт пользователя с недавней и старой записями."""
        cache.clear()
        self.user = User.objects.create_user(
            username="chart_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)
        self.tag = Tag.objects.create(user=self.user, name="Работа")

        now = timezone.now()
        self.recent = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("7"),
            note=_enc("длинная заметка"),
            anxiety=_enc("2"),
            timestamp=now - timedelta(days=2),
        )
        self.recent.tags.set([self.tag])
        self.old = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("3"),
            timestamp=now - timedelta(days=100),
        )

    def test_period_is_required(self):
        """Без периода нельзя вытянуть всю историю одним запросом."""
        resp = self.client.get("/api/entries/")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data["error"]["code"], "validation_error")

    def test_relative_period(self):
        """Проверяет выборку относительного периода графика."""
        resp = self.client.get("/api/entries/?period=2weeks")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([e["mood"] for e in resp.data], [self.recent.mood])

    def test_calendar_year(self):
        """Проверяет выборку записей календарного года."""
        year = timezone.localtime(self.recent.timestamp).year
        resp = self.client.get(f"/api/entries/?year={year}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(resp.data), 1)

    def test_calendar_month(self):
        """Проверяет выборку записей календарного месяца."""
        local = timezone.localtime(self.recent.timestamp)
        resp = self.client.get(
            f"/api/entries/?year={local.year}&month={local.month}"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn(self.recent.mood, [e["mood"] for e in resp.data])

    def test_month_without_year_rejected(self):
        """Проверяет обязательность года для параметра месяца."""
        resp = self.client.get("/api/entries/?month=3")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_period_and_year_together_rejected(self):
        """Проверяет взаимоисключающие типы периода."""
        resp = self.client.get("/api/entries/?period=month&year=2025")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_period_rejected(self):
        """Проверяет отклонение неизвестного периода."""
        resp = self.client.get("/api/entries/?period=decade")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("period", resp.data["error"]["fields"])

    def test_year_out_of_range_rejected(self):
        """Проверяет ограничение доступных календарных лет."""
        resp = self.client.get("/api/entries/?year=1800")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_response_contains_only_chart_fields(self):
        """Заметки и теги в графике не нужны и заметно утяжеляют ответ."""
        resp = self.client.get(CHART_URL)
        self.assertEqual(set(resp.data[0]), {"timestamp", "mood", "anxiety"})

    def test_entries_ordered_chronologically(self):
        """График строится слева направо — разворачивать массив не нужно."""
        resp = self.client.get(CHART_URL)
        timestamps = [e["timestamp"] for e in resp.data]
        self.assertEqual(timestamps, sorted(timestamps))

    def test_other_users_entries_excluded(self):
        """Проверяет изоляцию данных графика по владельцу."""
        bob = User.objects.create_user(
            username="chart_bob", password="Str0ng!Pass99"
        )
        MoodEntry.objects.create(user=bob, mood=_enc("9"))

        resp = self.client.get(CHART_URL)
        self.assertEqual(len(resp.data), 2)


class EntryWriteResponseTest(APITestCase):
    """Ответ на запись имеет ту же форму, что и на чтение."""

    def setUp(self):
        """Очищает кэш и создаёт пользователя с тегом."""
        cache.clear()
        self.user = User.objects.create_user(
            username="write_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)
        self.tag = Tag.objects.create(user=self.user, name="Отдых")

    def test_create_returns_tags_as_objects(self):
        """Проверяет формат тегов в ответе создания записи."""
        resp = self.client.post(
            "/api/entries/",
            {
                "mood": _enc("5"),
                "timestamp": (timezone.now() - timedelta(hours=1)).isoformat(),
                "tags": [self.tag.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            resp.data["tags"], [{"id": self.tag.id, "name": "Отдых"}]
        )

    def test_update_returns_tags_as_objects(self):
        """Проверяет формат тегов в ответе изменения записи."""
        entry = MoodEntry.objects.create(user=self.user, mood=_enc("5"))
        resp = self.client.put(
            f"/api/entries/{entry.id}/",
            {
                "mood": _enc("6"),
                "timestamp": entry.timestamp.isoformat(),
                "tags": [self.tag.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["tags"][0]["name"], "Отдых")

    def test_oversized_note_rejected(self):
        """Проверяет ограничение размера заметки."""
        resp = self.client.post(
            "/api/entries/",
            {"mood": _enc("5"), "note": "x" * (NOTE_MAX_LENGTH + 1)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("note", resp.data["error"]["fields"])

    def test_export_endpoint_removed(self):
        """Проверяет ответ для несуществующего эндпоинта экспорта."""
        resp = self.client.get("/api/entries/export/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class CacheKeyParamsTest(APITestCase):
    """В ключ кэша попадают только объявленные query-параметры."""

    def setUp(self):
        """Очищает кэш и создаёт пользователя с записью."""
        cache.clear()
        self.user = User.objects.create_user(
            username="key_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)
        MoodEntry.objects.create(user=self.user, mood=_enc("5"))

    def _cached_keys(self) -> set[str]:
        """Ключи кэшированных ответов пользователя.

        В том же Redis лежат счётчики троттлинга и ключ версии — они к делу
        не относятся, поэтому отбираем только записи вида entries:u<id>:.
        """
        return set(cache.keys(f"{CACHE_PREFIX}:u{self.user.id}:*"))

    def test_unknown_params_do_not_multiply_keys(self):
        """Иначе ?x=1, ?x=2, … забьют Redis копиями одного ответа."""
        self.client.get(CHART_URL)
        before = self._cached_keys()
        self.assertEqual(len(before), 1)

        for i in range(5):
            self.client.get(f"{CHART_URL}&junk={i}")

        self.assertEqual(self._cached_keys(), before)

    def test_declared_params_produce_separate_keys(self):
        """Разные периоды — разные данные, кэшируются раздельно."""
        self.client.get("/api/entries/?period=2weeks")
        self.client.get("/api/entries/?period=year")
        self.assertEqual(len(self._cached_keys()), 2)

    def test_version_key_survives_invalidation(self):
        """Проверяет бессрочное хранение ключа версии после инвалидации."""
        self.client.get(CHART_URL)
        entries_cache.invalidate(self.user.id)

        version_key = entries_cache._version_key(self.user.id)
        self.assertEqual(entries_cache._get_version(self.user.id), 2)
        self.assertIsNone(cache.ttl(version_key))

    def test_invalidation_makes_old_key_unreachable(self):
        """Старый ключ остаётся в Redis, но новым запросом уже не читается."""
        self.client.get(CHART_URL)
        stale_keys = self._cached_keys()
        self.assertEqual(len(stale_keys), 1)

        entries_cache.invalidate(self.user.id)
        self.client.get(CHART_URL)

        fresh_keys = self._cached_keys()
        self.assertEqual(len(fresh_keys), 2)
        self.assertTrue(stale_keys.isdisjoint(fresh_keys - stale_keys))


class DateRangeEndpointTest(APITestCase):
    """GET /api/entries/date-range/ — дата первой записи."""

    def setUp(self):
        """Очищает кэш и аутентифицирует пользователя."""
        cache.clear()
        self.user = User.objects.create_user(
            username="range_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

    def test_empty_history(self):
        """Проверяет ответ для дневника без записей."""
        resp = self.client.get("/api/entries/date-range/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIsNone(resp.data["first_date"])

    def test_returns_date_of_oldest_entry(self):
        """Проверяет дату самой ранней записи пользователя."""
        oldest = timezone.now() - timedelta(days=400)
        MoodEntry.objects.create(
            user=self.user, mood=_enc("5"), timestamp=oldest
        )
        MoodEntry.objects.create(user=self.user, mood=_enc("6"))

        resp = self.client.get("/api/entries/date-range/")
        self.assertEqual(
            resp.data["first_date"],
            timezone.localtime(oldest).date().isoformat(),
        )

    def test_other_users_entries_ignored(self):
        """Проверяет изоляцию диапазона дат по владельцу."""
        bob = User.objects.create_user(
            username="range_bob", password="Str0ng!Pass99"
        )
        MoodEntry.objects.create(
            user=bob,
            mood=_enc("5"),
            timestamp=timezone.now() - timedelta(days=900),
        )

        resp = self.client.get("/api/entries/date-range/")
        self.assertIsNone(resp.data["first_date"])


class AnonymousAccessTest(APITestCase):
    """Аноним не видит ни записей, ни тегов."""

    def test_entries_require_authentication(self):
        """Проверяет запрет списка записей для анонима."""
        resp = self.client.get(CHART_URL)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_grouped_requires_authentication(self):
        """Проверяет запрет сгруппированной ленты для анонима."""
        resp = self.client.get("/api/entries/grouped/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_date_range_requires_authentication(self):
        """Проверяет запрет диапазона дат для анонима."""
        resp = self.client.get("/api/entries/date-range/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_tags_require_authentication(self):
        """Проверяет запрет списка тегов для анонима."""
        resp = self.client.get("/api/tags/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_tag_creation_requires_authentication(self):
        """Проверяет запрет создания тега для анонима."""
        resp = self.client.post("/api/tags/", {"name": "Чужой"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class SnapshotEndpointTest(APITestCase):
    """GET /api/entries/snapshot/ — вся история для ссылки врачу."""

    def setUp(self):
        """Очищает кэш и создаёт пользователя с полной историей."""
        cache.clear()
        self.user = User.objects.create_user(
            username="snap_user", password="Str0ng!Pass99"
        )
        self.client.force_login(self.user)

        now = timezone.now()
        self.old = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("3"),
            note=_enc("давняя заметка"),
            anxiety=_enc("4"),
            timestamp=now - timedelta(days=400),
        )
        self.recent = MoodEntry.objects.create(
            user=self.user,
            mood=_enc("8"),
            timestamp=now - timedelta(days=1),
        )

    def test_returns_whole_history(self):
        """Период не задаётся: врач должен увидеть дневник целиком."""
        resp = self.client.get("/api/entries/snapshot/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2)

    def test_contains_notes(self):
        """Заметки — главное отличие от данных для графика."""
        resp = self.client.get("/api/entries/snapshot/")
        self.assertEqual(
            set(resp.data[0]), {"mood", "note", "anxiety", "timestamp"}
        )
        self.assertEqual(resp.data[0]["note"], _enc("давняя заметка"))

    def test_ordered_chronologically(self):
        """Проверяет хронологический порядок снапшота."""
        resp = self.client.get("/api/entries/snapshot/")
        timestamps = [item["timestamp"] for item in resp.data]
        self.assertEqual(timestamps, sorted(timestamps))

    def test_other_users_entries_excluded(self):
        """Проверяет изоляцию снапшота по владельцу."""
        bob = User.objects.create_user(
            username="snap_bob", password="Str0ng!Pass99"
        )
        MoodEntry.objects.create(user=bob, mood=_enc("9"))

        resp = self.client.get("/api/entries/snapshot/")
        self.assertEqual(len(resp.data), 2)

    def test_requires_authentication(self):
        """Проверяет запрет снапшота для анонимного клиента."""
        self.client.logout()
        resp = self.client.get("/api/entries/snapshot/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    @patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"snapshot": "2/minute"})
    def test_rate_limited(self):
        """Выгрузка всей истории — самая тяжёлая операция, лимит свой."""
        for _ in range(2):
            resp = self.client.get("/api/entries/snapshot/")
            self.assertEqual(resp.status_code, status.HTTP_200_OK)

        resp = self.client.get("/api/entries/snapshot/")
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(resp.data["error"]["code"], "rate_limited")
