from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase


class ConfigViewTest(APITestCase):
    """GET /api/config/ — публичный флаг шифрования и CSRF-cookie."""

    URL = "/api/config/"

    @override_settings(ENCRYPTION_ENABLED=True)
    def test_anonymous_gets_encryption_enabled_true(self):
        response = self.client.get(self.URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"encryption_enabled": True})

    @override_settings(ENCRYPTION_ENABLED=False)
    def test_anonymous_gets_encryption_enabled_false(self):
        response = self.client.get(self.URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"encryption_enabled": False})

    def test_response_sets_csrf_cookie(self):
        response = self.client.get(self.URL)

        self.assertIn("csrftoken", response.cookies)
        self.assertTrue(response.cookies["csrftoken"].value)
