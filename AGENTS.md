# Project Guidelines for AI Agents

## Documentation and Planning

### Plan Files
When the user requests writing a plan to a markdown file, always save it in the `docs/plans/` directory.

Example:
- ✅ `docs/plans/FEATURE_IMPLEMENTATION_PLAN.md`
- ❌ `FEATURE_IMPLEMENTATION_PLAN.md` (root directory)
- ❌ `docs/FEATURE_IMPLEMENTATION_PLAN.md` (docs directory)

## Database

### Migrations
Never run database migrations (`python manage.py migrate`, `makemigrations`,
or any equivalent command). Migrations are managed outside of agent sessions.
