"""Analyst decisions + the feedback loop.

Two stores:

- output/decisions.json — current status of each case (pending / reviewed),
  the analyst's final action and edited rationale. Drives the dashboard.

- output/feedback.jsonl — append-only log of every analyst decision alongside
  what the AI recommended. This file is the improvement loop: agreement rate is
  the tool's KPI, disagreements become prompt-tuning cases, and a drift in
  agreement over time is an early warning that scheme rules changed.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from . import config


def load_decisions() -> dict:
    if config.DECISIONS_FILE.exists():
        return json.loads(config.DECISIONS_FILE.read_text())
    return {}


def record_decision(case_id: str, ai_action: str, analyst_action: str,
                    ai_rationale: str, analyst_rationale: str,
                    ai_confidence: str, agreement_note: Optional[str] = None) -> None:
    now = datetime.now(timezone.utc).isoformat()

    decisions = load_decisions()
    decisions[case_id] = {
        "status": "reviewed",
        "analyst_action": analyst_action,
        "analyst_rationale": analyst_rationale,
        "reviewed_at": now,
    }
    config.DECISIONS_FILE.write_text(json.dumps(decisions, indent=2))

    entry = {
        "timestamp": now,
        "case_id": case_id,
        "ai_recommendation": ai_action,
        "analyst_action": analyst_action,
        "agreed": ai_action == analyst_action,
        "ai_confidence": ai_confidence,
        "ai_rationale": ai_rationale,
        "analyst_rationale": analyst_rationale,
        "rationale_edited": ai_rationale.strip() != analyst_rationale.strip(),
        "note": agreement_note,
    }
    with config.FEEDBACK_FILE.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def load_row_reviews() -> dict:
    """{case_id: {row_index_str: {verdict, comment, ...}}}"""
    if config.ROW_REVIEWS_FILE.exists():
        return json.loads(config.ROW_REVIEWS_FILE.read_text())
    return {}


def record_row_review(case_id: str, index: int, verdict: Optional[str],
                      comment: str, requirement: str,
                      ai_status: str, ai_confidence: str,
                      corrected_status: Optional[str] = None) -> None:
    """Analyst verdict on one requirement row: 'verified', 'wrong', or None to clear.
    corrected_status is the analyst's replacement status when they disagree with
    the AI's — the highest-resolution feedback we collect."""
    now = datetime.now(timezone.utc).isoformat()
    reviews = load_row_reviews()
    case_reviews = reviews.setdefault(case_id, {})
    key = str(index)
    if verdict is None and corrected_status is None:
        case_reviews.pop(key, None)
    else:
        case_reviews[key] = {
            "verdict": verdict,
            "comment": comment,
            "requirement": requirement,
            "ai_status": ai_status,
            "corrected_status": corrected_status,
            "ai_confidence": ai_confidence,
            "reviewed_at": now,
        }
    config.ROW_REVIEWS_FILE.write_text(json.dumps(reviews, indent=2))

    with config.FEEDBACK_FILE.open("a") as f:
        f.write(json.dumps({
            "type": "row_review", "timestamp": now, "case_id": case_id,
            "row_index": index, "verdict": verdict, "comment": comment,
            "requirement": requirement, "ai_status": ai_status,
            "corrected_status": corrected_status,
            "ai_confidence": ai_confidence,
        }) + "\n")


def feedback_stats() -> dict:
    """Aggregate stats: case-level agreement plus row-level verification rates."""
    entries = []
    if config.FEEDBACK_FILE.exists():
        entries = [json.loads(line) for line in config.FEEDBACK_FILE.read_text().splitlines() if line.strip()]
    decisions = [e for e in entries if e.get("type", "decision") == "decision"]

    stats: dict = {"total": len(decisions)}
    if decisions:
        by_conf: dict[str, list[bool]] = {}
        for e in decisions:
            by_conf.setdefault(e.get("ai_confidence", "unknown"), []).append(e["agreed"])
        stats.update({
            "agreement_rate": sum(e["agreed"] for e in decisions) / len(decisions),
            "rationale_edit_rate": sum(e.get("rationale_edited", False) for e in decisions) / len(decisions),
            "agreement_by_confidence": {
                conf: {"n": len(v), "rate": sum(v) / len(v)} for conf, v in by_conf.items()
            },
            "disagreements": [e for e in decisions if not e["agreed"]],
        })

    # Row-level: current state (not the audit log), so cleared/changed verdicts don't double-count
    rows = [r for case in load_row_reviews().values() for r in case.values()]
    if rows:
        wrong = [r for r in rows if r["verdict"] == "wrong"]
        by_conf_rows: dict[str, list[bool]] = {}
        for r in rows:
            by_conf_rows.setdefault(r.get("ai_confidence", "unknown"), []).append(r["verdict"] == "verified")
        stats["rows"] = {
            "total": len(rows),
            "verified": len(rows) - len(wrong),
            "wrong": len(wrong),
            "verified_rate_by_confidence": {
                conf: {"n": len(v), "rate": sum(v) / len(v)} for conf, v in by_conf_rows.items()
            },
            "wrong_rows": wrong,
        }
    return stats
