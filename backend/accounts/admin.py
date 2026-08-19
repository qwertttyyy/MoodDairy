from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User

from .models import UserProfile


class UserProfileInline(admin.StackedInline):
    """Показывает профиль на странице пользователя в админке."""

    model = UserProfile
    can_delete = False
    readonly_fields = ("encryption_salt",)


class UserAdmin(BaseUserAdmin):
    """Добавляет профиль к стандартной административной форме пользователя."""

    inlines = (UserProfileInline,)


admin.site.unregister(User)
admin.site.register(User, UserAdmin)
