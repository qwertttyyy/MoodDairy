"""Теги становятся пользовательскими: у каждого свой набор.

Таблица уже пуста после 0003, поэтому обязательное поле user добавляется
без временного значения по умолчанию.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("entries", "0003_drop_global_tags"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="tag",
            name="name",
            field=models.CharField(max_length=50, verbose_name="Название"),
        ),
        migrations.AddField(
            model_name="tag",
            name="user",
            field=models.ForeignKey(
                default=None,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="tags",
                to=settings.AUTH_USER_MODEL,
                verbose_name="Пользователь",
            ),
            preserve_default=False,
        ),
        migrations.AddConstraint(
            model_name="tag",
            constraint=models.UniqueConstraint(
                fields=("user", "name"), name="uniq_tag_name_per_user"
            ),
        ),
    ]
