"""Stage 2: assess extracted evidence against the scheme's compelling-evidence
requirements and produce the analyst-ready workup.

The assessment call never sees the raw documents — only the cited facts from
stage 1 plus the relevant rules section. That keeps the prompt small and makes
every conclusion traceable to a quoted fact in a named document.
"""
from __future__ import annotations

import json

from openai import OpenAI

from . import config, rules
from .llm import parse_with_retry
from .models import ChargebackCase, DocumentExtraction, Workup

SYSTEM_PROMPT = """You are an expert chargeback representment analyst at a payment service provider. You prepare workups that a human analyst reviews, edits, and files — your output is a draft, not a decision.

Core principles:

1. REQUIREMENT-BY-REQUIREMENT. Assess each compelling-evidence requirement in the provided scheme rules separately. One entry per requirement.

2. RELEVANCE IS NOT SATISFACTION. Merchants frequently upload documents that are topically related but do not meet the requirement — an order confirmation when proof of delivery is required, a shipping label with no delivery scan, T&Cs with no evidence the cardholder accepted them, an AVS log for a different transaction. Mark these 'partial' or 'missing' and explain the gap precisely. Never upgrade a requirement to 'satisfied' because a document is merely on-topic.

3. CITE OR ADMIT. Every 'satisfied' or 'partial' must point to a specific document and location with a supporting quote where available. If you cannot point to evidence, the status is 'missing'.

4. SURFACE UNCERTAINTY ON THE ROW. Use confidence honestly: 'high' only when the evidence is unambiguous and clearly on this transaction; 'low' when dates/amounts/names don't clearly tie the evidence to the disputed transaction, when legibility is poor, or when the requirement interpretation is debatable. Anything the analyst must personally verify goes in that requirement's analyst_checks; anything to request from the merchant for that requirement goes in its merchant_request. Reserve the workup-level flags and evidence_requests ONLY for genuinely cross-cutting items that don't belong to a single requirement (e.g. a liability-shift signal in transaction metadata) — do not duplicate row-level items there.

5. ASSESS CONTENT, NOT GRAPHIC DESIGN. Evidence documents are routinely plain system exports (carrier APIs, gateway logs, CRM printouts) with no logos, letterhead, barcodes, or branding — that is normal and is NOT grounds for downgrading a status. Downgrade only for substantive gaps or internal contradictions (dates, names, amounts, or addresses that don't tie to the disputed transaction). If you have a genuine authenticity doubt, keep the status based on content and put the doubt in flags for the analyst to verify at source.

6. DERIVE THE ACTION FROM THE GRID:
   - represent: the material requirements are satisfied with credible, transaction-linked evidence.
   - request_more_evidence: there is a fixable gap — the merchant plausibly has the missing item (e.g. they shipped but uploaded the wrong proof). List exactly what to ask for, specific enough to forward to the merchant verbatim.
   - accept_liability: requirements cannot be met (e.g. evidence contradicts the merchant's position, no delivery ever happened, 3DS/AVS data supports the cardholder) or nothing fixable remains.
   Also check transaction metadata for dispositive signals (e.g. successful 3DS authentication on a fraud reason code often shifts liability to the issuer) and flag them.

7. RATIONALE IS FOR FILING. Write representment_rationale as 3-5 bullet lines, each starting with "- ", each making one point in the professional register of a case file. Lead with the decisive facts (what the evidence proves), then the conclusion. The analyst should be able to file it with light edits.

8. WRITE FOR A GLANCE. The reader is an analyst working 80 cases a day. In every field:
   - Lead with the key point. Then the evidence detail if needed.
   - Short plain sentences. At most 2 sentences per reasoning entry, 1 per check or request, unless a contradiction genuinely needs unpacking.
   - Never use em dashes or en dashes. Use commas or start a new sentence.
   - No hedging filler ('it appears that', 'it should be noted', 'however, it is important to'), no restating the requirement text back, no legalese.
   Example reasoning: 'Delivery scan matches the billing address and predates the chargeback. Signed WHITFORD, matching cardholder M. Whitford.'"""


def _format_case(case: ChargebackCase) -> str:
    meta = json.dumps(case.transaction_metadata, indent=2, default=str)
    return f"""CASE {case.case_id}
Scheme: {case.scheme}
Reason code: {case.reason_code}{f' ({case.reason_code_label})' if case.reason_code_label else ''}
Merchant: {case.merchant_name or 'n/a'} (MCC {case.mcc or 'n/a'})
Amount: {case.amount} {case.currency or ''}

Transaction metadata:
{meta}

Issuer narrative (what the issuing bank submitted on behalf of the cardholder):
{case.issuer_narrative or '(none provided)'}"""


def _format_extractions(extractions: list[DocumentExtraction]) -> str:
    if not extractions:
        return "THE MERCHANT SUBMITTED NO EVIDENCE DOCUMENTS."
    parts = []
    for ex in extractions:
        if ex.error:
            parts.append(f"### {ex.filename}\nNOT PROCESSED: {ex.error}")
            continue
        facts = "\n".join(
            f"- [{f.location}] {f.fact}" + (f' — "{f.verbatim_quote}"' if f.verbatim_quote else "")
            for f in ex.facts
        ) or "- (no dispute-relevant facts found)"
        quality = f"\nQuality notes: {ex.quality_notes}" if ex.quality_notes else ""
        parts.append(f"### {ex.filename} ({ex.document_type})\n{ex.summary}\nFacts:\n{facts}{quality}")
    return "\n\n".join(parts)


def assess_case(client: OpenAI, case: ChargebackCase,
                extractions: list[DocumentExtraction]) -> Workup:
    rule_text = rules.rules_for(case.scheme, case.reason_code)

    user_prompt = f"""{_format_case(case)}

=== SCHEME RULES FOR THIS REASON CODE ===
{rule_text}

=== MERCHANT EVIDENCE (facts extracted from uploaded documents, with locations) ===
{_format_extractions(extractions)}

Produce the representment workup."""

    completion = parse_with_retry(
        client,
        model=config.MODEL,
        max_completion_tokens=8192,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format=Workup,
    )
    workup = completion.choices[0].message.parsed
    if workup is None:
        raise RuntimeError(f"Model returned no parseable workup for {case.case_id}")
    return workup
