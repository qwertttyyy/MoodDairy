from django.contrib import admin

from .models import SharedAccess


@admin.register(SharedAccess)
class SharedAccessAdmin(admin.ModelAdmin):
    list_display = (
        "token_short",
        "user",
        "is_active",
        "is_encrypted",
        "created_at",
    )
    list_filter = ("is_active", "is_encrypted")
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
        return f"{obj.token[:12]}…"
