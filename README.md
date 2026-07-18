# Disputes Copilot — Chargeback Representment Workup Tool

A tool that does the 18-minute grind of a chargeback case so the analyst can make the 90-second decision.

**The problem:** an analyst handling ~80 cases/day at ~18 minutes each faces ~24 hours of work in an 8-hour day. The decision itself is fast — the time goes into re-reading scheme rules, opening PDFs to check one date, and writing the rationale. This tool pulls the rule for the case's reason code, reads every merchant evidence document, maps each compelling-evidence requirement to `satisfied / partial / missing` **with a pointer to the exact document and page**, drafts the filing rationale, and recommends an action — which the analyst reviews, overrides, and owns.

## Quick start (< 10 minutes)

Two processes: a FastAPI backend (runs the LLM pipeline) and a Next.js frontend.

```bash
git clone https://github.com/pobzino/disputes-copilot.git && cd disputes-copilot

# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                              # add your OPENAI_API_KEY
uvicorn backend.main:app --port 8000              # terminal 1

# Frontend
cd frontend && npm install && npm run dev         # terminal 2
```

Open **http://localhost:3000**. The queue starts blank — either drop a cases JSON + its evidence files onto the dropzone, or click **"Import the bundled dataset"** to load the provided 10 cases from `data/`. Then **"Analyse N pending"** runs the pipeline (~30–60s per case; results cache in `output/workups/`, so each case is paid for once). CLI equivalents: `python scripts/run_all.py` and `python scripts/eval.py`.

## What the analyst sees

One screen per case:

1. **Header** — merchant, case ID, amount, scheme + reason code, transaction→chargeback timeline. **Manage evidence** adds or removes merchant documents on the case (e.g. after a request_more_evidence round) — one re-analysis runs when you close it; zips are unpacked automatically.
2. **Case brief** — the issuer's claim side by side with the AI recommendation (represent / accept_liability / request_more_evidence), confidence meter, justification, and a toggle for what the scheme requires (the reason-code summary).
3. **Decision card** — the analyst's unit: action buttons (deliberately *unselected* — the AI's suggestion is only tagged `·AI`; save is disabled until the analyst actively chooses), an override-reason prompt when deviating, and the rationale. The rationale renders as a read-only **"AI draft — not filed"** until the analyst clicks *Edit before filing* or *Write my own* — nothing filed is silently AI-authored.
4. **Evidence table** — the scheme's defence checklist, one row per compelling-evidence requirement:
   `status | requirement (+ the claim element it tests) | evidence file + page | reasoning + verbatim quote | ⚠ verify (manual checks) | → ask merchant (forwardable request) | confidence | analyst ✓/✗ + comment`
   - **Click any evidence file** → the PDF opens at the cited page with the quoted text **highlighted** (pdf.js text-layer matching against the AI's verbatim quotes — it only marks text that is actually there).
   - **Click any status pill** → a modal to correct the status, with a **required reason** before confirming. Corrected rows show `ANALYST · AI said ~~satisfied~~`.

## How it works

```
cases.json ──┐
             │   Stage 1: EXTRACTION (one LLM call per document)
documents ───┼─► PDFs/images sent natively to the model (vision); returns
             │   structured facts WITH locations and verbatim quotes:
             │   "page 8: TF-9051 delivered 22 Apr, signed" — these become
             │   the analyst's pointers and the viewer's highlights
             │
reason_codes.md ─► rules section for this reason code (deterministic lookup,
             │     parsed once — the model never searches the whole rules file;
             │     see scripts/convert_rules_pdf.py for the PDF→md conversion)
             │
             ▼   Stage 2: ASSESSMENT (one LLM call per case)
        Structured workup (schema-enforced): reason-code summary,
        per-requirement grid (status/source/quote/reasoning/confidence/
        checks/merchant request), bullet rationale, action + justification
             │
             ▼
        FastAPI backend ── Next.js analyst UI
             │
             ▼
        output/feedback.jsonl — every analyst decision, row verdict, and
        status correction logged against what the AI said (the improvement loop)
```

### Design decisions & tradeoffs

**Vision over OCR.** The evidence mix is scans and screenshots — delivery slips, AVS logs, T&C screenshots — where classic OCR loses tables, stamps, and layout. Documents go to the model natively; extraction returns facts *with locations and quotes*, which power both the table's pointers and the PDF highlighting. Tradeoff: per-document API cost vs. an OCR pipeline; for this evidence mix, accuracy and citability win. Unsupported file types surface explicitly ("not processed — review manually"), never silently dropped.

**Two-stage pipeline, not one mega-prompt.** Extraction (document → cited facts) is separate from assessment (facts + rules → workup). Each prompt stays small and auditable, citations come for free, and the assessment can never "remember" something that isn't in a named document. A bad extraction is visible in the UI's "what was read" panel.

**Relevance ≠ satisfaction.** The assessment prompt explicitly separates topically-related documents from requirement-satisfying ones (order confirmation ≠ proof of delivery; a T&C page ≠ evidence of acceptance) — the exact trap merchants fall into. A status only reaches `satisfied` with a citable pointer.

**Content, not graphic design.** An early eval run marked a legitimate delivery proof "partial" because the synthetic PDF lacked a carrier logo. The fix is a prompt principle — assess content; authenticity doubts go to the Verify column, not the status — found via the eval, fixed in the prompt, verified by re-run. That loop is the point of the tool's feedback log at scale.

**The analyst owns the decision.** No pre-ticked defaults: the action starts unselected, the rationale starts as a labelled AI draft, overrides require a stated reason. This isn't just UX hygiene — it makes the logged agreement rate a real measurement instead of default-acceptance bias.

**Confidence does something.** Low-confidence rows are flagged for manual verification, per-requirement checks land in a dedicated Verify column, and dispositive metadata signals (e.g. successful 3DS on a fraud code) are surfaced in the relevant requirement's checks.

### The feedback loop (`output/feedback.jsonl`)

Three grains of feedback, all logged with the AI's position at the time:

- **Case decisions** — analyst action vs. AI recommendation, rationale edited or not, override reason.
- **Row verdicts** — ✓ verified / ✗ wrong per requirement, with comment.
- **Status corrections** — "AI said satisfied at medium confidence; analyst says partial, because …" with a mandatory reason. Each one is a ready-made labelled eval case.

`/api/stats` aggregates agreement rate and **agreement by AI confidence** — a calibrated tool should be agreed with more when it's confident. In production this file is the process architect's instrument: disagreements become eval/prompt-tuning cases, and drift in agreement flags scheme-rule or merchant-behaviour changes.

### Model strategy: accuracy first, then cost

Default model is the most capable available (`gpt-5.6`, set in `.env`); cost is optimised second without giving accuracy back. `scripts/eval.py` measures action agreement against labels in `data/expected_actions.json` (the three the assignment README discloses). `OPENAI_EXTRACTION_MODEL` can route the extraction stage (the volume driver — one call per document) to a cheaper tier independently; keep the downshift only if the eval holds. A case with 2–3 documents runs 3–4 API calls, ~30–60s, a few cents. At production scale: analyse on case arrival (not analyst-open), Batch API for the overnight queue, and distil extraction onto a small model once the feedback log provides enough labelled pairs.

## Repo layout

```
backend/main.py         FastAPI: cases, uploads, analysis, documents, decisions, row reviews, stats
frontend/               Next.js analyst UI (queue, workup, evidence viewer with citation highlighting)
scripts/run_all.py      batch pre-processor CLI (cached; safe to re-run)
scripts/eval.py         action-agreement eval vs hand labels
scripts/convert_rules_pdf.py  Reason Codes.pdf → data/reason_codes.md
src/config.py           paths + model config (env-overridable)
src/models.py           pydantic schemas incl. tolerant case loader
src/store.py            case store (starts blank; upload/import to fill)
src/rules.py            reason_codes.md section lookup per reason code
src/extraction.py       stage 1 — document → cited facts (vision)
src/assessment.py       stage 2 — facts + rules → workup
src/llm.py              structured-output call helper with retry
src/pipeline.py         orchestration + disk cache
src/feedback.py         decisions, row reviews, status corrections, stats
data/                   assignment dataset (cases, documents, rules, eval labels)
output/                 (gitignored) cached workups + feedback log
```

## What I'd build next

- **Region highlighting on images** — the PDF highlighter is text-layer based; PNGs would need the vision model to return bounding boxes.
- **Deterministic pre-checks** before the LLM runs (deadline eligibility, liability-shift short-circuits) — cheap code where code suffices.
- **Case sharing / discussion** — link a case to a teammate with the workup and analyst annotations attached.
- **Promoted eval loop** — feedback-log disagreements auto-promoted to the labelled eval set; prompt changes gated on agreement.

## Scope notes

Per the brief: no auth, no production error handling, simplified scheme rules only, and recommendations are decision support — the analyst always makes the call.
