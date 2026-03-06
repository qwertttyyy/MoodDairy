from django.contrib import admin

from .models import MoodEntry, Tag


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("id", "name")
    search_fields = ("name",)


@admin.register(MoodEntry)
class MoodEntryAdmin(admin.ModelAdmin):
    """mood и note зашифрованы клиентом — отображать бессмысленно."""

    list_display = ("id", "user", "get_tags", "timestamp")
    list_filter = ("tags", "timestamp")
    search_fields = ("user__username",)
    readonly_fields = ("user", "timestamp", "created_at", "updated_at")
    exclude = ("mood", "note")
    filter_horizontal = ("tags",)

    @admin.display(description="Теги")
    def get_tags(self, obj: MoodEntry) -> str:
        return ", ".join(t.name for t in obj.tags.all())

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False
