import { CaseDetail, CaseResult, CaseSummary } from "./types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export const api = {
  listCases: () => fetch("/api/cases").then((r) => j<CaseSummary[]>(r)),

  getCase: (id: string) => fetch(`/api/cases/${id}`).then((r) => j<CaseDetail>(r)),

  analyse: (id: string, force = false) =>
    fetch(`/api/cases/${id}/analyse?force=${force}`, { method: "POST" }).then((r) =>
      j<CaseResult>(r),
    ),

  uploadCases: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch("/api/upload/cases", { method: "POST", body: fd }).then((r) =>
      j<{ imported: string[] }>(r),
    );
  },

  uploadDocuments: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return fetch("/api/upload/documents", { method: "POST", body: fd }).then((r) =>
      j<{ saved: string[] }>(r),
    );
  },

  removeCaseDocument: (id: string, filename: string) =>
    fetch(`/api/cases/${id}/documents/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    }).then((r) => j<{ documents: string[] }>(r)),

  uploadCaseDocuments: (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return fetch(`/api/cases/${id}/documents`, { method: "POST", body: fd }).then((r) =>
      j<{ saved: string[]; documents: string[] }>(r),
    );
  },

  importBundled: () =>
    fetch("/api/import-bundled", { method: "POST" }).then((r) => j<{ imported: string[] }>(r)),

  reviewRow: (
    id: string,
    index: number,
    verdict: "verified" | "wrong" | null,
    comment: string,
    correctedStatus?: string | null,
  ) =>
    fetch(`/api/cases/${id}/row-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index, verdict, comment, corrected_status: correctedStatus ?? null }),
    }).then((r) => j<{ ok: boolean }>(r)),

  saveDecision: (id: string, analyst_action: string, analyst_rationale: string, note?: string) =>
    fetch(`/api/cases/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analyst_action, analyst_rationale, note }),
    }).then((r) => j<{ ok: boolean }>(r)),
};
