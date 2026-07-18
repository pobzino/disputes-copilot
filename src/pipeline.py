"""Orchestration: load cases, run extraction + assessment, cache results.

Workups are cached as JSON under output/workups/ so the UI is instant after the
first run and re-running the batch never re-spends tokens on unchanged cases.
In production this pipeline would run when the case lands in the queue, not
when the analyst opens it.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from openai import OpenAI

from . import config
from .assessment import assess_case
from .extraction import extract_document
from .models import CaseResult, ChargebackCase


def load_cases() -> list[ChargebackCase]:
    raw = json.loads(config.CASES_FILE.read_text())
    if isinstance(raw, dict):  # tolerate {"cases": [...]} wrappers
        raw = raw.get("cases", raw.get("data", []))
    return [ChargebackCase.from_raw(r) for r in raw]


def _workup_path(case_id: str):
    return config.WORKUPS_DIR / f"{case_id}.json"


def load_cached_result(case_id: str) -> CaseResult | None:
    path = _workup_path(case_id)
    if path.exists():
        try:
            return CaseResult.model_validate_json(path.read_text())
        except Exception:
            return None  # stale schema — regenerate
    return None


def run_case(case: ChargebackCase, client: OpenAI | None = None,
             force: bool = False, progress=None) -> CaseResult:
    """Run the full pipeline for one case. Returns cached result unless force."""
    if not force:
        cached = load_cached_result(case.case_id)
        if cached:
            return cached

    client = client or OpenAI()

    extractions = []
    for i, doc in enumerate(case.evidence_documents):
        if progress:
            progress(f"Reading {doc.filename} ({i + 1}/{len(case.evidence_documents)})")
        extractions.append(extract_document(client, doc.filename))

    if progress:
        progress("Assessing evidence against scheme rules")
    workup = assess_case(client, case, extractions)

    result = CaseResult(
        case_id=case.case_id,
        workup=workup,
        extractions=extractions,
        model=config.MODEL,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    _workup_path(case.case_id).write_text(result.model_dump_json(indent=2))
    return result
