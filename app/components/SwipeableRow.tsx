"use client";

import { useRef, useState, type ReactNode } from "react";

const REVEAL_WIDTH = 88;
const THRESHOLD = 36;
const MAX_OVERDRAG = 112;

type Tracker = {
  active: boolean;
  sx: number;
  sy: number;
  startOffset: number;
  lock: "h" | "v" | null;
};

export function SwipeableRow({
  children,
  onDelete,
  disabled,
}: {
  children: ReactNode;
  onDelete: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const tracker = useRef<Tracker>({
    active: false,
    sx: 0,
    sy: 0,
    startOffset: 0,
    lock: null,
  });

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || deleting) return;
    tracker.current = {
      active: true,
      sx: e.clientX,
      sy: e.clientY,
      startOffset: offset,
      lock: null,
    };
    setAnimating(false);
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const t = tracker.current;
    if (!t.active) return;
    const dx = e.clientX - t.sx;
    const dy = e.clientY - t.sy;

    if (t.lock === null) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      t.lock = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (t.lock === "h") {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
      } else {
        t.active = false;
        return;
      }
    }

    if (t.lock === "h") {
      const next = Math.max(-MAX_OVERDRAG, Math.min(0, t.startOffset + dx));
      setOffset(next);
    }
  }

  function onUp() {
    const t = tracker.current;
    if (!t.active) return;
    t.active = false;
    setAnimating(true);
    if (offset < -THRESHOLD) {
      setOffset(-REVEAL_WIDTH);
    } else {
      setOffset(0);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete();
      // parent removes the row on success, no snap-back needed
    } catch {
      setDeleting(false);
      setAnimating(true);
      setOffset(0);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <button
        type="button"
        onClick={handleDelete}
        disabled={offset > -THRESHOLD || deleting}
        aria-label="Delete"
        className="absolute top-0 right-0 bottom-0 w-[88px] bg-rose-600 text-white text-sm font-semibold flex items-center justify-center active:bg-rose-700 disabled:opacity-70"
      >
        {deleting ? "…" : "Delete"}
      </button>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          transform: `translateX(${offset}px)`,
          transition: animating ? "transform 160ms ease" : "none",
          touchAction: "pan-y",
        }}
        className="relative bg-surface"
      >
        {children}
        {/* Affordance — small chevron indicating the row is swipeable.
            Fades out as the user swipes since the action is now self-evident. */}
        {!disabled && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted/40"
            style={{ opacity: Math.max(0, 1 - Math.abs(offset) / 30) }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
