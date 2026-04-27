// Materialized view docs. Each screen reads exactly one Firestore doc.
// Updated atomically alongside event writes/edits/deletes by lib/useEvents.ts
// so the view stays consistent with the events collection. If a view ever
// drifts, scripts/backfill-views.ts rebuilds it from scratch.
//
// This module is PURE — no Firestore imports, no I/O. The dual-write logic
// and the backfill consume these helpers.

import type {
  BabyEvent,
  BreastFeedOutcome,
  FoodReaction,
  MilkType,
  Side,
  TempMethod,
} from "./events";
import {
  buildDailyBuckets,
  buildMarkers,
  currentSleepState,
  explicitSleepWindows,
  inferredSleepWindows,
  type Marker,
} from "./aggregates";
import {
  dayKeyOf,
  summaryFromDayEvents,
  splitSleepMinutes,
  type DailySummary,
} from "./summaries";

// ---- Bounds ------------------------------------------------------------
// Each array in the view doc is bounded so the doc stays well under
// Firestore's 1 MB limit and so writes don't grow without bound.

export const RECENT_EVENTS_LIMIT = 50;
export const MEDS_WINDOW_MS = 7 * 86400_000;
export const TEMPS_WINDOW_MS = 24 * 3600_000;
export const PREDICTION_LOOKBACK = 8;
export const MEDS_HARD_CAP = 50;
export const TEMPS_HARD_CAP = 50;
export const INSIGHTS_DAYS = 30;
export const TIMELINE_MARKER_LIMIT = 1500;
export const WEIGHTS_LIMIT = 500;

// ---- View doc shapes ---------------------------------------------------

// Tiny per-type "latest" entry. Holds just enough to render a Dashboard row
// without re-reading the underlying event.
export type LatestFeed = {
  at: number; // millis
  eventId: string;
  kind: "breast" | "bottle";
  // breast-only:
  side?: Side;
  outcome?: BreastFeedOutcome;
  // bottle-only:
  volume_ml?: number;
  milk_types?: MilkType[];
} | null;

export type LatestBreast = {
  at: number;
  eventId: string;
  side?: Side;
  outcome: BreastFeedOutcome;
} | null;

export type LatestBottle = {
  at: number;
  eventId: string;
  volume_ml: number;
  milk_types: MilkType[];
} | null;

export type LatestPump = {
  at: number;
  eventId: string;
  volume_ml: number;
  side?: Side;
} | null;

export type LatestDiaper = {
  at: number;
  eventId: string;
  kind: "wet" | "dirty" | "mixed";
} | null;

export type LatestMedication = {
  at: number;
  eventId: string;
  name: string;
  dose?: string;
} | null;

export type LatestTemperature = {
  at: number;
  eventId: string;
  temp_f: number;
  method?: TempMethod;
} | null;

export type LatestWeight = {
  at: number;
  eventId: string;
  weight_grams: number;
} | null;

export type LatestSleepEvent = {
  at: number;
  eventId: string;
} | null;

export type SleepStateSnapshot = {
  sleeping: boolean;
  since: number | null; // millis
  source: "explicit" | "inferred" | null;
};

export type MedEntry = {
  at: number;
  eventId: string;
  name: string;
  dose?: string;
};

export type TempEntry = {
  at: number;
  eventId: string;
  temp_f: number;
  method?: TempMethod;
};

export type FeedEntry = {
  at: number;
  eventId: string;
  type: "breast_feed" | "bottle_feed";
  // bottle_feed:
  volume_ml?: number;
  milk_types?: MilkType[];
  // breast_feed:
  side?: Side;
  outcome?: BreastFeedOutcome;
};

export type DiaperEntry = {
  at: number;
  eventId: string;
  type: "diaper_wet" | "diaper_dirty" | "diaper_mixed";
};

export type HomeView = {
  // A copy of today's daily_summary, keyed for direct render.
  today: DailySummary;
  // Per-type latest pointers for Dashboard rows.
  latest: {
    feed: LatestFeed;
    breast: LatestBreast;
    bottle: LatestBottle;
    pump: LatestPump;
    diaper: LatestDiaper;
    medication: LatestMedication;
    temperature: LatestTemperature;
    weight: LatestWeight;
    sleep_start: LatestSleepEvent;
    sleep_end: LatestSleepEvent;
  };
  meds_last_7d: MedEntry[]; // newest-first, capped at MEDS_HARD_CAP
  temps_last_24h: TempEntry[]; // newest-first, capped at TEMPS_HARD_CAP
  recent_feeds: FeedEntry[]; // newest-first, length ≤ PREDICTION_LOOKBACK
  recent_diapers: DiaperEntry[]; // newest-first, length ≤ PREDICTION_LOOKBACK
  // Recent events for the History list. Embeds full BabyEvent so History
  // renders without secondary reads.
  recent_events: BabyEvent[]; // newest-first, length ≤ RECENT_EVENTS_LIMIT
  sleep_state: SleepStateSnapshot;
  last_woke_at: number | null;
};

export type InsightsView = {
  // Last INSIGHTS_DAYS daily summaries, oldest-first.
  daily_summaries: DailySummary[];
  // Marker data for Timeline within the same window. Bounded.
  markers: Marker[];
  // All weight readings, oldest-first.
  weights: { at: number; eventId: string; weight_grams: number; notes?: string }[];
};

export type LibraryBookEntry = {
  key: string;
  title: string;
  author?: string;
  cover_url?: string;
  open_library_key?: string;
  count: number;
  last_at: number;
  last_event_id: string;
};

export type LibraryFoodEntry = {
  key: string;
  food_name: string;
  count: number;
  last_at: number;
  last_event_id: string;
  first_try_at?: number;
  reactions: Partial<Record<FoodReaction, number>>;
};

export type LibraryView = {
  books: LibraryBookEntry[]; // sorted by last_at desc
  foods: LibraryFoodEntry[]; // sorted by last_at desc
};

// ---- Compute-from-scratch (used by backfill and as a recompute path) ----

// Build the home view from the full event set (newest-first).
export function computeHomeView(
  events: BabyEvent[],
  now: Date = new Date(),
): HomeView {
  const live = events.filter((e) => !e.deleted);
  // Newest-first sort defensively.
  const sorted = [...live].sort(
    (a, b) => b.occurred_at.toMillis() - a.occurred_at.toMillis(),
  );

  const todayKey = dayKeyOf(now);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEvents = sorted.filter(
    (e) => dayKeyOf(e.occurred_at.toDate()) === todayKey,
  );
  // Sleep minutes for today: count any explicit/inferred window's overlap
  // with today.
  const today: DailySummary = summaryFromDayEvents(
    todayKey,
    todayEvents,
    sleepMinutesForDay(sorted, todayStart, now),
  );

  const latest = computeLatest(sorted);
  const sleep = currentSleepState(sorted, 10, now);
  const sleep_state: SleepStateSnapshot = {
    sleeping: sleep.sleeping,
    since: sleep.since ? sleep.since.getTime() : null,
    source: sleep.source,
  };
  const last_woke_at = computeLastWokeAt(sorted, now);

  const sevenDaysAgo = now.getTime() - MEDS_WINDOW_MS;
  const meds_last_7d: MedEntry[] = [];
  const temps_last_24h: TempEntry[] = [];
  const dayAgo = now.getTime() - TEMPS_WINDOW_MS;
  const recent_feeds: FeedEntry[] = [];
  const recent_diapers: DiaperEntry[] = [];
  const recent_events: BabyEvent[] = [];

  for (const e of sorted) {
    const at = e.occurred_at.toMillis();
    if (e.type === "medication" && at >= sevenDaysAgo) {
      if (meds_last_7d.length < MEDS_HARD_CAP) {
        meds_last_7d.push({
          at,
          eventId: e.id,
          name: e.name,
          dose: e.dose,
        });
      }
    }
    if (e.type === "temperature" && at >= dayAgo) {
      if (temps_last_24h.length < TEMPS_HARD_CAP) {
        temps_last_24h.push({
          at,
          eventId: e.id,
          temp_f: e.temp_f,
          method: e.method,
        });
      }
    }
    if (
      (e.type === "breast_feed" || e.type === "bottle_feed") &&
      recent_feeds.length < PREDICTION_LOOKBACK
    ) {
      recent_feeds.push(toFeedEntry(e));
    }
    if (
      (e.type === "diaper_wet" ||
        e.type === "diaper_dirty" ||
        e.type === "diaper_mixed") &&
      recent_diapers.length < PREDICTION_LOOKBACK
    ) {
      recent_diapers.push({ at, eventId: e.id, type: e.type });
    }
    if (recent_events.length < RECENT_EVENTS_LIMIT) {
      recent_events.push(e);
    }
  }

  return {
    today,
    latest,
    meds_last_7d,
    temps_last_24h,
    recent_feeds,
    recent_diapers,
    recent_events,
    sleep_state,
    last_woke_at,
  };
}

export function computeInsightsView(
  events: BabyEvent[],
  now: Date = new Date(),
): InsightsView {
  const live = events.filter((e) => !e.deleted);

  // Daily summaries for last INSIGHTS_DAYS. Reuse the chart-side bucketing
  // so historical inferred sleep is preserved.
  const buckets = buildDailyBuckets(live, INSIGHTS_DAYS, now, {
    inferBufferMin: 10,
  });
  const daily_summaries: DailySummary[] = buckets.map((b) => ({
    dayKey: dayKeyOf(b.date),
    feeds: b.feeds,
    breast_feeds: 0,
    bottle_feeds: 0,
    pump_count: 0,
    milkMl: b.milkMl,
    pumpMl: b.pumpMl,
    diapers: b.diapers,
    wets: b.wets,
    dirties: b.dirties,
    mixeds: b.mixeds,
    meds: b.meds,
    sleepMinutes: b.sleepMinutes,
    maxTempF: b.maxTempF,
  }));
  // Re-derive breast/bottle/pump_count from raw events since DayBucket
  // doesn't break feeds out by sub-type.
  const startOfWindow = new Date(now);
  startOfWindow.setDate(startOfWindow.getDate() - (INSIGHTS_DAYS - 1));
  startOfWindow.setHours(0, 0, 0, 0);
  for (const e of live) {
    const at = e.occurred_at.toDate();
    if (at < startOfWindow || at > now) continue;
    const dk = dayKeyOf(at);
    const s = daily_summaries.find((d) => d.dayKey === dk);
    if (!s) continue;
    if (e.type === "breast_feed") s.breast_feeds += 1;
    else if (e.type === "bottle_feed") s.bottle_feeds += 1;
    else if (e.type === "pump") s.pump_count += 1;
  }

  const allMarkers = buildMarkers(live);
  const windowStartMs = startOfWindow.getTime();
  const markers = allMarkers
    .filter((m) => {
      // Markers are keyed by dayKey/atMin only — recover the actual at
      // by looking up the event id in `live`.
      const ev = live.find((e) => e.id === m.eventId);
      return !!ev && ev.occurred_at.toMillis() >= windowStartMs;
    })
    .slice(0, TIMELINE_MARKER_LIMIT);

  const weights = live
    .filter((e) => e.type === "weight")
    .sort((a, b) => a.occurred_at.toMillis() - b.occurred_at.toMillis())
    .slice(0, WEIGHTS_LIMIT)
    .map((e) => {
      const w = e as Extract<BabyEvent, { type: "weight" }>;
      return {
        at: w.occurred_at.toMillis(),
        eventId: w.id,
        weight_grams: w.weight_grams,
        notes: w.notes,
      };
    });

  return { daily_summaries, markers, weights };
}

export function computeLibraryView(events: BabyEvent[]): LibraryView {
  const live = events.filter((e) => !e.deleted);
  const bookByKey = new Map<string, LibraryBookEntry>();
  const foodByKey = new Map<string, LibraryFoodEntry>();

  for (const e of live) {
    if (e.type === "book_read") {
      const key = (e.open_library_key ?? e.title).toLowerCase();
      const at = e.occurred_at.toMillis();
      const existing = bookByKey.get(key);
      if (!existing) {
        bookByKey.set(key, {
          key,
          title: e.title,
          author: e.author,
          cover_url: e.cover_url,
          open_library_key: e.open_library_key,
          count: 1,
          last_at: at,
          last_event_id: e.id,
        });
      } else {
        existing.count += 1;
        if (at > existing.last_at) {
          existing.last_at = at;
          existing.last_event_id = e.id;
          // Refresh display fields from the more-recent event.
          existing.title = e.title;
          existing.author = e.author ?? existing.author;
          existing.cover_url = e.cover_url ?? existing.cover_url;
        }
      }
    } else if (e.type === "food_tried") {
      const key = e.food_name.trim().toLowerCase();
      const at = e.occurred_at.toMillis();
      const existing = foodByKey.get(key);
      if (!existing) {
        const reactions: Partial<Record<FoodReaction, number>> = {};
        if (e.reaction) reactions[e.reaction] = 1;
        foodByKey.set(key, {
          key,
          food_name: e.food_name,
          count: 1,
          last_at: at,
          last_event_id: e.id,
          first_try_at: e.first_try ? at : undefined,
          reactions,
        });
      } else {
        existing.count += 1;
        if (e.reaction) {
          existing.reactions[e.reaction] =
            (existing.reactions[e.reaction] ?? 0) + 1;
        }
        if (at > existing.last_at) {
          existing.last_at = at;
          existing.last_event_id = e.id;
          existing.food_name = e.food_name;
        }
        if (e.first_try && (!existing.first_try_at || at < existing.first_try_at)) {
          existing.first_try_at = at;
        }
      }
    }
  }

  const books = Array.from(bookByKey.values()).sort(
    (a, b) => b.last_at - a.last_at,
  );
  const foods = Array.from(foodByKey.values()).sort(
    (a, b) => b.last_at - a.last_at,
  );
  return { books, foods };
}

// ---- Incremental view updates ------------------------------------------
// These take an existing view + a change descriptor and return the
// new view, without needing the full event history. Used by the
// dual-write so book/food writes from the Library tab (which don't
// have a full events array) still update the view correctly.

export type ViewChange =
  | { kind: "insert" | "replace"; event: BabyEvent }
  | { kind: "delete"; eventId: string };

// Apply an event change to the existing LibraryView. Inserts/replaces
// dedupe-update the matching books/foods entry; deletes decrement count
// (and remove if count reaches 0). Non-book/food events leave it
// unchanged.
export function applyChangeToLibraryView(
  existing: LibraryView,
  change: ViewChange,
): LibraryView {
  if (change.kind === "delete") {
    // We don't know the type without reading the event. Decrement any
    // entry whose last_event_id matches. Drift on counts when an older
    // event of the same key was deleted is acceptable — backfill heals.
    const books = existing.books
      .map((b) =>
        b.last_event_id === change.eventId
          ? { ...b, count: Math.max(0, b.count - 1) }
          : b,
      )
      .filter((b) => b.count > 0);
    const foods = existing.foods
      .map((f) =>
        f.last_event_id === change.eventId
          ? { ...f, count: Math.max(0, f.count - 1) }
          : f,
      )
      .filter((f) => f.count > 0);
    return { books, foods };
  }
  const event = change.event;
  if (event.type === "book_read") {
    const key = (event.open_library_key ?? event.title).toLowerCase();
    const at = event.occurred_at.toMillis();
    const books = [...existing.books];
    const idx = books.findIndex((b) => b.key === key);
    if (idx === -1) {
      const entry: LibraryBookEntry = {
        key,
        title: event.title,
        count: 1,
        last_at: at,
        last_event_id: event.id,
      };
      if (event.author !== undefined) entry.author = event.author;
      if (event.cover_url !== undefined) entry.cover_url = event.cover_url;
      if (event.open_library_key !== undefined)
        entry.open_library_key = event.open_library_key;
      books.push(entry);
    } else {
      const cur = books[idx]!;
      const isNewer = at > cur.last_at;
      const updated: LibraryBookEntry = {
        ...cur,
        count: change.kind === "replace" ? cur.count : cur.count + 1,
      };
      if (isNewer) {
        updated.last_at = at;
        updated.last_event_id = event.id;
        updated.title = event.title;
        const newAuthor = event.author ?? cur.author;
        if (newAuthor !== undefined) updated.author = newAuthor;
        else delete updated.author;
        const newCover = event.cover_url ?? cur.cover_url;
        if (newCover !== undefined) updated.cover_url = newCover;
        else delete updated.cover_url;
        const newKey = event.open_library_key ?? cur.open_library_key;
        if (newKey !== undefined) updated.open_library_key = newKey;
        else delete updated.open_library_key;
      }
      books[idx] = updated;
    }
    books.sort((a, b) => b.last_at - a.last_at);
    return { ...existing, books };
  }
  if (event.type === "food_tried") {
    const key = event.food_name.trim().toLowerCase();
    const at = event.occurred_at.toMillis();
    const foods = [...existing.foods];
    const idx = foods.findIndex((f) => f.key === key);
    if (idx === -1) {
      const reactions: Partial<Record<FoodReaction, number>> = {};
      if (event.reaction) reactions[event.reaction] = 1;
      const entry: LibraryFoodEntry = {
        key,
        food_name: event.food_name,
        count: 1,
        last_at: at,
        last_event_id: event.id,
        reactions,
      };
      if (event.first_try) entry.first_try_at = at;
      foods.push(entry);
    } else {
      const cur = foods[idx]!;
      const isNewer = at > cur.last_at;
      const reactions = { ...cur.reactions };
      if (event.reaction && change.kind !== "replace") {
        reactions[event.reaction] = (reactions[event.reaction] ?? 0) + 1;
      }
      foods[idx] = {
        ...cur,
        count: change.kind === "replace" ? cur.count : cur.count + 1,
        reactions,
        ...(isNewer
          ? {
              last_at: at,
              last_event_id: event.id,
              food_name: event.food_name,
            }
          : {}),
        ...(event.first_try &&
        (!cur.first_try_at || at < cur.first_try_at)
          ? { first_try_at: at }
          : {}),
      };
    }
    foods.sort((a, b) => b.last_at - a.last_at);
    return { ...existing, foods };
  }
  return existing;
}

// Latest pointers are sparse — Lily's last weight or last book might be
// older than the recent_events_50 window. When we recompute HomeView
// from a limited projected events list, computeLatest may produce null
// for those types. Preserve the existing pointer so it doesn't get
// clobbered into null.
export function preserveLatestPointers(
  recomputed: HomeView["latest"],
  existing: HomeView["latest"] | undefined,
  change: ViewChange,
): HomeView["latest"] {
  if (!existing) return recomputed;
  const out: HomeView["latest"] = { ...recomputed };
  const keys = Object.keys(out) as (keyof HomeView["latest"])[];
  for (const k of keys) {
    if (out[k] == null && existing[k] != null) {
      // Don't preserve a pointer if the change is deleting that exact
      // event — otherwise a delete leaves a phantom latest pointer.
      const ex = existing[k]!;
      if (change.kind === "delete" && ex.eventId === change.eventId) continue;
      if (change.kind === "replace" && ex.eventId === change.event.id) continue;
      out[k] = ex as never;
    }
  }
  return out;
}

// ---- Helpers ------------------------------------------------------------

function toFeedEntry(e: BabyEvent): FeedEntry {
  if (e.type === "bottle_feed") {
    return {
      at: e.occurred_at.toMillis(),
      eventId: e.id,
      type: "bottle_feed",
      volume_ml: e.volume_ml,
      milk_types: e.milk_types,
    };
  }
  if (e.type === "breast_feed") {
    return {
      at: e.occurred_at.toMillis(),
      eventId: e.id,
      type: "breast_feed",
      side: e.side,
      outcome: e.outcome,
    };
  }
  // Caller should never pass non-feed; satisfy TS.
  throw new Error(`toFeedEntry: not a feed event (${e.type})`);
}

function computeLatest(sorted: BabyEvent[]): HomeView["latest"] {
  const out: HomeView["latest"] = {
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
  };
  for (const e of sorted) {
    const at = e.occurred_at.toMillis();
    switch (e.type) {
      case "breast_feed":
        if (!out.feed)
          out.feed = {
            at,
            eventId: e.id,
            kind: "breast",
            side: e.side,
            outcome: e.outcome,
          };
        if (!out.breast)
          out.breast = { at, eventId: e.id, side: e.side, outcome: e.outcome };
        break;
      case "bottle_feed":
        if (!out.feed)
          out.feed = {
            at,
            eventId: e.id,
            kind: "bottle",
            volume_ml: e.volume_ml,
            milk_types: e.milk_types,
          };
        if (!out.bottle)
          out.bottle = {
            at,
            eventId: e.id,
            volume_ml: e.volume_ml,
            milk_types: e.milk_types,
          };
        break;
      case "pump":
        if (!out.pump)
          out.pump = {
            at,
            eventId: e.id,
            volume_ml: e.volume_ml,
            side: e.side,
          };
        break;
      case "diaper_wet":
      case "diaper_dirty":
      case "diaper_mixed":
        if (!out.diaper)
          out.diaper = {
            at,
            eventId: e.id,
            kind:
              e.type === "diaper_wet"
                ? "wet"
                : e.type === "diaper_dirty"
                  ? "dirty"
                  : "mixed",
          };
        break;
      case "medication":
        if (!out.medication)
          out.medication = {
            at,
            eventId: e.id,
            name: e.name,
            dose: e.dose,
          };
        break;
      case "temperature":
        if (!out.temperature)
          out.temperature = {
            at,
            eventId: e.id,
            temp_f: e.temp_f,
            method: e.method,
          };
        break;
      case "weight":
        if (!out.weight)
          out.weight = {
            at,
            eventId: e.id,
            weight_grams: e.weight_grams,
          };
        break;
      case "sleep_start":
        if (!out.sleep_start) out.sleep_start = { at, eventId: e.id };
        break;
      case "sleep_end":
        if (!out.sleep_end) out.sleep_end = { at, eventId: e.id };
        break;
    }
  }
  return out;
}

function computeLastWokeAt(
  events: BabyEvent[],
  now: Date,
): number | null {
  const sleep = currentSleepState(events, 10, now);
  if (sleep.sleeping) return null;
  const windows = [
    ...explicitSleepWindows(events, now),
    ...inferredSleepWindows(events, 10, now),
  ].filter((w) => !w.ongoing && w.end.getTime() <= now.getTime());
  if (windows.length === 0) return null;
  windows.sort((a, b) => b.end.getTime() - a.end.getTime());
  return windows[0]!.end.getTime();
}

function sleepMinutesForDay(
  events: BabyEvent[],
  dayStart: Date,
  now: Date,
): number {
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  let total = 0;
  const explicit = explicitSleepWindows(events, now);
  for (const w of explicit) {
    const split = splitSleepMinutes(w.start, w.end);
    total += split[dayKeyOf(dayStart)] ?? 0;
  }
  const inferred = inferredSleepWindows(events, 10, now);
  for (const w of inferred) {
    const split = splitSleepMinutes(w.start, w.end);
    total += split[dayKeyOf(dayStart)] ?? 0;
  }
  return total;
}
