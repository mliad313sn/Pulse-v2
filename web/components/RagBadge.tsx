// RAG health badge — a11y (plan §167): NEVER color alone. Every rendering pairs
// the color with a distinct SHAPE (Green=circle, Amber=triangle, Red=square)
// and a TEXT label, so the traffic light survives monochrome and color-blindness.

import type { ProjectRag, RagColor } from "@/lib/types";
import { cn, RAG_META, type RagShape } from "@/lib/utils";
import { Pill } from "./Badges";

/** Filled shape glyph (circle/triangle/square) — colored via currentColor. */
export function RagShapeGlyph({ shape, className }: { shape: RagShape; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn("shrink-0", className)} fill="currentColor">
      {shape === "circle" && <circle cx="6" cy="6" r="5" />}
      {shape === "triangle" && <path d="M6 1l5.5 10h-11z" />}
      {shape === "square" && <rect x="1" y="1" width="10" height="10" rx="1.5" />}
    </svg>
  );
}

/** Shape+color glyph for a bare RagColor (history strip, signal rows). */
export function RagGlyph({ color, className }: { color: RagColor; className?: string }) {
  const meta = RAG_META[color];
  return <RagShapeGlyph shape={meta.shape} className={cn(meta.shapeClass, className)} />;
}

export default function RagBadge({
  rag,
  size = "md",
  className,
  title,
}: {
  rag?: ProjectRag | null;
  size?: "sm" | "md";
  className?: string;
  /** Defaults to the server explanation. */
  title?: string;
}) {
  if (!rag || !RAG_META[rag.color]) return null;
  const meta = RAG_META[rag.color];
  const sm = size === "sm";
  return (
    <Pill
      title={title ?? rag.explanation ?? `RAG health: ${meta.label}`}
      className={cn(
        "gap-1.5",
        meta.badge,
        sm && "px-2 py-0 text-[11px]",
        className,
      )}
    >
      <RagShapeGlyph shape={meta.shape} className={cn(sm ? "h-2 w-2" : "h-2.5 w-2.5", meta.shapeClass)} />
      {meta.label}
      {rag.manual && (
        <span
          title={`Manually overridden: ${rag.manual.reason}`}
          className={cn(
            "rounded-full border border-current px-1 font-semibold uppercase tracking-wide opacity-80",
            sm ? "text-[8px]" : "text-[9px]",
          )}
        >
          Manual
        </span>
      )}
    </Pill>
  );
}

/** Compact "2 Red" style count pill for dashboard matrix rows. */
export function RagCountPill({ color, count }: { color: RagColor; count: number }) {
  if (count <= 0) return null;
  const meta = RAG_META[color];
  return (
    <Pill title={`${count} project${count === 1 ? "" : "s"} rated ${meta.label}`} className={cn("gap-1", meta.badge)}>
      <RagShapeGlyph shape={meta.shape} className={cn("h-2 w-2", meta.shapeClass)} />
      {count} {meta.label.toLowerCase()}
    </Pill>
  );
}
