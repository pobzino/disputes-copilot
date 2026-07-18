"use client";

import { useEffect, useRef, useState } from "react";

/* Renders one PDF page via pdf.js and paints highlight boxes over any text
   items that match the AI's verbatim quotes for the citation. */

type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return m;
    });
  }
  return pdfjsPromise;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function PdfPage({
  url,
  initialPage,
  quotes,
}: {
  url: string;
  initialPage: number;
  quotes: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(0);
  const [rects, setRects] = useState<Rect[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPage(initialPage), [initialPage, url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setNumPages(doc.numPages);
        const pageNum = Math.min(Math.max(1, page), doc.numPages);
        const pg = await doc.getPage(pageNum);
        if (cancelled) return;

        const containerWidth = containerRef.current?.clientWidth ?? 800;
        const base = pg.getViewport({ scale: 1 });
        const scale = Math.min(2, (containerWidth - 32) / base.width);
        const viewport = pg.getViewport({ scale });

        const canvas = canvasRef.current!;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * ratio;
        canvas.height = viewport.height * ratio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        await pg.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;

        // Match text items against the quote fragments
        const fragments = quotes.map(norm).filter((f) => f.length > 3);
        const found: Rect[] = [];
        if (fragments.length) {
          const text = await pg.getTextContent();
          for (const item of text.items) {
            if (!("str" in item) || !item.str.trim()) continue;
            const s = norm(item.str);
            if (s.length < 3) continue;
            const hit = fragments.some(
              (f) => f.includes(s) || s.includes(f) || overlap(f, s),
            );
            if (!hit) continue;
            const tx = pdfjs.Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.hypot(tx[2], tx[3]);
            found.push({
              left: tx[4],
              top: tx[5] - fontHeight,
              width: item.width * scale,
              height: fontHeight * 1.15,
            });
          }
        }
        setRects(found);
        setError(null);

        if (found.length && containerRef.current) {
          const first = found.reduce((a, b) => (a.top < b.top ? a : b));
          containerRef.current.scrollTo({ top: Math.max(0, first.top - 120), behavior: "smooth" });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, page, quotes.join("|")]);

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <p className="p-4 text-[12.5px]" style={{ color: "var(--red)" }}>
          Could not render PDF ({error}) — falling back to plain view.
        </p>
        <iframe src={url} title="document" className="min-h-0 w-full flex-1" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11.5px] text-muted">
        <span>
          {rects.length
            ? `${rects.length} cited region${rects.length === 1 ? "" : "s"} highlighted`
            : quotes.length
              ? "cited text not found on this page"
              : "no citation to highlight"}
        </span>
        <span className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-line px-1.5 disabled:opacity-30"
          >
            ‹
          </button>
          page {page} / {numPages || "…"}
          <button
            onClick={() => setPage((p) => Math.min(numPages || p, p + 1))}
            disabled={numPages > 0 && page >= numPages}
            className="rounded border border-line px-1.5 disabled:opacity-30"
          >
            ›
          </button>
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto p-4">
        <div className="relative mx-auto w-fit">
          <canvas ref={canvasRef} className="rounded shadow-lg" />
          {rects.map((r, i) => (
            <div
              key={i}
              className="pointer-events-none absolute rounded-[2px]"
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
                background: "rgba(245, 158, 11, 0.32)",
                outline: "1.5px solid rgba(245, 158, 11, 0.8)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* Fuzzy overlap: a run of 4+ consecutive words shared between fragment and item */
function overlap(frag: string, item: string): boolean {
  const words = item.split(" ").filter((w) => w.length > 1);
  if (words.length < 4) return false;
  for (let i = 0; i + 4 <= words.length; i++) {
    if (frag.includes(words.slice(i, i + 4).join(" "))) return true;
  }
  return false;
}
