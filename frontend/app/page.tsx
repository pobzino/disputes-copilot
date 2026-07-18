"use client";

import { useCallback, useEffect, useState } from "react";
import CaseView from "@/components/CaseView";
import UploadPanel from "@/components/UploadPanel";
import { api } from "@/lib/api";
import { CaseDetail, CaseSummary } from "@/lib/types";
import { ACTION_META } from "@/lib/ui";

export default function Home() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [analysing, setAnalysing] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  useEffect(() => {
    if (!showUpload) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setShowUpload(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showUpload]);

  const refreshCases = useCallback(async () => {
    try {
      const list = await api.listCases();
      setCases(list);
      setApiDown(false);
      return list;
    } catch {
      setApiDown(true);
      setCases([]);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshCases();
  }, [refreshCases]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    api.getCase(selected).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  async function analyse(id: string, force: boolean) {
    setAnalysing((s) => new Set(s).add(id));
    try {
      await api.analyse(id, force);
      await refreshCases();
      if (selected === id) setDetail(await api.getCase(id));
    } finally {
      setAnalysing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function analyseAllPending() {
    if (!cases) return;
    setBatchRunning(true);
    try {
      for (const c of cases.filter((c) => !c.analysed)) {
        await analyse(c.case_id, false);
      }
    } finally {
      setBatchRunning(false);
    }
  }

  async function onUploaded() {
    const list = await refreshCases();
    setShowUpload(false);
    if (!selected && list.length) setSelected(list[0].case_id);
  }

  if (cases === null) {
    return <div className="p-10 text-muted">Loading…</div>;
  }

  if (apiDown) {
    return (
      <div className="mx-auto mt-24 max-w-lg rounded-lg border border-line bg-panel p-6 text-sm">
        <p className="font-semibold" style={{ color: "var(--red)" }}>
          Backend not reachable
        </p>
        <p className="mt-2 text-muted">
          Start it with{" "}
          <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[12px]">
            .venv/bin/uvicorn backend.main:app --port 8000
          </code>{" "}
          then refresh.
        </p>
      </div>
    );
  }

  // blank state — no cases yet
  if (cases.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-8 pt-24">
        <h1 className="text-2xl font-semibold tracking-tight">⚖️ Disputes Copilot</h1>
        <p className="mt-2 text-sm text-muted">
          The queue is empty. Add chargeback cases to get started.
        </p>
        <div className="mt-8">
          <UploadPanel onDone={onUploaded} hasBundled />
        </div>
      </main>
    );
  }

  const pending = cases.filter((c) => !c.analysed).length;

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="w-72 shrink-0 border-r border-line bg-panel">
        <div className="sticky top-0 flex max-h-screen flex-col p-4">
          <h1 className="text-[15px] font-semibold tracking-tight">⚖️ Disputes Copilot</h1>
          <p className="mt-0.5 text-[11.5px] text-muted">{cases.length} cases in queue</p>

          <nav className="mt-4 -mx-2 flex-1 space-y-0.5 overflow-y-auto">
            {cases.map((c) => {
              const active = selected === c.case_id;
              const busy = analysing.has(c.case_id);
              return (
                <button
                  key={c.case_id}
                  onClick={() => setSelected(c.case_id)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] leading-snug hover:bg-panel-2 ${
                    active ? "bg-panel-2" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: busy
                          ? "var(--muted)"
                          : c.recommended_action
                            ? ACTION_META[c.recommended_action].color
                            : "transparent",
                        border: c.recommended_action || busy ? "none" : "1px solid var(--border)",
                      }}
                    />
                    <span className="truncate font-medium">{c.case_id}</span>
                    {c.decision && <span className="text-[10px] text-muted">✓</span>}
                  </span>
                  <span className="ml-4 block truncate text-muted">
                    {c.merchant_name} · {c.amount} {c.currency}
                    {busy ? " · analysing…" : ""}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {pending > 0 && (
              <button
                onClick={analyseAllPending}
                disabled={batchRunning}
                className="w-full rounded-md border border-line py-2 text-[12.5px] text-muted hover:text-foreground disabled:opacity-50"
              >
                {batchRunning ? "Analysing…" : `Analyse ${pending} pending`}
              </button>
            )}
            <button
              onClick={() => setShowUpload(true)}
              className="w-full rounded-md border border-line py-2 text-[12.5px] text-muted hover:text-foreground"
            >
              + Add cases
            </button>
          </div>
        </div>
      </aside>

      {/* upload modal */}
      {showUpload && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowUpload(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[640px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-background p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Add cases</h2>
              <button
                onClick={() => setShowUpload(false)}
                className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
              >
                Close ⎋
              </button>
            </div>
            <UploadPanel onDone={onUploaded} hasBundled />
          </div>
        </>
      )}

      {/* main */}
      <main className="min-w-0 flex-1">
        {detail ? (
          <CaseView
            detail={detail}
            analysing={analysing.has(detail.case.case_id)}
            onAnalyse={(force) => analyse(detail.case.case_id, force)}
            onSaved={refreshCases}
          />
        ) : (
          <div className="p-16 text-center text-sm text-muted">Select a case.</div>
        )}
      </main>
    </div>
  );
}
