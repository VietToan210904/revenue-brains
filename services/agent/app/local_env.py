import os
from pathlib import Path


def load_local_env() -> None:
    if os.getenv("APP_ENV") == "production":
        return

    root_env = Path(__file__).resolve().parents[3] / ".env"
    if not root_env.exists():
        return

    for raw_line in root_env.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
