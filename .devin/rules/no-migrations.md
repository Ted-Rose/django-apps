---
description: "Never run database migrations"
trigger: always_on
---

Never run database migrations (`python manage.py migrate`, `makemigrations`,
or any equivalent command). Migrations are managed outside of agent sessions.
