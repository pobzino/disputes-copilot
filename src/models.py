"""Pydantic models for cases and the structured representment workup.

The workup schema is the contract between the LLM and the UI: every field the
analyst sees is defined here, and the same pydantic models are enforced on the
API calls via structured outputs (`chat.completions.parse`), so the model
cannot return a malformed workup.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input side: a chargeback case
# ---------------------------------------------------------------------------

class EvidenceDocument(BaseModel):
    filename: str
    description: Optional[str] = None


class ChargebackCase(BaseModel):
    case_id: str
    scheme: str  # "visa" | "mastercard"
    reason_code: str
    reason_code_label: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    merchant_name: Optional[str] = None
    mcc: Optional[str] = None
    issuer_narrative: str = ""
    transaction_metadata: dict[str, Any] = Field(default_factory=dict)
    evidence_documents: list[EvidenceDocument] = Field(default_factory=list)

    @classmethod
    def from_raw(cls, raw: dict[str, Any]) -> "ChargebackCase":
        """Tolerant loader: normalises common field-name variants so the real
        dataset drops in even if its schema differs slightly from ours."""
        def pick(*keys, default=None):
            for k in keys:
                if k in raw and raw[k] is not None:
                    return raw[k]
            return default

        docs_raw = pick("merchant_evidence_documents", "evidence_documents", "documents",
                        "evidence", "merchant_evidence", default=[])
        docs = []
        for d in docs_raw:
            if isinstance(d, str):
                docs.append(EvidenceDocument(filename=d))
            elif isinstance(d, dict):
                docs.append(EvidenceDocument(
                    filename=d.get("filename") or d.get("file") or d.get("path") or d.get("name", ""),
                    description=d.get("description") or d.get("type"),
                ))

        txn = pick("transaction_metadata", "transaction", "metadata", "txn", default={})
        # Merge unrecognised top-level keys into transaction metadata so
        # nothing from the real dataset is silently dropped.
        known = {
            "case_id", "id", "scheme", "network", "card_scheme", "reason_code",
            "reason_code_label", "reason_code_description", "amount", "currency",
            "merchant_name", "merchant", "mcc", "issuer_narrative", "narrative",
            "issuer_reason_text", "transaction_metadata", "transaction", "metadata",
            "txn", "evidence_documents", "documents", "evidence", "merchant_evidence",
            "merchant_evidence_documents",
        }
        extra = {k: v for k, v in raw.items() if k not in known}
        txn = {**txn, **extra}

        merchant = pick("merchant_name", "merchant", default=None)
        if isinstance(merchant, dict):
            txn.setdefault("merchant", merchant)
            merchant = merchant.get("name")
        # merchant details may live inside the transaction object
        merchant = merchant or txn.get("merchant_name")
        mcc = pick("mcc") or txn.get("merchant_mcc") or txn.get("mcc")

        # amount may be flat, or a {value, currency} object (top-level or in txn)
        amount, currency = pick("amount"), pick("currency")
        for candidate in (pick("chargeback_amount"), amount, txn.get("amount")):
            if isinstance(candidate, dict):
                amount = candidate.get("value")
                currency = currency or candidate.get("currency")
                break

        return cls(
            case_id=str(pick("case_id", "id", default="unknown")),
            scheme=str(pick("scheme", "network", "card_scheme", default="unknown")).lower(),
            reason_code=str(pick("reason_code", default="unknown")),
            reason_code_label=pick("reason_code_label", "reason_code_description"),
            amount=amount,
            currency=currency,
            merchant_name=merchant,
            mcc=str(mcc) if mcc else None,
            issuer_narrative=pick("issuer_narrative", "narrative", "issuer_reason_text", default=""),
            transaction_metadata=txn,
            evidence_documents=docs,
        )


# ---------------------------------------------------------------------------
# Intermediate: facts extracted from one evidence document
# ---------------------------------------------------------------------------

class ExtractedFact(BaseModel):
    fact: str
    location: str  # e.g. "page 3", "top of screenshot"
    verbatim_quote: Optional[str] = None


class DocumentExtraction(BaseModel):
    filename: str
    document_type: str
    summary: str
    facts: list[ExtractedFact] = Field(default_factory=list)
    quality_notes: Optional[str] = None  # legibility issues, missing pages, etc.
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Output side: the representment workup
# ---------------------------------------------------------------------------

class RequirementStatus(str, Enum):
    satisfied = "satisfied"
    partial = "partial"
    missing = "missing"


class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class RecommendedAction(str, Enum):
    represent = "represent"
    accept_liability = "accept_liability"
    request_more_evidence = "request_more_evidence"


class RequirementAssessment(BaseModel):
    requirement: str
    status: RequirementStatus
    source_document: Optional[str] = None
    source_location: Optional[str] = None
    supporting_quote: Optional[str] = None
    reasoning: str
    confidence: Confidence
    analyst_checks: list[str] = Field(
        default_factory=list,
        description="Specific things the analyst should verify by hand for THIS requirement.")
    merchant_request: Optional[str] = Field(
        default=None,
        description="If this requirement has a fixable gap: exactly what to ask the merchant for, forwardable verbatim.")


class Workup(BaseModel):
    reason_code_summary: str
    evidence_assessment: list[RequirementAssessment]
    representment_rationale: str
    recommended_action: RecommendedAction
    action_justification: str
    evidence_requests: list[str] = Field(default_factory=list)
    overall_confidence: Confidence
    flags: list[str] = Field(default_factory=list)


class CaseResult(BaseModel):
    """Everything the pipeline produces for one case, cached to disk."""
    case_id: str
    workup: Workup
    extractions: list[DocumentExtraction] = Field(default_factory=list)
    model: str = ""
    generated_at: str = ""
