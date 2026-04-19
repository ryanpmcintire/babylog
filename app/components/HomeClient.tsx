"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRecentEvents } from "@/lib/useEvents";
import { useBoolPref } from "@/lib/prefs";
import type { Side } from "@/lib/events";
import { Dashboard, isCurrentlySleeping } from "./Dashboard";
import { ActionGrid } from "./ActionGrid";
import { SleepControl } from "./SleepControl";
import { BackdateSheet } from "./BackdateSheet";
import { Timeline } from "./Timeline";
import { Trends } from "./Trends";
import { WeightChart } from "./WeightChart";
import { Library } from "./Library";
import { History } from "./History";

type Tab = "home" | "insights" | "library";
const TAB_STORAGE_KEY = "babylog.activeTab";

function suggestNextBreastSide(events: { type: string; side?: Side }[]): Side | undefined {
  for (const e of events) {
    if (e.type === "breast_feed" && e.side) {
      if (e.side === "left") return "right";
      if (e.side === "right") return "left";
      return "left";
    }
  }
  return undefined;
}

function readStoredTab(): Tab {
  if (typeof window === "undefined") return "home";
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    if (v === "insights" || v === "library") return v;
  } catch {
    /* ignore */
  }
  return "home";
}

export function HomeClient() {
  const { events, loading, error } = useRecentEvents();
  const sleeping = isCurrentlySleeping(events);
  const [backdateOpen, setBackdateOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [tonightMode, setTonightMode] = useBoolPref("tonightMode");
  const suggestedBreastSide = useMemo(
    () => suggestNextBreastSide(events),
    [events],
  );

  useEffect(() => {
    setTab(readStoredTab());
  }, []);

  if (tonightMode) {
    return (
      <main
        className="flex flex-1 flex-col items-center px-4 pt-8 sm:pt-12"
        style={{ paddingBottom: "calc(40px + env(safe-area-inset-bottom))" }}
      >
        <div className="w-full max-w-md flex justify-end -mt-4 mb-2">
          <button
            type="button"
            onClick={() => setTonightMode(false)}
            aria-label="Exit tonight mode"
            className="p-2 -mr-2 text-muted hover:text-foreground transition-colors"
          >
            <SunExitIcon />
          </button>
        </div>
        <div className="w-full max-w-md flex flex-col gap-6">
          {error && (
            <p className="text-center text-xs text-rose-600">{error}</p>
          )}
          <Dashboard events={events} />
          <Divider />
          <ActionGrid
            sleeping={sleeping}
            suggestedBreastSide={suggestedBreastSide}
            events={events}
          />
          <SleepControl events={events} />
          <p className="text-center text-[10px] text-muted mt-2">
            Tonight mode — tap the icon above to exit
          </p>
        </div>
      </main>
    );
  }

  function changeTab(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <main
        className="flex flex-1 flex-col items-center px-4 pt-8 sm:pt-12"
        style={{ paddingBottom: "calc(88px + env(safe-area-inset-bottom))" }}
      >
        <div className="w-full max-w-md flex justify-end gap-1 -mt-4 mb-2">
          <button
            type="button"
            onClick={() => setTonightMode(true)}
            aria-label="Tonight mode"
            className="p-2 text-muted hover:text-foreground transition-colors"
          >
            <MoonIcon />
          </button>
          <Link
            href="/settings"
            aria-label="Settings"
            className="p-2 -mr-2 text-muted hover:text-foreground transition-colors"
          >
            <GearIcon />
          </Link>
        </div>
        <div className="w-full max-w-md flex flex-col gap-6">
          {error && (
            <p className="text-center text-xs text-rose-600">{error}</p>
          )}

          {tab === "home" && (
            <>
              <Dashboard events={events} />
              <Divider />
              <ActionGrid
                sleeping={sleeping}
                suggestedBreastSide={suggestedBreastSide}
                events={events}
              />
              <SleepControl events={events} />
              <button
                type="button"
                onClick={() => setBackdateOpen(true)}
                className="self-center text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
              >
                Log something for earlier…
              </button>
              <Divider />
              <History events={events} />
            </>
          )}

          {tab === "insights" && (
            <>
              <Timeline events={events} />
              <WeightChart events={events} />
              <Trends events={events} />
            </>
          )}

          {tab === "library" && <Library events={events} />}

          <div className="flex flex-col items-center gap-2 pt-4">
            {loading && <p className="text-[10px] text-muted">Syncing…</p>}
          </div>
        </div>

        {backdateOpen && (
          <BackdateSheet
            sleeping={sleeping}
            suggestedBreastSide={suggestedBreastSide}
            onClose={() => setBackdateOpen(false)}
          />
        )}
      </main>

      <BottomNav tab={tab} onChange={changeTab} />
    </>
  );
}

function Divider() {
  return (
    <div
      aria-hidden="true"
      className="w-full h-px my-1"
      style={{ background: "var(--divider)" }}
    />
  );
}

function BottomNav({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-accent-soft bg-surface"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-md grid grid-cols-3">
        <TabButton
          active={tab === "home"}
          onClick={() => onChange("home")}
          label="Home"
          icon={<HomeIcon />}
        />
        <TabButton
          active={tab === "insights"}
          onClick={() => onChange("insights")}
          label="Insights"
          icon={<ChartIcon />}
        />
        <TabButton
          active={tab === "library"}
          onClick={() => onChange("library")}
          label="Library"
          icon={<BookIcon />}
        />
      </div>
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
      className={
        "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold transition-colors " +
        (active ? "text-accent" : "text-muted hover:text-foreground")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function HomeIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9.5" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20V6" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="6" rx="0.5" />
      <rect x="12" y="8" width="3" height="10" rx="0.5" />
      <rect x="17" y="14" width="3" height="4" rx="0.5" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunExitIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
