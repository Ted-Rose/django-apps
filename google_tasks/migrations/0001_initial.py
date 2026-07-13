from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GoogleTaskList',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('list_id', models.CharField(max_length=255, unique=True)),
                ('title', models.CharField(max_length=255)),
                ('updated', models.DateTimeField(blank=True, null=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['title'],
                'unique_together': {('user', 'list_id')},
            },
        ),
        migrations.CreateModel(
            name='TaskLabel',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('color', models.CharField(default='#007bff', help_text='Hex color code', max_length=7)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['name'],
                'unique_together': {('user', 'name')},
            },
        ),
        migrations.CreateModel(
            name='GoogleTask',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('task_id', models.CharField(max_length=255, unique=True)),
                ('title', models.CharField(max_length=500)),
                ('notes', models.TextField(blank=True, null=True)),
                ('due_date', models.DateTimeField(blank=True, null=True)),
                ('status', models.CharField(choices=[('needsAction', 'Needs Action'), ('completed', 'Completed')], default='needsAction', max_length=20)),
                ('completed', models.DateTimeField(blank=True, null=True)),
                ('updated', models.DateTimeField(blank=True, null=True)),
                ('is_starred', models.BooleanField(default=False)),
                ('local_labels', models.ManyToManyField(blank=True, related_name='tasks', to='google_tasks.tasklabel')),
                ('task_list', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='tasks', to='google_tasks.googletasklist')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-updated'],
                'unique_together': {('user', 'task_id')},
            },
        ),
    ]
