"""Чистит справочник общих тегов перед переводом их в пользовательские.

Теги были общими для всех и не использовались, поэтому данные не переносятся.
Связи с записями уходят каскадом, сами записи остаются нетронутыми.

Отдельная миграция от 0004: PostgreSQL не разрешает менять схему таблицы
в той же транзакции, где были удалены её строки (pending trigger events).
"""

from django.db import migrations


def drop_all_tags(apps, schema_editor):
    Tag = apps.get_model("entries", "Tag")
    Tag.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("entries", "0002_moodentry_anxiety"),
    ]

    operations = [
        migrations.RunPython(drop_all_tags, migrations.RunPython.noop),
    ]
