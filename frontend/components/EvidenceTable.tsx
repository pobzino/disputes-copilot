"use client";

import { useEffect, useState } from "react";
import { RequirementAssessment, RowReview, Status } from "@/lib/types";
import { CONF_COLOR, STATUS_META } from "@/lib/ui";
import { DocTarget } from "./DocViewer";

const ALL_STATUSES: Status[] = ["satisfied", "partial", "missing"];

function cleanQuote(q: string): string {
  return q.replace(/^["“”'\s]+|["“”'\s]+$/g, "");
}

/* The quote field packs fragments like: "Tracking: RM98..."; "M. Whitford"
   Split them out so the PDF viewer can highlight each one. */
function quoteFragments(q?: string | null): string[] {
  if (!q) return [];
  const matched = [...q.matchAll(/["“]([^"“”]{4,}?)["”]/g)].map((m) => m[1]);
  return matched.length ? matched : [cleanQuote(q)];
}

export default function EvidenceTable({
  rows,
  reviews,
  onReview,
  onOpenDoc,
}: {
  rows: RequirementAssessment[];
  reviews: Record<string, RowReview>;
  onReview: (
    index: number,
    verdict: "verified" | "wrong" | null,
    comment: string,
    correctedStatus?: Status | null,
  ) => void;
  onOpenDoc: (target: DocTarget) => void;
}) {
  const [modalRow, setModalRow] = useState<number | null>(null);
  const [chosenStatus, setChosenStatus] = useState<Status | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (modalRow === null) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setModalRow(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [modalRow]);

  function openModal(i: number) {
    const review = reviews[String(i)];
    setChosenStatus(review?.corrected_status ?? rows[i].status);
    setReason(review?.comment ?? "");
    setModalRow(i);
  }

  function confirmCorrection() {
    if (modalRow === null || !chosenStatus) return;
    onReview(modalRow, "wrong", reason.trim(), chosenStatus);
    setModalRow(null);
  }

  function revertToAI() {
    if (modalRow === null) return;
    const review = reviews[String(modalRow)];
    onReview(modalRow, null, review?.comment ?? "", null);
    setModalRow(null);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full table-fixed text-[13px] leading-normal">
        <colgroup>
          <col className="w-[96px]" />
          <col className="w-[14%]" />
          <col className="w-[13%]" />
          <col />
          <col className="w-[15%]" />
          <col className="w-[15%]" />
          <col className="w-[56px]" />
          <col className="w-[116px]" />
        </colgroup>
        <thead>
          <tr className="bg-panel text-left text-[10.5px] uppercase tracking-wider text-muted">
            <th className="px-2.5 py-2 font-medium">Check</th>
            <th className="px-2.5 py-2 font-medium">Requirement</th>
            <th className="px-2.5 py-2 font-medium">Evidence</th>
            <th className="px-2.5 py-2 font-medium">Reasoning</th>
            <th className="px-2.5 py-2 font-medium" style={{ color: "var(--amber)" }}>⚠ Verify</th>
            <th className="px-2.5 py-2 font-medium" style={{ color: "#60a5fa" }}>→ Ask merchant</th>
            <th className="px-2.5 py-2 font-medium">Conf</th>
            <th className="px-2.5 py-2 font-medium">Analyst</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = STATUS_META[r.status];
            const review = reviews[String(i)];
            // The model may join sources with ";", "," or "and"; only real files are clickable
            const parts = (r.source_document ?? "")
              .split(/;|,|\band\b/i)
              .map((d) => d.trim())
              .filter(Boolean);
            const docs = parts.filter((p) => /\.(pdf|png|jpe?g|gif|webp|txt|md)$/i.test(p));
            const nonFiles = parts.filter((p) => !/\.(pdf|png|jpe?g|gif|webp|txt|md)$/i.test(p));
            return (
              <tr key={i} className="border-t border-line align-top">
                <td className="px-2.5 py-2.5">
                  {review?.corrected_status ? (
                    <>
                      <button
                        onClick={() => openModal(i)}
                        title="Analyst-corrected status — click to change"
                        className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide text-black ring-1 ring-white/40"
                        style={{ background: STATUS_META[review.corrected_status].color }}
                      >
                        {STATUS_META[review.corrected_status].label}
                      </button>
                      <div className="mt-1 text-[9.5px] uppercase tracking-wide text-muted">
                        analyst · AI said{" "}
                        <span className="line-through">{s.label.toLowerCase()}</span>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => openModal(i)}
                      title="Disagree? Click to set the correct status"
                      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide text-black hover:ring-1 hover:ring-white/40"
                      style={{ background: s.color }}
                    >
                      {s.label}
                    </button>
                  )}
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="font-medium">{r.requirement}</div>
                  {r.claim_addressed && (
                    <div className="mt-1 text-[11.5px] italic leading-snug text-muted">
                      tests: “{r.claim_addressed}”
                    </div>
                  )}
                </td>
                <td className="px-2.5 py-2.5 font-mono text-[11.5px]">
                  {parts.length ? (
                    <>
                      {docs.map((d) => (
                        <button
                          key={d}
                          onClick={() =>
                            onOpenDoc({
                              filename: d,
                              location: r.source_location,
                              quotes: quoteFragments(r.supporting_quote),
                            })
                          }
                          title={`Open ${d} with the cited text highlighted`}
                          className="block max-w-full truncate text-left text-foreground/85 underline decoration-line underline-offset-2 hover:text-foreground hover:decoration-muted"
                        >
                          {d}
                        </button>
                      ))}
                      {nonFiles.map((p) => (
                        <div key={p} className="truncate text-muted" title={p}>
                          {p}
                        </div>
                      ))}
                      {r.source_location && (
                        <div
                          className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-muted"
                          title={r.source_location}
                        >
                          ↳ {r.source_location}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="opacity-40">—</span>
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-foreground/90">
                  {r.reasoning}
                  {r.supporting_quote && (
                    <div className="mt-1 border-l-2 border-line pl-2 text-[12px] italic text-muted">
                      “{cleanQuote(r.supporting_quote)}”
                    </div>
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-[12px] text-foreground/80">
                  {r.analyst_checks?.length ? (
                    <ul className="space-y-1.5">
                      {r.analyst_checks.map((chk, k) => (
                        <li key={k} className="flex gap-1">
                          <span className="shrink-0" style={{ color: "var(--amber)" }}>·</span>
                          {chk}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </td>
                <td className="px-2.5 py-2.5 text-[12px] text-foreground/80">
                  {r.merchant_request ?? <span className="opacity-30">—</span>}
                </td>
                <td className="px-2.5 py-2.5">
                  <span
                    className="text-[10.5px] font-bold uppercase"
                    style={{ color: CONF_COLOR[r.confidence] }}
                  >
                    {r.confidence}
                  </span>
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        onReview(i, review?.verdict === "verified" ? null : "verified", review?.comment ?? "")
                      }
                      title="Mark verified"
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
                        review?.verdict === "verified"
                          ? "border-transparent text-black"
                          : "border-line text-muted hover:text-foreground"
                      }`}
                      style={review?.verdict === "verified" ? { background: "var(--green)" } : undefined}
                    >
                      ✓
                    </button>
                    <button
                      onClick={() =>
                        onReview(i, review?.verdict === "wrong" ? null : "wrong", review?.comment ?? "")
                      }
                      title="Mark wrong"
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
                        review?.verdict === "wrong"
                          ? "border-transparent text-black"
                          : "border-line text-muted hover:text-foreground"
                      }`}
                      style={review?.verdict === "wrong" ? { background: "var(--red)" } : undefined}
                    >
                      ✗
                    </button>
                  </div>
                  {review && (
                    <textarea
                      defaultValue={review.comment}
                      key={`${i}-${review.verdict}`}
                      placeholder={review.verdict === "wrong" ? "What's wrong?" : "Comment"}
                      rows={2}
                      onBlur={(e) => {
                        if (e.target.value !== review.comment)
                          onReview(i, review.verdict, e.target.value);
                      }}
                      className="mt-1 w-full rounded-md border border-line bg-panel p-1.5 text-[11.5px] leading-snug outline-none placeholder:text-muted/60 focus:border-muted"
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {modalRow !== null && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setModalRow(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-background p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold">Change check status</h2>
              <button
                onClick={() => setModalRow(null)}
                className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
              >
                Cancel ⎋
              </button>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[12.5px] text-muted">
              {rows[modalRow].requirement}
            </p>

            <div className="mt-3 flex gap-1.5">
              {ALL_STATUSES.map((st) => (
                <button
                  key={st}
                  onClick={() => setChosenStatus(st)}
                  className={`flex-1 rounded-md border px-2 py-2 text-[12px] font-semibold capitalize transition-colors ${
                    chosenStatus === st
                      ? "border-transparent text-black"
                      : "border-line text-muted hover:text-foreground"
                  }`}
                  style={chosenStatus === st ? { background: STATUS_META[st].color } : undefined}
                >
                  {st}
                  {st === rows[modalRow].status ? " ·AI" : ""}
                </button>
              ))}
            </div>

            {chosenStatus !== rows[modalRow].status && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Why is the AI's status wrong? Required — this feeds the improvement loop."
                className="mt-3 w-full rounded-md border border-line bg-panel-2 p-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted/60 focus:border-muted"
              />
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              {reviews[String(modalRow)]?.corrected_status ? (
                <button
                  onClick={revertToAI}
                  className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:text-foreground"
                >
                  Revert to AI status
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={confirmCorrection}
                disabled={chosenStatus === rows[modalRow].status || !reason.trim()}
                title={
                  chosenStatus === rows[modalRow].status
                    ? "Pick a status different from the AI's"
                    : !reason.trim()
                      ? "A reason is required"
                      : undefined
                }
                className="rounded-md bg-foreground px-4 py-1.5 text-[12.5px] font-semibold text-background disabled:opacity-40"
              >
                Confirm change
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
