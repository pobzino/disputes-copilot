"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Action, CaseDetail, RowReview, Status, Workup } from "@/lib/types";
import { ACTION_META, CONF_COLOR } from "@/lib/ui";
import DocViewer, { DocTarget } from "./DocViewer";
import EvidenceTable from "./EvidenceTable";

export default function CaseView({
  detail,
  analysing,
  onAnalyse,
  onSaved,
}: {
  detail: CaseDetail;
  analysing: boolean;
  onAnalyse: (force: boolean) => void;
  onSaved: () => void;
}) {
  const c = detail.case;
  const w = detail.result?.workup ?? null;

  const [showExtraction, setShowExtraction] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const [rationale, setRationale] = useState("");
  // AI text stays clearly AI-authored until the analyst takes it over
  const [editingRationale, setEditingRationale] = useState(false);
  // Deliberately starts empty: the decision is the analyst's, not a pre-ticked AI default
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rowReviews, setRowReviews] = useState<Record<string, RowReview>>({});
  const [docTarget, setDocTarget] = useState<DocTarget | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [docList, setDocList] = useState<string[]>([]);
  const [docsChanged, setDocsChanged] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  function openManage() {
    setDocList(c.evidence_documents.map((d) => d.filename));
    setDocsChanged(false);
    setManageOpen(true);
  }

  function closeManage() {
    setManageOpen(false);
    if (docsChanged) onAnalyse(true); // evidence changed — the workup is stale, re-run
  }

  async function addEvidence(files: FileList | null) {
    if (!files?.length) return;
    setDocsBusy(true);
    try {
      const res = await api.uploadCaseDocuments(c.case_id, Array.from(files));
      setDocList(res.documents);
      setDocsChanged(true);
    } finally {
      setDocsBusy(false);
      if (evidenceInputRef.current) evidenceInputRef.current.value = "";
    }
  }

  async function removeEvidence(filename: string) {
    setDocsBusy(true);
    try {
      const res = await api.removeCaseDocument(c.case_id, filename);
      setDocList(res.documents);
      setDocsChanged(true);
    } finally {
      setDocsBusy(false);
    }
  }

  useEffect(() => {
    if (!manageOpen) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && closeManage();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageOpen, docsChanged]);

  useEffect(() => {
    setRationale(detail.decision?.analyst_rationale ?? w?.representment_rationale ?? "");
    setEditingRationale(!!detail.decision); // a saved rationale is the analyst's own
    setAction(detail.decision?.analyst_action ?? null);
    setNote("");
    setSaved(false);
    setShowExtraction(false);
    setRowReviews(detail.row_reviews ?? {});
    setDocTarget(null);
  }, [detail, w]);

  function reviewRow(
    index: number,
    verdict: "verified" | "wrong" | null,
    comment: string,
    correctedStatus?: Status | null,
  ) {
    // undefined = leave any existing correction in place; null = clear it
    const corr =
      correctedStatus === undefined
        ? (rowReviews[String(index)]?.corrected_status ?? null)
        : correctedStatus;
    setRowReviews((prev) => {
      const next = { ...prev };
      if (verdict === null && corr === null) delete next[String(index)];
      else next[String(index)] = { verdict, comment, corrected_status: corr };
      return next;
    });
    api.reviewRow(c.case_id, index, verdict, comment, corr).catch(() => {});
  }

  async function save() {
    if (!action) return;
    setSaving(true);
    try {
      await api.saveDecision(c.case_id, action, rationale, note || undefined);
      setSaved(true);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  /* ---------- building blocks ---------- */

  const fmtAmount = (v?: number | null, cur?: string | null) => {
    if (v == null) return "";
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur ?? "GBP" }).format(v);
    } catch {
      return `${v} ${cur ?? ""}`;
    }
  };

  const fmtDate = (s: unknown) => {
    if (typeof s !== "string") return null;
    const d = new Date(s);
    return isNaN(+d)
      ? null
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  const txnDate = fmtDate(c.transaction_metadata["transaction_date"]);
  const cbDate = fmtDate(c.transaction_metadata["chargeback_date"]);
  const daysBetween = (() => {
    const a = new Date(String(c.transaction_metadata["transaction_date"] ?? ""));
    const b = new Date(String(c.transaction_metadata["chargeback_date"] ?? ""));
    if (isNaN(+a) || isNaN(+b)) return null;
    return Math.round((+b - +a) / 86400000);
  })();

  const metaLine = (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h1 className="text-[16px] font-semibold tracking-tight">{c.merchant_name}</h1>
          <span className="font-mono text-[11.5px] text-muted">{c.case_id}</span>
          <span className="text-muted">·</span>
          <span className="text-[13.5px] font-semibold">{fmtAmount(c.amount, c.currency)}</span>
          <span className="text-muted">·</span>
          <span className="text-[12.5px] text-muted">
            <span className="font-semibold uppercase">{c.scheme} {c.reason_code}</span>
            {c.reason_code_label ? ` ${c.reason_code_label}` : ""}
          </span>
          {txnDate && cbDate && (
            <>
              <span className="text-muted">·</span>
              <span className="text-[12.5px] text-muted">
                paid {txnDate} → disputed {cbDate}
                {daysBetween !== null ? ` (${daysBetween}d)` : ""}
              </span>
            </>
          )}
        </div>
        {c.issuer_narrative && (
          <p className="mt-1.5 max-w-5xl border-l-2 border-line pl-3 text-[13px] leading-relaxed text-foreground/85">
            <span className="font-semibold text-muted">Issuer claims: </span>
            {c.issuer_narrative}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={openManage}
          disabled={analysing}
          title="Add or remove merchant evidence on this case"
          className="rounded-md border border-line px-3 py-1 text-[12.5px] text-muted hover:text-foreground disabled:opacity-50"
        >
          Manage evidence ({c.evidence_documents.length})
        </button>
        <button
          onClick={() => onAnalyse(!!w)}
          disabled={analysing}
          className="rounded-md border border-line px-3 py-1 text-[12.5px] text-muted hover:text-foreground disabled:opacity-50"
        >
          {analysing ? "Analysing…" : w ? "Re-analyse" : "Analyse"}
        </button>
      </div>
    </header>
  );

  const manageModal = manageOpen && (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={closeManage} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-background p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">Manage evidence · {c.case_id}</h2>
          <button
            onClick={closeManage}
            className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
          >
            {docsChanged ? "Done — re-analyse ⎋" : "Close ⎋"}
          </button>
        </div>

        <ul className="mt-3 space-y-1.5">
          {docList.map((fn) => (
            <li
              key={fn}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 py-2"
            >
              <span className="truncate font-mono text-[12px]" title={fn}>
                {fn}
              </span>
              <button
                onClick={() => removeEvidence(fn)}
                disabled={docsBusy}
                title="Detach this document from the case"
                className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
          {docList.length === 0 && (
            <li className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-muted">
              No evidence attached — the workup will treat this as no submission.
            </li>
          )}
        </ul>

        <div className="mt-3 flex items-center justify-between gap-3">
          <input
            ref={evidenceInputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.zip"
            onChange={(e) => addEvidence(e.target.files)}
          />
          <button
            onClick={() => evidenceInputRef.current?.click()}
            disabled={docsBusy}
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-foreground disabled:opacity-40"
          >
            {docsBusy ? "Working…" : "+ Add files"}
          </button>
          {docsChanged && (
            <span className="text-[11.5px]" style={{ color: "var(--amber)" }}>
              Evidence changed — re-analysis runs when you close
            </span>
          )}
        </div>
      </div>
    </>
  );

  const verdictBanner = (ww: Workup) => {
    const meta = ACTION_META[ww.recommended_action];
    const conf = ww.overall_confidence;
    const level = { high: 3, medium: 2, low: 1 }[conf];
    return (
      <div
        className="flex items-center gap-5 rounded-lg border border-line px-4 py-2.5"
        style={{
          borderLeft: `3px solid ${meta.color}`,
          background: `color-mix(in srgb, ${meta.color} 5%, var(--panel))`,
        }}
      >
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">
            AI recommendation
          </div>
          <div
            className="text-[21px] font-bold leading-tight tracking-tight"
            style={{ color: meta.color }}
          >
            {meta.label}
          </div>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted">
            Confidence
          </div>
          <div className="mt-1 flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-[5px] w-5 rounded-full"
                style={{ background: i < level ? CONF_COLOR[conf] : "var(--border)" }}
              />
            ))}
            <span
              className="ml-1.5 text-[11.5px] font-semibold capitalize"
              style={{ color: CONF_COLOR[conf] }}
            >
              {conf}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const crossCutting = (ww: Workup) =>
    ww.flags.length || ww.evidence_requests.length ? (
      <div className="space-y-1 text-[12.5px] leading-relaxed">
        {ww.flags.map((f, i) => (
          <div key={`f${i}`} className="flex gap-1.5">
            <span className="shrink-0 font-semibold" style={{ color: "var(--amber)" }}>
              ⚠ Verify:
            </span>
            <span className="text-foreground/80">{f}</span>
          </div>
        ))}
        {ww.evidence_requests.map((f, i) => (
          <div key={`r${i}`} className="flex gap-1.5">
            <span className="shrink-0 font-semibold" style={{ color: "#60a5fa" }}>
              → Ask merchant:
            </span>
            <span className="text-foreground/80">{f}</span>
          </div>
        ))}
      </div>
    ) : null;

  const rationaleArea = (ww: Workup, rows: number) =>
    editingRationale ? (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            Analyst rationale
          </span>
          <button
            onClick={() => setRationale(ww.representment_rationale)}
            className="text-[11px] text-muted underline decoration-line underline-offset-2 hover:text-foreground"
          >
            reset to AI draft
          </button>
        </div>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={rows}
          autoFocus
          placeholder="Representment rationale"
          className="mt-1 w-full rounded-md border border-line bg-panel-2 p-2.5 text-[13px] leading-relaxed outline-none focus:border-muted"
        />
      </div>
    ) : (
      <div className="rounded-md border border-dashed border-line bg-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            AI draft rationale · not filed
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setEditingRationale(true)}
              className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
            >
              ✎ Edit before filing
            </button>
            <button
              onClick={() => {
                setRationale("");
                setEditingRationale(true);
              }}
              className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
            >
              Write my own
            </button>
          </div>
        </div>
        <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-foreground/85">
          {rationale
            .split("\n")
            .filter((l) => l.trim())
            .map((l, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted">•</span>
                <span>{l.replace(/^-\s*/, "")}</span>
              </li>
            ))}
        </ul>
      </div>
    );

  const decisionCard = (ww: Workup, rows: number) => (
    <div className="rounded-lg border border-line bg-panel md:grid md:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-2 border-line p-3.5 md:border-r">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Decision
          </span>
          {detail.decision && <span className="text-[11px] text-muted">✓ saved</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(ACTION_META) as Action[]).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`rounded-md border px-2.5 py-1.5 text-left text-[12px] font-semibold whitespace-nowrap transition-colors ${
                action === a
                  ? "border-transparent text-black"
                  : "border-line text-muted hover:text-foreground"
              }`}
              style={action === a ? { background: ACTION_META[a].color } : undefined}
            >
              {ACTION_META[a].label}
              {ww.recommended_action === a ? " ·AI" : ""}
            </button>
          ))}
        </div>
        {action && action !== ww.recommended_action && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Overriding the AI — why?"
            className="w-full rounded-md border border-line bg-panel-2 p-2 text-[12.5px] outline-none focus:border-muted"
          />
        )}
        <div className="mt-auto pt-1">
          <button
            onClick={save}
            disabled={saving || !action}
            title={!action ? "Choose an action first" : undefined}
            className="w-full rounded-md bg-foreground py-2 text-[13px] font-semibold text-background disabled:opacity-40"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : !action ? "Choose an action" : "Save decision"}
          </button>
        </div>
      </div>
      <div className="min-w-0 p-3.5">{rationaleArea(ww, rows)}</div>
    </div>
  );

  /* ---------- page ---------- */

  if (!w) {
    return (
      <div className="px-6 py-4">
        {metaLine}
        <div className="mt-16 text-center text-muted">
          {analysing ? (
            <p>Reading documents and assessing evidence — 30–60s…</p>
          ) : (
            <p>Not analysed yet.</p>
          )}
        </div>
        {manageModal}
      </div>
    );
  }

  const rationaleRows = Math.min(8, Math.max(4, rationale.split("\n").length + 1));

  return (
    <div className="px-6 py-4">
      {metaLine}
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
        {verdictBanner(w)}
        <div className="min-w-[300px] flex-1">{crossCutting(w)}</div>
      </div>
      <p className="mt-2 max-w-5xl text-[13px] leading-relaxed text-muted">
        {w.action_justification}{" "}
        <button
          onClick={() => setShowRule(!showRule)}
          className="text-foreground/70 underline decoration-line underline-offset-2 hover:text-foreground"
        >
          {showRule ? "hide rule ▴" : "allegation & scheme rule ▾"}
        </button>
      </p>
      {showRule && (
        <div className="mt-2 max-w-5xl rounded-lg border border-line bg-panel p-4 text-[13px] leading-relaxed text-foreground/85">
          {w.reason_code_summary}
        </div>
      )}
      <div className="mt-3">{decisionCard(w, rationaleRows)}</div>
      <div className="mt-4">
        <EvidenceTable
          rows={w.evidence_assessment}
          reviews={rowReviews}
          onReview={reviewRow}
          onOpenDoc={setDocTarget}
        />
      </div>
      {docTarget && <DocViewer target={docTarget} onClose={() => setDocTarget(null)} />}

      <button
        onClick={() => setShowExtraction(!showExtraction)}
        className="mt-5 text-[12.5px] text-muted underline decoration-line underline-offset-2 hover:text-foreground"
      >
        {showExtraction ? "Hide" : "Show"} what was read from each document
      </button>
      {showExtraction && detail.result && (
        <div className="mt-3 space-y-4">
          {detail.result.extractions.map((ex) => (
            <div key={ex.filename} className="rounded-lg border border-line bg-panel p-4">
              <div className="font-mono text-[12.5px]">
                <button
                  onClick={() => setDocTarget({ filename: ex.filename })}
                  className="underline decoration-line underline-offset-2 hover:decoration-muted"
                >
                  {ex.filename}
                </button>{" "}
                <span className="text-muted">— {ex.document_type}</span>
              </div>
              {ex.error ? (
                <p className="mt-2 text-[13px]" style={{ color: "var(--red)" }}>
                  {ex.error}
                </p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-foreground/85">
                  {ex.facts.map((f, i) => (
                    <li key={i}>
                      <span className="font-mono text-[11.5px] text-muted">[{f.location}]</span>{" "}
                      {f.fact}
                      {f.verbatim_quote && (
                        <span className="italic text-muted"> — “{f.verbatim_quote}”</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {ex.quality_notes && (
                <p className="mt-2 text-[12.5px]" style={{ color: "var(--amber)" }}>
                  {ex.quality_notes}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 text-[11.5px] text-muted">
        Generated {detail.result?.generated_at} · {detail.result?.model}
      </p>
      {manageModal}
    </div>
  );
}
