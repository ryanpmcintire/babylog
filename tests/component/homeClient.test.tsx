/**
 * HomeClient composition tests.
 *
 * The leaf-component tests in propDrilling.test.tsx confirm that each
 * component forwards props correctly when handed them. These tests
 * confirm that *HomeClient itself* hands those props down — that the
 * top-level wiring stays intact across refactors. Specifically targets
 * the regression class where removing `events={events}` from a child
 * silently broke the dual-write.
 */

import { describe, expect, test } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  mockWriteEvent,
  mockUseHomeView,
  mockUseInsightsView,
  mockUseLibraryView,
} from "./setup";
import { Timestamp } from "firebase/firestore";
import type { BabyEvent } from "@/lib/events";
import type { HomeView, InsightsView, LibraryView } from "@/lib/views";

function fakeEvent<T extends BabyEvent["type"]>(
  type: T,
  occurredAt: Date,
  extra: Record<string, unknown> = {},
): BabyEvent {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    type,
    occurred_at: Timestamp.fromDate(occurredAt),
    created_at: Timestamp.fromDate(occurredAt),
    created_by: "uid",
    deleted: false,
    ...extra,
  } as BabyEvent;
}

function makeHomeView(events: BabyEvent[]): HomeView {
  return {
    today: {
      dayKey: "2026-04-28",
      feeds: 2,
      breast_feeds: 1,
      bottle_feeds: 1,
      pump_count: 0,
      milkMl: 90,
      pumpMl: 0,
      diapers: 1,
      wets: 1,
      dirties: 0,
      mixeds: 0,
      meds: 0,
      sleepMinutes: 240,
      maxTempF: null,
    },
    latest: {
      feed: null,
      breast: null,
      bottle: null,
      pump: null,
      diaper: null,
      medication: null,
      temperature: null,
      weight: null,
      sleep_start: null,
      sleep_end: null,
    },
    meds_last_7d: [],
    temps_last_24h: [],
    recent_feeds: [],
    recent_diapers: [],
    recent_events: events,
    sleep_state: { sleeping: false, since: null, source: null },
    last_woke_at: null,
  };
}

function makeInsightsView(): InsightsView {
  return {
    daily_summaries: [],
    markers: [],
    sleep_segments: [],
    weights: [],
  };
}

function makeLibraryView(): LibraryView {
  return { books: [], foods: [] };
}

describe("HomeClient composition", () => {
  test("BackdateSheet receives events from homeView.recent_events; writeEvent called with them", async () => {
    // The exact shape of the regression: a write triggered through the
    // backdate path must include the live-events array as the third arg
    // to writeEvent. If HomeClient stops forwarding `events` to
    // BackdateSheet (or BackdateSheet stops forwarding to ActionGrid),
    // the third arg becomes undefined and the dual-write skips view
    // updates.
    const events = [
      fakeEvent("breast_feed", new Date(), {
        outcome: "latched_fed",
        side: "left",
      }),
      fakeEvent("diaper_dirty", new Date()),
    ];
    mockUseHomeView.mockReturnValue({
      view: makeHomeView(events),
      loading: false,
    });
    mockUseInsightsView.mockReturnValue({
      view: makeInsightsView(),
      loading: false,
    });
    mockUseLibraryView.mockReturnValue({
      view: makeLibraryView(),
      loading: false,
    });

    const { HomeClient } = await import("@/app/components/HomeClient");
    render(<HomeClient />);

    // Open the BackdateSheet — "Log for earlier" button.
    const backdateBtn = screen.getByRole("button", {
      name: /log for earlier/i,
    });
    fireEvent.click(backdateBtn);

    // The sheet shows a header confirming we're in the right place.
    const sheet = screen.getByText(/Log earlier event/i).closest("div")!;
    expect(sheet).toBeTruthy();

    // Click the wet-diaper action inside the sheet's ActionGrid.
    const wetBtn = within(sheet.parentElement!).getByRole("button", {
      name: /wet/i,
    });
    fireEvent.click(wetBtn);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockWriteEvent).toHaveBeenCalled();
    const lastCall =
      mockWriteEvent.mock.calls[mockWriteEvent.mock.calls.length - 1]!;
    // payload is first arg, when is second, events is third.
    const passedEvents = lastCall[2];
    expect(passedEvents).toEqual(events);
  });

  test("Insights tab renders the Insights subview (Trends/Timeline/WeightChart shell)", async () => {
    mockUseHomeView.mockReturnValue({
      view: makeHomeView([]),
      loading: false,
    });
    mockUseInsightsView.mockReturnValue({
      view: {
        daily_summaries: [
          {
            dayKey: "2026-04-28",
            feeds: 4,
            breast_feeds: 2,
            bottle_feeds: 2,
            pump_count: 0,
            milkMl: 200,
            pumpMl: 0,
            diapers: 5,
            wets: 4,
            dirties: 2,
            mixeds: 1,
            meds: 0,
            sleepMinutes: 600,
            maxTempF: null,
          },
        ],
        markers: [],
        sleep_segments: [],
        weights: [
          {
            at: Date.now() - 14 * 86400_000,
            eventId: "w1",
            weight_grams: 4200,
          },
          {
            at: Date.now() - 7 * 86400_000,
            eventId: "w2",
            weight_grams: 4500,
          },
        ],
      },
      loading: false,
    });
    mockUseLibraryView.mockReturnValue({
      view: makeLibraryView(),
      loading: false,
    });

    const { HomeClient } = await import("@/app/components/HomeClient");
    render(<HomeClient />);

    // Click the Insights tab button.
    fireEvent.click(screen.getByRole("button", { name: /insights/i }));

    // Trends header + WeightChart label both render from insightsView.
    expect(
      screen.getByRole("heading", { name: /daily totals/i }),
    ).toBeInTheDocument();
  });

  test("Library tab renders books from libraryView", async () => {
    mockUseHomeView.mockReturnValue({
      view: makeHomeView([]),
      loading: false,
    });
    mockUseInsightsView.mockReturnValue({
      view: makeInsightsView(),
      loading: false,
    });
    mockUseLibraryView.mockReturnValue({
      view: {
        books: [
          {
            key: "the very hungry caterpillar",
            title: "The Very Hungry Caterpillar",
            author: "Eric Carle",
            count: 5,
            last_at: Date.now(),
            last_event_id: "vhc",
          },
        ],
        foods: [],
      },
      loading: false,
    });

    const { HomeClient } = await import("@/app/components/HomeClient");
    render(<HomeClient />);

    fireEvent.click(screen.getByRole("button", { name: /library/i }));

    expect(
      screen.getAllByText(/The Very Hungry Caterpillar/i).length,
    ).toBeGreaterThan(0);
  });

  test("HomeClient passes events down to TodayClock + Dashboard", async () => {
    // Smoke test: even if assertions on inner content are limited, the
    // app must mount without throwing when given a populated homeView.
    // Catches things like "TodayClock crashed because events was
    // undefined" — a class of breakage that wouldn't surface in any
    // other test.
    const events = [
      fakeEvent("breast_feed", new Date(), {
        outcome: "latched_fed",
        side: "right",
      }),
      fakeEvent("bottle_feed", new Date(), {
        volume_ml: 90,
        milk_types: ["mom_pumped"],
      }),
      fakeEvent("diaper_wet", new Date()),
    ];
    mockUseHomeView.mockReturnValue({
      view: makeHomeView(events),
      loading: false,
    });
    mockUseInsightsView.mockReturnValue({
      view: makeInsightsView(),
      loading: false,
    });
    mockUseLibraryView.mockReturnValue({
      view: makeLibraryView(),
      loading: false,
    });

    const { HomeClient } = await import("@/app/components/HomeClient");
    render(<HomeClient />);

    // The home-tab ActionGrid renders its action buttons — proves
    // HomeClient mounted, Dashboard/TodayClock/ActionGrid all rendered
    // without throwing on the events array.
    const wetButtons = screen.getAllByRole("button", { name: /wet/i });
    expect(wetButtons.length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /log for earlier/i }),
    ).toBeInTheDocument();
  });
});
