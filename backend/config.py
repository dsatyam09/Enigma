import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]


def load_app_env() -> None:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(BACKEND_DIR / ".env")


def get_allowed_origins() -> list[str]:
    raw_origins = os.getenv("APP_ALLOWED_ORIGINS", "")
    parsed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    print(parsed_origins)
    return parsed_origins or DEFAULT_ALLOWED_ORIGINS.copy()


load_app_env()
