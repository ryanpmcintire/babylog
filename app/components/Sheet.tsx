"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Shared bottom-sheet component. One canonical implementation across the app.
// Dismiss methods (each redundant with the others, on purpose):
//   - Tap the backdrop
//   - Tap the ✕ button (44px hit target)
//   - Swipe down on the drag pill or the sheet itself
//   - Press Escape (desktop)
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only start drag from the drag-pill area or top header. Avoid hijacking
    // scroll inside the body content.
    const target = e.target as HTMLElement;
    if (!target.closest("[data-sheet-drag]")) return;
    dragStartY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartY.current == null) return;
    const dy = e.clientY - dragStartY.current;
    if (dy > 0) setDragOffset(dy);
  }

  function onPointerUp() {
    if (dragStartY.current == null) return;
    if (dragOffset > 100) {
      onClose();
    } else {
      setDragOffset(0);
    }
    dragStartY.current = null;
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition:
            dragStartY.current === null ? "transform 0.2s ease-out" : "none",
        }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-surface p-5 pt-2 shadow-lg flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Drag pill — also catches the swipe gesture */}
        <div
          data-sheet-drag
          className="self-center w-12 h-1.5 rounded-full bg-muted/40 mb-1 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        />
        <div
          data-sheet-drag
          className="flex items-center justify-between"
          style={{ touchAction: "none" }}
        >
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted hover:text-foreground hover:bg-background/60 transition-colors"
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
