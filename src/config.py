"""Central configuration. Everything is overridable via environment variables."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.getenv("DATA_DIR", PROJECT_ROOT / "data"))
DOCUMENTS_DIR = DATA_DIR / "documents"
CASES_FILE = DATA_DIR / "cases.json"
REASON_CODES_FILE = DATA_DIR / "reason_codes.md"

OUTPUT_DIR = PROJECT_ROOT / "output"
WORKUPS_DIR = OUTPUT_DIR / "workups"
DECISIONS_FILE = OUTPUT_DIR / "decisions.json"
FEEDBACK_FILE = OUTPUT_DIR / "feedback.jsonl"
ROW_REVIEWS_FILE = OUTPUT_DIR / "row_reviews.json"

# Accuracy-first model strategy: default to the most capable model to establish
# the accuracy ceiling; downshift per-stage via env once the eval set shows a
# cheaper tier holds. Extraction is the natural first candidate to downshift.
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6")
EXTRACTION_MODEL = os.getenv("OPENAI_EXTRACTION_MODEL", MODEL)

OUTPUT_DIR.mkdir(exist_ok=True)
WORKUPS_DIR.mkdir(exist_ok=True)
