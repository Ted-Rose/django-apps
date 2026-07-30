from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('google_tasks', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='googletask',
            name='starred_order',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
