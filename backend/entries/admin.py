from django.contrib import admin

from .models import MoodEntry, Tag


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "user")
    search_fields = ("name", "user__username")
    list_select_related = ("user",)


@admin.register(MoodEntry)
class MoodEntryAdmin(admin.ModelAdmin):
    """mood, note и anxiety зашифрованы клиентом — отображать бессмысленно."""

    list_display = ("id", "user", "get_tags", "timestamp")
    list_filter = ("timestamp",)
    search_fields = ("user__username",)
    readonly_fields = ("user", "timestamp", "created_at", "updated_at")
    exclude = ("mood", "note", "anxiety")
    filter_horizontal = ("tags",)

    def get_queryset(self, request):
        """Без этого каждая строка списка стоит двух лишних запросов."""
        return (
            super()
            .get_queryset(request)
            .select_related("user")
            .prefetch_related("tags")
        )

    @admin.display(description="Теги")
    def get_tags(self, obj: MoodEntry) -> str:
        return ", ".join(t.name for t in obj.tags.all())

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False
