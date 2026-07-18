"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";

export default function UploadPanel({
  onDone,
  hasBundled,
}: {
  onDone: () => void;
  hasBundled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    const ext = (f: File) => f.name.toLowerCase().split(".").pop() ?? "";
    const zipFiles = files.filter((f) => ext(f) === "zip");
    const jsonFiles = files.filter((f) => ext(f) === "json");
    const docFiles = files.filter((f) => !["zip", "json"].includes(ext(f)));

    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      let savedDocs = 0;
      let importedCases = 0;
      let skipped = 0;
      if (zipFiles.length) {
        const r = await api.uploadArchive(zipFiles);
        importedCases += r.imported.length;
        savedDocs += r.saved.length;
        skipped += r.skipped.length;
      }
      if (docFiles.length) {
        const r = await api.uploadDocuments(docFiles);
        savedDocs += r.saved.length;
      }
      for (const jf of jsonFiles) {
        const r = await api.uploadCases(jf);
        importedCases += r.imported.length;
      }
      const parts = [];
      if (importedCases) parts.push(`${importedCases} case${importedCases === 1 ? "" : "s"} imported`);
      if (savedDocs) parts.push(`${savedDocs} document${savedDocs === 1 ? "" : "s"} saved`);
      if (skipped) parts.push(`${skipped} zip member${skipped === 1 ? "" : "s"} skipped`);
      if (!parts.length) parts.push("nothing recognised in that drop");
      setSummary(parts.join(" · "));
      if (importedCases) onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function importBundled() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importBundled();
      setSummary(`${r.imported.length} cases imported from the bundled dataset`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? "border-muted bg-panel-2" : "border-line bg-panel"
        }`}
      >
        <p className="text-[15px] font-medium">
          {busy ? "Uploading…" : "Drop case files here, or click to browse"}
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted">
          Drop everything at once — the cases <span className="font-mono">.json</span>, the
          evidence documents it references (PDF / PNG / JPG / TXT), or a{" "}
          <span className="font-mono">.zip</span> containing either. Uploads start immediately.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".json,.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.zip"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {hasBundled ? (
          <button
            onClick={importBundled}
            disabled={busy}
            className="rounded-md border border-line px-3.5 py-1.5 text-[12.5px] text-muted hover:text-foreground disabled:opacity-40"
          >
            Or import the bundled dataset
          </button>
        ) : (
          <span />
        )}
        {summary && <p className="text-[12.5px]" style={{ color: "var(--green)" }}>{summary}</p>}
        {error && <p className="text-[12.5px]" style={{ color: "var(--red)" }}>{error}</p>}
      </div>
    </div>
  );
}
