"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRecentEvents } from "@/lib/useEvents";
import { useBoolPref } from "@/lib/prefs";
import type { Side } from "@/lib/events";
import { Dashboard, isCurrentlySleeping } from "./Dashboard";
import { TodayClock } from "./TodayClock";
import { ActionGrid } from "./ActionGrid";
import { SleepControl } from "./SleepControl";
import { BackdateSheet } from "./BackdateSheet";
import { Timeline } from "./Timeline";
import { Trends } from "./Trends";
import { WeightChart } from "./WeightChart";
import { Library } from "./Library";
import { History } from "./History";
import { ThemeToggle } from "./ThemeToggle";

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
  const { events, loading, error, source } = useRecentEvents();
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

  function changeTab(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }

  if (tonightMode) {
    return (
      <main className="flex flex-1 flex-col items-center px-4 pb-8">
        <div
          className="w-full max-w-md flex justify-end gap-1 py-2"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
        >
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setTonightMode(false)}
            aria-label="Exit tonight mode"
            className="p-2 text-muted hover:text-foreground transition-colors"
          >
            <SunExitIcon />
          </button>
        </div>
        <div className="w-full max-w-md flex flex-col gap-6 pt-4">
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
            Tonight mode — tap the sun icon above to exit
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center px-4 pb-12">
      <div
        className="w-full max-w-md sticky top-0 z-20 bg-background"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center justify-between gap-1 sm:gap-2 py-1 min-w-0">
          <TopTabs tab={tab} onChange={changeTab} />
          <div className="flex items-center shrink-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setTonightMode(true)}
              aria-label="Tonight mode"
              title="Tonight mode"
              className="p-1.5 sm:p-2 text-muted hover:text-foreground transition-colors"
            >
              <BedIcon />
            </button>
            <Link
              href="/settings"
              aria-label="Settings"
              className="p-1.5 sm:p-2 text-muted hover:text-foreground transition-colors"
            >
              <GearIcon />
            </Link>
          </div>
        </div>
        <div className="h-px bg-accent-soft" />
      </div>

      <div className="w-full max-w-md flex flex-col gap-6 pt-4">
        {error && (
          <p className="text-center text-xs text-rose-600">{error}</p>
        )}

        {source === "legacy" && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-xs text-amber-900 dark:text-amber-200">
            ⚠️ Reading legacy data — household migration hasn&apos;t completed.
            New events you log may not appear here.
          </div>
        )}

        {tab === "home" && (
          <>
            <Dashboard events={events} />
            <TodayClock events={events} />
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
            <WeightChart />
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

function TopTabs({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav aria-label="Primary" className="flex items-center gap-0.5 sm:gap-1 min-w-0">
      <TabButton active={tab === "home"} onClick={() => onChange("home")}>
        Home
      </TabButton>
      <TabButton
        active={tab === "insights"}
        onClick={() => onChange("insights")}
      >
        Insights
      </TabButton>
      <TabButton
        active={tab === "library"}
        onClick={() => onChange("library")}
      >
        Library
      </TabButton>
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
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
        "px-2.5 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-bold rounded-full transition-all duration-150 active:scale-[0.97] whitespace-nowrap " +
        (active
          ? "bg-accent text-white shadow-sm"
          : "text-muted hover:text-foreground hover:bg-accent-soft/40")
      }
    >
      {children}
    </button>
  );
}

function BedIcon() {
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
      <path d="M3 18V7" />
      <path d="M3 12h16a2 2 0 0 1 2 2v4" />
      <path d="M3 18h18" />
      <circle cx="8" cy="10" r="1.5" />
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
