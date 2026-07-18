"""Batch pre-processor: run the pipeline over every case and cache workups.

Run this once after `git clone` so the UI opens with everything analysed:
    python scripts/run_all.py            # skips already-cached cases
    python scripts/run_all.py --force    # re-run everything
    python scripts/run_all.py CASE-003   # single case
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openai import OpenAI

from src import pipeline


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    force = "--force" in sys.argv

    client = OpenAI()
    cases = pipeline.load_cases()
    if args:
        cases = [c for c in cases if c.case_id in args]
        if not cases:
            sys.exit(f"No case matched {args}")

    for i, case in enumerate(cases, 1):
        cached = pipeline.load_cached_result(case.case_id)
        if cached and not force:
            print(f"[{i}/{len(cases)}] {case.case_id}: cached, skipping")
            continue
        print(f"[{i}/{len(cases)}] {case.case_id}: analysing "
              f"({len(case.evidence_documents)} document(s))")
        result = pipeline.run_case(case, client=client, force=force,
                                   progress=lambda m: print(f"    {m}"))
        w = result.workup
        print(f"    → {w.recommended_action.value} "
              f"(confidence: {w.overall_confidence.value}, flags: {len(w.flags)})")

    print("\nDone. Launch the UI with: streamlit run app.py")


if __name__ == "__main__":
    main()
