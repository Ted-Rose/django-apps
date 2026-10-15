import os
import re
import textwrap
from django.conf import settings
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent.parent

def create_ca_pem():
    print("Starting to create 'ca.pem'...")
    capem_content = os.environ.get('capem')
    if capem_content:
        print("capem_content found")
        blocks = re.findall(
            r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----",
            capem_content,
            re.DOTALL,
        )
        if not blocks:
            print("No certificates found in 'capem'.")
            return

        pem_parts = []
        for block in blocks:
            base64_content = re.sub(r"\s+", "", block)
            formatted_content = textwrap.fill(base64_content, 64)
            # Add the header and footer back with line breaks as
            # required for pem files
            pem_parts.append(
                "-----BEGIN CERTIFICATE-----\n"
                f"{formatted_content}\n"
                "-----END CERTIFICATE-----"
            )
        pem_content = "\n".join(pem_parts)
        file_path = os.path.join(BASE_DIR, 'ca.pem')

        with open(file_path, 'w') as file:
            file.write(pem_content)
        print(f"'ca.pem' has been created at {file_path}.")
    else:
        print("Environment variable 'capem' is not set.")


def create_config_yaml():
    print("Starting to create 'config.yaml'...")
    config_yaml_str = os.environ.get('config_yaml')
    if config_yaml_str:
        file_path = os.path.join(BASE_DIR, 'config.yaml')
        with open(file_path, 'w') as file:
            file.write(config_yaml_str)
        print(f"'config.yaml' has been created at {file_path}.")
    else:
        print("Environment variable 'config_yaml' is not set.")


def compile_po():
    """Compile committed locale/**/*.po catalogs to .mo with polib.

    msgfmt is not installed on either build target (Docker slim
    image, Vercel build image), so the compile step is pure Python
    and runs identically everywhere. .mo files are gitignored — the
    .po sources are the committed artifact.
    """
    import polib

    locale_dir = BASE_DIR / 'locale'
    compiled = 0
    for po_path in sorted(
        locale_dir.glob('*/LC_MESSAGES/*.po')
    ):
        mo_path = po_path.with_suffix('.mo')
        polib.pofile(str(po_path)).save_as_mofile(str(mo_path))
        compiled += 1
        print(f"Compiled {po_path} -> {mo_path}")
    if not compiled:
        print("No .po files found under locale/.")


create_ca_pem()
create_config_yaml()
compile_po()
