"""FastAPI backend for the Disputes Copilot Next.js frontend.

Run:  uvicorn backend.main:app --port 8000 --reload
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from openai import OpenAI
from pydantic import BaseModel

from src import config, feedback, pipeline, store

app = FastAPI(title="Disputes Copilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


def _case_summary(c) -> dict:
    cached = pipeline.load_cached_result(c.case_id)
    decision = feedback.load_decisions().get(c.case_id)
    return {
        "case_id": c.case_id,
        "scheme": c.scheme,
        "reason_code": c.reason_code,
        "reason_code_label": c.reason_code_label,
        "merchant_name": c.merchant_name,
        "amount": c.amount,
        "currency": c.currency,
        "documents": [d.filename for d in c.evidence_documents],
        "analysed": cached is not None,
        "recommended_action": cached.workup.recommended_action.value if cached else None,
        "confidence": cached.workup.overall_confidence.value if cached else None,
        "flags": len(cached.workup.flags) if cached else 0,
        "decision": decision,
    }


@app.get("/api/cases")
def list_cases():
    return [_case_summary(c) for c in store.list_cases()]


@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    c = store.get_case(case_id)
    if not c:
        raise HTTPException(404, "case not found")
    cached = pipeline.load_cached_result(case_id)
    return {
        "case": c.model_dump(),
        "result": cached.model_dump() if cached else None,
        "decision": feedback.load_decisions().get(case_id),
        "row_reviews": feedback.load_row_reviews().get(case_id, {}),
    }


@app.post("/api/cases/{case_id}/analyse")
def analyse_case(case_id: str, force: bool = False):
    c = store.get_case(case_id)
    if not c:
        raise HTTPException(404, "case not found")
    result = pipeline.run_case(c, client=client(), force=force)
    return result.model_dump()


@app.post("/api/upload/cases")
async def upload_cases(file: UploadFile = File(...)):
    """Accept a cases JSON file: a single case object or an array of cases."""
    try:
        raw = json.loads(await file.read())
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"not valid JSON: {e}")
    if isinstance(raw, dict) and "cases" in raw:
        raw = raw["cases"]
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        raise HTTPException(400, "expected a case object or an array of cases")
    ids = store.add_cases(raw)
    return {"imported": ids}


@app.post("/api/upload/documents")
async def upload_documents(files: list[UploadFile] = File(...)):
    """Accept evidence files (PDF/PNG/JPG/TXT); stored by filename for cases to reference."""
    saved = []
    for f in files:
        name = Path(f.filename or "unnamed").name  # strip any path components
        store.save_document(name, await f.read())
        saved.append(name)
    return {"saved": saved}


@app.post("/api/cases/{case_id}/documents")
async def add_case_documents(case_id: str, files: list[UploadFile] = File(...)):
    """Attach new evidence to an existing case (e.g. merchant responded to a
    request_more_evidence). Caller should re-analyse afterwards."""
    if not store.get_case(case_id):
        raise HTTPException(404, "case not found")
    saved = []
    for f in files:
        name = Path(f.filename or "unnamed").name
        store.save_document(name, await f.read())
        saved.append(name)
    all_docs = store.add_documents(case_id, saved)
    return {"saved": saved, "documents": all_docs}


@app.delete("/api/cases/{case_id}/documents/{filename}")
def remove_case_document(case_id: str, filename: str):
    """Detach a document from a case. Caller should re-analyse afterwards."""
    docs = store.remove_document_ref(case_id, Path(filename).name)
    if docs is None:
        raise HTTPException(404, "case not found")
    return {"documents": docs}


@app.get("/api/documents/{filename}")
def get_document(filename: str):
    """Serve an evidence file so the UI can show it next to its citation."""
    path = config.DOCUMENTS_DIR / Path(filename).name  # basename only — no traversal
    if not path.exists():
        raise HTTPException(404, "document not found")
    media = {
        ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
        ".txt": "text/plain", ".md": "text/plain",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media,
                        content_disposition_type="inline")


@app.post("/api/import-bundled")
def import_bundled():
    """One-click import of the assignment dataset shipped in data/."""
    ids = store.import_bundled()
    return {"imported": ids}


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: str):
    if not store.remove_case(case_id):
        raise HTTPException(404, "case not found")
    return {"deleted": case_id}


class RowReviewIn(BaseModel):
    index: int
    verdict: str | None = None  # "verified" | "wrong" | None to clear
    comment: str = ""
    corrected_status: str | None = None  # analyst's replacement status


@app.post("/api/cases/{case_id}/row-review")
def review_row(case_id: str, body: RowReviewIn):
    cached = pipeline.load_cached_result(case_id)
    if not cached:
        raise HTTPException(400, "case has no workup yet")
    rows = cached.workup.evidence_assessment
    if not 0 <= body.index < len(rows):
        raise HTTPException(400, "row index out of range")
    if body.verdict not in (None, "verified", "wrong"):
        raise HTTPException(400, "verdict must be 'verified', 'wrong', or null")
    if body.corrected_status not in (None, "satisfied", "partial", "missing"):
        raise HTTPException(400, "corrected_status must be satisfied/partial/missing or null")
    r = rows[body.index]
    feedback.record_row_review(
        case_id=case_id, index=body.index, verdict=body.verdict,
        comment=body.comment, requirement=r.requirement,
        ai_status=r.status.value, ai_confidence=r.confidence.value,
        corrected_status=body.corrected_status,
    )
    return {"ok": True}


class DecisionIn(BaseModel):
    analyst_action: str
    analyst_rationale: str
    note: str | None = None


@app.post("/api/cases/{case_id}/decision")
def save_decision(case_id: str, body: DecisionIn):
    cached = pipeline.load_cached_result(case_id)
    if not cached:
        raise HTTPException(400, "case has no workup yet")
    w = cached.workup
    feedback.record_decision(
        case_id=case_id,
        ai_action=w.recommended_action.value,
        analyst_action=body.analyst_action,
        ai_rationale=w.representment_rationale,
        analyst_rationale=body.analyst_rationale,
        ai_confidence=w.overall_confidence.value,
        agreement_note=body.note,
    )
    return {"ok": True}


@app.get("/api/stats")
def stats():
    return feedback.feedback_stats() | {"model": config.MODEL}
