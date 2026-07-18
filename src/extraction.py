"""Stage 1: turn each merchant evidence file into structured, cited facts.

Design choice — vision over OCR: the evidence mix is dominated by scans and
screenshots (delivery slips, AVS logs, T&C screenshots) where classic OCR
loses layout, tables, and stamps. GPT-4o reads images and PDF files natively,
so we send the file itself and ask for facts *with locations* ("page 3:
delivered 2025-11-02, signed"). Those locations become the analyst's
clickable pointers.

PDFs go up as file content parts (native PDF input), images as base64 data
URLs, and .txt/.md/.json as plain text. Anything else is skipped with an
explicit note in the workup rather than silently ignored.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Optional

from openai import OpenAI
from pydantic import BaseModel, Field

from . import config
from .llm import parse_with_retry
from .models import DocumentExtraction, ExtractedFact

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
TEXT_TYPES = {".txt", ".md", ".json", ".csv", ".log"}


class _ExtractionOut(BaseModel):
    """Schema enforced on the extraction call via structured outputs."""
    document_type: str = Field(description="e.g. 'delivery confirmation', 'AVS log', 'terms of service screenshot', 'order confirmation'")
    summary: str = Field(description="1-2 sentence summary of the document")
    facts: list[ExtractedFact]
    quality_notes: Optional[str] = Field(
        default=None,
        description="Legibility problems, missing pages, ambiguities, or signs the document may not be what it claims to be. Null if none.",
    )


EXTRACTION_PROMPT = """You are assisting a payments chargeback analyst. Extract every dispute-relevant fact from this merchant evidence document.

Focus on facts a chargeback analyst would need to verify compelling evidence: transaction dates and amounts, delivery dates/addresses/signatures, tracking numbers, AVS/CVV results, 3DS indicators, cardholder names and contact details, IP/device information, T&C clauses (refund/cancellation policy), and any communication between merchant and cardholder.

For every fact, record WHERE in the document it appears (page number, section, position) so the analyst can jump straight to it. Quote exact text where legible.

Be literal and neutral: report what the document actually shows, not what it implies. If a document looks related to a dispute but does not actually evidence anything (e.g. an order confirmation is not proof of delivery), still extract its facts faithfully — assessment happens later. In quality_notes report only substantive issues: illegible text, missing pages, or internal contradictions (dates/names/amounts that conflict). Plain formatting or absent logos/branding is normal for system exports and is not a concern."""


def _content_part_for(path: Path):
    ext = path.suffix.lower()
    if ext == ".pdf":
        data = base64.standard_b64encode(path.read_bytes()).decode()
        return {"type": "file",
                "file": {"filename": path.name,
                         "file_data": f"data:application/pdf;base64,{data}"}}
    if ext in IMAGE_TYPES:
        data = base64.standard_b64encode(path.read_bytes()).decode()
        return {"type": "image_url",
                "image_url": {"url": f"data:{IMAGE_TYPES[ext]};base64,{data}"}}
    if ext in TEXT_TYPES:
        return {"type": "text",
                "text": f"--- Document content ({path.name}) ---\n{path.read_text(errors='replace')}"}
    return None


def extract_document(client: OpenAI, filename: str) -> DocumentExtraction:
    path = config.DOCUMENTS_DIR / filename
    if not path.exists():
        return DocumentExtraction(
            filename=filename, document_type="unknown", summary="",
            error=f"File not found: {path}",
        )

    part = _content_part_for(path)
    if part is None:
        return DocumentExtraction(
            filename=filename, document_type="unsupported", summary="",
            error=f"Unsupported file type '{path.suffix}' — reviewed manually by analyst.",
        )

    completion = parse_with_retry(
        client,
        model=config.EXTRACTION_MODEL,
        max_completion_tokens=4096,
        messages=[{
            "role": "user",
            "content": [part, {"type": "text", "text": EXTRACTION_PROMPT}],
        }],
        response_format=_ExtractionOut,
    )
    out = completion.choices[0].message.parsed
    if out is None:
        return DocumentExtraction(
            filename=filename, document_type="unknown", summary="",
            error="Model returned no parseable extraction (possible refusal) — review manually.",
        )
    return DocumentExtraction(filename=filename, **out.model_dump())
