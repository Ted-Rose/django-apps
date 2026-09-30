#!/bin/bash
set -e

# Vercel's build image uses a uv-managed Python (PEP 668), which refuses
# pip installs into the system environment — build inside a venv instead.
if command -v uv >/dev/null 2>&1; then
  # Pin to 3.12 (same as the lambda runtime in vercel.json): newer Pythons
  # have no psycopg2-binary==2.9.9 wheels and Django 4.2 doesn't support them.
  uv venv --python 3.12 /tmp/build-venv
  source /tmp/build-venv/bin/activate
  uv pip install -r requirements.txt
else
  python3 -m venv /tmp/build-venv
  source /tmp/build-venv/bin/activate
  python3 -m pip install -r requirements.txt
fi

python3 django_apps/console_tasks/build.py create_ca_pem create_private_settings_json

# Collect static files
python3 manage.py collectstatic --noinput

# Create Vercel-compatible output vercel directory
mkdir -p .vercel/output/static
cp -r staticfiles/* .vercel/output/static/

python3 manage.py makemigrations
python3 manage.py migrate
