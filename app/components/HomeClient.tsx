"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRecentEvents } from "@/lib/useEvents";
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
import { SignOutButton } from "./SignOutButton";

function suggestNextBreastSide(events: { type: string; side?: Side }[]): Side | undefined {
  for (const e of events) {
    if (e.type === "breast_feed" && e.side) {
      if (e.side === "left") return "right";
      if (e.side === "right") return "left";
      return "left"; // last was 'both' — default to left
    }
  }
  return undefined;
}

export function HomeClient() {
  const { events, loading, error } = useRecentEvents();
  const sleeping = isCurrentlySleeping(events);
  const [backdateOpen, setBackdateOpen] = useState(false);
  const suggestedBreastSide = useMemo(
    () => suggestNextBreastSide(events),
    [events],
  );

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md flex flex-col gap-6">
        <Dashboard events={events} />

        {error && (
          <p className="text-center text-xs text-rose-600">{error}</p>
        )}

        <Divider />

        <ActionGrid
          sleeping={sleeping}
          suggestedBreastSide={suggestedBreastSide}
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

        <Timeline events={events} />

        <WeightChart events={events} />

        <Trends events={events} />

        <Library events={events} />

        <History events={events} />

        <div className="flex flex-col items-center gap-2 pt-4">
          {loading && (
            <p className="text-[10px] text-muted">Syncing…</p>
          )}
          <Link
            href="/settings"
            className="text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            Settings
          </Link>
          <SignOutButton />
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
