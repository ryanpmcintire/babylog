"use client";

import Link from "next/link";
import { useState } from "react";
import { useRecentEvents } from "@/lib/useEvents";
import { Dashboard, isCurrentlySleeping } from "./Dashboard";
import { ActionGrid } from "./ActionGrid";
import { BackdateSheet } from "./BackdateSheet";
import { Timeline } from "./Timeline";
import { Trends } from "./Trends";
import { History } from "./History";
import { SignOutButton } from "./SignOutButton";

export function HomeClient() {
  const { events, loading, error } = useRecentEvents();
  const sleeping = isCurrentlySleeping(events);
  const [backdateOpen, setBackdateOpen] = useState(false);

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md flex flex-col gap-6">
        <Dashboard events={events} />

        {error && (
          <p className="text-center text-xs text-rose-600">{error}</p>
        )}

        <ActionGrid sleeping={sleeping} />

        <button
          type="button"
          onClick={() => setBackdateOpen(true)}
          className="self-center text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Log something for earlier…
        </button>

        <Timeline events={events} />

        <Trends events={events} />

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
          onClose={() => setBackdateOpen(false)}
        />
      )}
    </main>
  );
}
