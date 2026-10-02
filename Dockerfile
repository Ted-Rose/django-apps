# React frontend — built in a node stage so the final image has no
# node_modules; only frontend_dist/ is copied over.
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
# --include=dev: parity with build_files.sh — if NODE_ENV=production
# ever propagates here, plain `npm ci` would skip devDependencies
# (vite/tsc) and break `npm run build` below.
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

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
COPY --from=frontend /frontend_dist /app/frontend_dist

# Compile gettext catalogs (pure-Python polib — msgfmt is absent).
# The console_tasks' other steps no-op without their env vars.
RUN python django_apps/console_tasks/build.py

# collectstatic needs settings to import, which requires
# private_settings.json (dockerignored). Create a build-time dummy,
# collect, then remove it — the GCP runtime uses env vars instead.
# Keep this strict: a silent failure here ships a site with no JS/CSS.
RUN python -c "import json; json.dump({'SECRET_KEY': 'build-time-dummy', 'DEBUG': False, 'BASE_URL': '', 'DATABASES': {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}}, open('private_settings.json', 'w'))" \
    && python manage.py collectstatic --noinput \
    && rm private_settings.json

EXPOSE 8080

CMD exec gunicorn --bind :$PORT --workers 2 --threads 4 --timeout 0 --preload django_apps.wsgi:application
