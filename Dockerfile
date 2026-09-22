FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org -r requirements.txt

COPY . .

# collectstatic needs settings to import, which requires
# private_settings.json (dockerignored). Create a build-time dummy,
# collect, then remove it — the GCP runtime uses env vars instead.
# Keep this strict: a silent failure here ships a site with no JS/CSS.
RUN python -c "import json; json.dump({'SECRET_KEY': 'build-time-dummy', 'DEBUG': False, 'BASE_URL': '', 'DATABASES': {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}, 'ESV_KEY': ''}, open('private_settings.json', 'w'))" \
    && python manage.py collectstatic --noinput \
    && rm private_settings.json

EXPOSE 8080

CMD exec gunicorn --bind :$PORT --workers 2 --threads 4 --timeout 0 --preload django_apps.wsgi:application
