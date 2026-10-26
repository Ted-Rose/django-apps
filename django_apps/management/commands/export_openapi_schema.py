from pathlib import Path
from typing import Any

from ninja.management.commands.export_openapi_schema import (
    Command as ExportOpenAPISchema,
)


class Command(ExportOpenAPISchema):
    """ninja's export writes json.dumps() verbatim — no trailing
    newline — but the committed frontend/openapi.json keeps one
    (CI's drift check appends it before diffing), so a verbatim
    regen always looked one byte stale. Appending it here makes
    the documented regen command produce the committable file
    directly. Requires django_apps to precede ninja in
    INSTALLED_APPS (earlier apps win command resolution)."""

    def handle(self, *args: Any, **options: Any) -> None:
        super().handle(*args, **options)
        output = options['output']
        if output:
            with Path(output).open('ab') as f:
                f.write(b'\n')
