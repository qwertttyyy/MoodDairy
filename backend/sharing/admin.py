from django.contrib import admin

from .models import SharedAccess


@admin.register(SharedAccess)
class SharedAccessAdmin(admin.ModelAdmin):
    """Настраивает просмотр ссылок без содержимого их блобов."""

    list_display = (
        "token_short",
        "user",
        "is_active",
        "is_encrypted",
        "created_at",
    )
    list_filter = ("is_active", "is_encrypted")
    list_select_related = ("user",)
    readonly_fields = (
        "token",
        "user",
        "is_encrypted",
        "created_at",
        "expires_at",
    )
    exclude = ("data_blob",)

    @admin.display(description="Token")
    def token_short(self, obj: SharedAccess) -> str:
        """Возвращает сокращённый токен для списка ссылок."""
        return f"{obj.token[:12]}…"
