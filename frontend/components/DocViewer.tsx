"use client";

import { useEffect } from "react";
import PdfPage from "./PdfPage";

export interface DocTarget {
  filename: string;
  location?: string | null;
  quotes?: string[];
}

function pageFrom(location?: string | null): number {
  const m = location?.match(/page\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

function DocContent({ target }: { target: DocTarget }) {
  const ext = target.filename.toLowerCase().split(".").pop() ?? "";
  const base = `/api/documents/${encodeURIComponent(target.filename)}`;
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);

  if (isImage) {
    return (
      <div className="h-full overflow-auto p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={base} alt={target.filename} className="mx-auto max-w-full" />
      </div>
    );
  }
  if (ext === "pdf") {
    return (
      <PdfPage url={base} initialPage={pageFrom(target.location)} quotes={target.quotes ?? []} />
    );
  }
  return <iframe src={base} title={target.filename} className="h-full w-full" />;
}

function Header({ target, onClose }: { target: DocTarget; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px]">{target.filename}</div>
        {target.location && (
          <div className="truncate text-[11px] text-muted">↳ {target.location}</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-foreground"
      >
        Close ⎋
      </button>
    </div>
  );
}

export default function DocViewer({
  target,
  onClose,
  variant = "overlay",
}: {
  target: DocTarget;
  onClose: () => void;
  variant?: "overlay" | "inline";
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  if (variant === "inline") {
    return (
      <div className="flex h-full flex-col">
        <Header target={target} onClose={onClose} />
        <div className="min-h-0 flex-1 bg-[#1a1d22]">
          <DocContent target={target} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-[54vw] min-w-[560px] flex-col border-l border-line bg-panel shadow-2xl">
        <Header target={target} onClose={onClose} />
        <div className="min-h-0 flex-1 bg-[#1a1d22]">
          <DocContent target={target} />
        </div>
      </div>
    </>
  );
}
