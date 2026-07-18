"""Tiny eval harness: compare the AI's recommended action against hand labels.

Hand-label the expected action per case in data/expected_actions.json:
    {"CASE-001": "represent", "CASE-002": "request_more_evidence", ...}

Then:  python scripts/eval.py   (runs pipeline on any un-cached case first)

This is deliberately small — the point is that the LLM is measured, not
trusted. The same labels + output/feedback.jsonl are the seed of a real eval
set as analysts review cases.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import config, pipeline

EXPECTED_FILE = config.DATA_DIR / "expected_actions.json"


def main():
    if not EXPECTED_FILE.exists():
        sys.exit(f"No labels found. Create {EXPECTED_FILE} first.")
    expected = json.loads(EXPECTED_FILE.read_text())

    cases = {c.case_id: c for c in pipeline.load_cases()}
    correct, results = 0, []
    for case_id, want in expected.items():
        case = cases.get(case_id)
        if not case:
            results.append((case_id, want, "CASE NOT FOUND", False))
            continue
        result = pipeline.run_case(case)
        got = result.workup.recommended_action.value
        ok = got == want
        correct += ok
        results.append((case_id, want, got, ok))

    print(f"\n{'case':<12} {'expected':<24} {'got':<24} ok")
    print("-" * 66)
    for case_id, want, got, ok in results:
        print(f"{case_id:<12} {want:<24} {got:<24} {'✓' if ok else '✗'}")
    print(f"\nAgreement: {correct}/{len(expected)} ({correct / len(expected):.0%})")


if __name__ == "__main__":
    main()
