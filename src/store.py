"""Case store for the API: starts empty, cases arrive via upload.

Raw case dicts live in output/cases_store.json; uploaded evidence files are
written into data/documents/ so the extraction stage finds them. The bundled
assignment dataset (data/cases.json) can be imported with one call.
"""
from __future__ import annotations

import json

from . import config
from .models import ChargebackCase

STORE_FILE = config.OUTPUT_DIR / "cases_store.json"


def _load_raw() -> list[dict]:
    if STORE_FILE.exists():
        return json.loads(STORE_FILE.read_text())
    return []


def _save_raw(raw: list[dict]) -> None:
    STORE_FILE.write_text(json.dumps(raw, indent=2))


def list_cases() -> list[ChargebackCase]:
    return [ChargebackCase.from_raw(r) for r in _load_raw()]


def get_case(case_id: str) -> ChargebackCase | None:
    return next((c for c in list_cases() if c.case_id == case_id), None)


def add_cases(new_raw: list[dict]) -> list[str]:
    """Merge new raw case dicts into the store (replace on case_id collision).
    Returns the ids added/updated."""
    raw = _load_raw()
    by_id = {ChargebackCase.from_raw(r).case_id: r for r in raw}
    ids = []
    for r in new_raw:
        cid = ChargebackCase.from_raw(r).case_id
        by_id[cid] = r
        ids.append(cid)
    _save_raw(list(by_id.values()))
    return ids


def remove_case(case_id: str) -> bool:
    raw = _load_raw()
    kept = [r for r in raw if ChargebackCase.from_raw(r).case_id != case_id]
    if len(kept) == len(raw):
        return False
    _save_raw(kept)
    return True


DOC_KEYS = ("merchant_evidence_documents", "evidence_documents", "documents",
            "evidence", "merchant_evidence")


def add_documents(case_id: str, filenames: list[str]) -> list[str]:
    """Append evidence filenames to an existing case's document list
    (e.g. the merchant responded to a request_more_evidence)."""
    raw = _load_raw()
    for r in raw:
        if ChargebackCase.from_raw(r).case_id != case_id:
            continue
        key = next((k for k in DOC_KEYS if k in r), "merchant_evidence_documents")
        existing = r.setdefault(key, [])
        names = {d if isinstance(d, str) else d.get("filename") for d in existing}
        for fn in filenames:
            if fn not in names:
                existing.append(fn)
        _save_raw(raw)
        return [d if isinstance(d, str) else d.get("filename") for d in existing]
    return []


def remove_document_ref(case_id: str, filename: str) -> list[str] | None:
    """Detach a document from a case (the file stays on disk — other cases may
    reference the same name). Returns the case's remaining document list."""
    raw = _load_raw()
    for r in raw:
        if ChargebackCase.from_raw(r).case_id != case_id:
            continue
        key = next((k for k in DOC_KEYS if k in r), None)
        if key is None:
            return []
        r[key] = [d for d in r[key]
                  if (d if isinstance(d, str) else d.get("filename")) != filename]
        _save_raw(raw)
        return [d if isinstance(d, str) else d.get("filename") for d in r[key]]
    return None


def save_document(filename: str, content: bytes) -> str:
    config.DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = config.DOCUMENTS_DIR / filename
    path.write_bytes(content)
    return filename


def import_bundled() -> list[str]:
    """Import data/cases.json (the assignment dataset) into the store.
    Documents are already in data/documents/."""
    if not config.CASES_FILE.exists():
        return []
    raw = json.loads(config.CASES_FILE.read_text())
    if isinstance(raw, dict):
        raw = raw.get("cases", raw.get("data", []))
    return add_cases(raw)
