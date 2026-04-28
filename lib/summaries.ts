// Daily-summary data model. One Firestore doc per day, holding the small
// set of pre-aggregated counts/sums that charts and dashboards need. Charts
// read this collection instead of pulling raw events, dropping read cost
// from O(events) to O(days_visible).
//
// This module is PURE — no Firestore imports, no I/O. The dual-write logic
// in `useEvents.ts` and the backfill script consume these helpers.

import type { BabyEvent } from "./events";

// Doc shape stored at households/{hid}/daily_summaries/{dayKey}.
// All numeric fields are FieldValue.increment-able; `maxTempF` is the
// exception and is handled by a read-then-write because deletes need to
// re-derive the max from the day's remaining temperature events.
export type DailySummary = {
  dayKey: string;
  feeds: number;
  breast_feeds: number;
  bottle_feeds: number;
  pump_count: number;
  milkMl: number;
  pumpMl: number;
  diapers: number;
  wets: number;
  dirties: number;
  mixeds: number;
  meds: number;
  sleepMinutes: number;
  maxTempF: number | null;
};

// Numeric fields that can be applied via FieldValue.increment.
// `maxTempF` is intentionally absent — see the doc comment above.
export type SummaryDelta = {
  feeds?: number;
  breast_feeds?: number;
  bottle_feeds?: number;
  pump_count?: number;
  milkMl?: number;
  pumpMl?: number;
  diapers?: number;
  wets?: number;
  dirties?: number;
  mixeds?: number;
  meds?: number;
  sleepMinutes?: number;
};

// Local-time, zero-padded YYYY-MM-DD. Stable as a Firestore doc id and
// sortable lexicographically. Local time matches the user's mental model
// of "what day was this feed on".
export function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Inclusive list of day keys spanning [start, end]. End-exclusive at the
// midnight after `end` so a same-day [start, end] returns one key.
export function dayKeysInRange(start: Date, end: Date): string[] {
  if (end < start) return [];
  const out: string[] = [];
  const cursor = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const endDay = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate(),
  );
  while (cursor <= endDay) {
    out.push(dayKeyOf(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// Per-event delta. Returns null for events that don't roll up into the
// daily summary (sleep_start, weight, book_read, food_tried — those have
// their own handling or no chart presence).
//
// sleep_end returns null here because closing a sleep window requires the
// matching open sleep_start, which only the write path knows. The write
// path computes the duration and calls splitSleepMinutes() instead.
//
// temperature returns null because max is not increment-able. Callers
// observe the temp_f and apply maxTempF via read-then-write.
export function deltaForEvent(
  event: Pick<BabyEvent, "type"> & Partial<BabyEvent>,
): SummaryDelta | null {
  switch (event.type) {
    case "breast_feed":
      // Breast feeds are SESSION-counted, not per-event. L and R sides
      // are typically logged within a few seconds of each other and
      // collectively count as 1 nursing session — counted once if any
      // side latched, zero if both were no_latch. The session delta
      // requires neighbor-event context that this per-event helper
      // doesn't have, so deltaForEvent returns null for breast_feed
      // and the dual-write computes the session-level delta separately
      // via breastSessionDelta() below.
      return null;
    case "bottle_feed":
      return {
        feeds: 1,
        bottle_feeds: 1,
        milkMl: (event as { volume_ml?: number }).volume_ml ?? 0,
      };
    case "pump":
      return {
        pump_count: 1,
        pumpMl: (event as { volume_ml?: number }).volume_ml ?? 0,
      };
    case "diaper_wet":
      return { diapers: 1, wets: 1 };
    case "diaper_dirty":
      return { diapers: 1, dirties: 1 };
    case "diaper_mixed":
      return { diapers: 1, mixeds: 1, wets: 1, dirties: 1 };
    case "medication":
      return { meds: 1 };
    default:
      // sleep_start, sleep_end, weight, book_read, food_tried, temperature
      return null;
  }
}

// Negate every present field. Used on edit (apply inverse of old, then
// new) and delete (apply inverse of current).
export function inverseDelta(delta: SummaryDelta): SummaryDelta {
  const out: SummaryDelta = {};
  for (const k of Object.keys(delta) as (keyof SummaryDelta)[]) {
    const v = delta[k];
    if (typeof v === "number") out[k] = -v;
  }
  return out;
}

// Split a [start, end] sleep window into per-day minute totals. A window
// that crosses midnight contributes to both days proportionally. Returns
// a map keyed by dayKey with positive minute counts.
export function splitSleepMinutes(
  start: Date,
  end: Date,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (end <= start) return out;
  let cursor = new Date(start);
  while (cursor < end) {
    const nextMidnight = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    );
    const segmentEnd = nextMidnight < end ? nextMidnight : end;
    const minutes = (segmentEnd.getTime() - cursor.getTime()) / 60000;
    if (minutes > 0) {
      const k = dayKeyOf(cursor);
      out[k] = (out[k] ?? 0) + minutes;
    }
    cursor = nextMidnight;
  }
  return out;
}

// Two breast_feed events are part of the same nursing "session" if their
// occurred_at values are within this many milliseconds. Used by
// breastSessionDelta and countLatchedBreastSessions. 5 minutes covers
// the typical L-then-R logging cadence including realistic delays
// (mid-feed switch, parent grabbing the phone after baby latches)
// without merging genuinely separate feedings.
export const BREAST_SESSION_MS = 5 * 60 * 1000;

// Sum of latched-session counts across the events array. Used by
// summaryFromDayEvents (which is given today's events only) to compute
// the breast-side contribution to feeds/breast_feeds.
export function countLatchedBreastSessions(events: BabyEvent[]): number {
  const breast = events
    .filter((e) => e.type === "breast_feed")
    .sort((a, b) => a.occurred_at.toMillis() - b.occurred_at.toMillis());
  let count = 0;
  let i = 0;
  while (i < breast.length) {
    const sessionStart = breast[i]!.occurred_at.toMillis();
    let j = i;
    while (
      j < breast.length &&
      breast[j]!.occurred_at.toMillis() - sessionStart <= BREAST_SESSION_MS
    ) {
      j++;
    }
    const anyLatched = breast.slice(i, j).some(
      (e) =>
        e.type === "breast_feed" &&
        (e as Extract<BabyEvent, { type: "breast_feed" }>).outcome !== "no_latch",
    );
    if (anyLatched) count += 1;
    i = j;
  }
  return count;
}

// Incremental session-count change for a breast_feed insert or delete.
// Returns +1 / 0 / -1 — the amount to add to feeds and breast_feeds.
//
// `currentEvents` should be the array as it exists BEFORE the change is
// applied (for both insert and delete). For insert: events that share a
// session with the new event. For delete: same shape; we look up the
// deleted event's session by id.
export function breastSessionDelta(
  change:
    | { kind: "insert"; event: BabyEvent }
    | { kind: "delete"; event: BabyEvent },
  currentEvents: BabyEvent[],
): number {
  const target = change.event;
  if (target.type !== "breast_feed") return 0;
  const targetTime = target.occurred_at.toMillis();
  // Other breast_feed events within session window of the target.
  const sameSessionOthers = currentEvents.filter(
    (e) =>
      e.id !== target.id &&
      e.type === "breast_feed" &&
      Math.abs(e.occurred_at.toMillis() - targetTime) <= BREAST_SESSION_MS,
  ) as Extract<BabyEvent, { type: "breast_feed" }>[];
  const othersHaveLatched = sameSessionOthers.some(
    (e) => e.outcome !== "no_latch",
  );
  const targetIsLatched =
    (target as Extract<BabyEvent, { type: "breast_feed" }>).outcome !==
    "no_latch";

  // For insert: before = othersHaveLatched (session without target);
  //             after  = othersHaveLatched || targetIsLatched.
  // For delete: before = othersHaveLatched || targetIsLatched;
  //             after  = othersHaveLatched.
  if (change.kind === "insert") {
    const before = othersHaveLatched ? 1 : 0;
    const after = othersHaveLatched || targetIsLatched ? 1 : 0;
    return after - before;
  }
  // delete
  const before = othersHaveLatched || targetIsLatched ? 1 : 0;
  const after = othersHaveLatched ? 1 : 0;
  return after - before;
}

// Re-derive a full DailySummary from a list of events that all fall on
// the same day. Used by the backfill script and as a recompute path for
// deletions of temperature events (where max can't be inverted).
//
// Sleep minutes are NOT computed here — the caller passes them in because
// sleep windows can span days and require pairing with sleep_start events
// outside this day's slice.
export function summaryFromDayEvents(
  dayKey: string,
  events: BabyEvent[],
  sleepMinutes: number,
): DailySummary {
  const s: DailySummary = {
    dayKey,
    feeds: 0,
    breast_feeds: 0,
    bottle_feeds: 0,
    pump_count: 0,
    milkMl: 0,
    pumpMl: 0,
    diapers: 0,
    wets: 0,
    dirties: 0,
    mixeds: 0,
    meds: 0,
    sleepMinutes,
    maxTempF: null,
  };
  for (const e of events) {
    if (e.type === "temperature") {
      if (s.maxTempF === null || e.temp_f > s.maxTempF) s.maxTempF = e.temp_f;
      continue;
    }
    const d = deltaForEvent(e);
    if (!d) continue;
    if (d.feeds) s.feeds += d.feeds;
    if (d.breast_feeds) s.breast_feeds += d.breast_feeds;
    if (d.bottle_feeds) s.bottle_feeds += d.bottle_feeds;
    if (d.pump_count) s.pump_count += d.pump_count;
    if (d.milkMl) s.milkMl += d.milkMl;
    if (d.pumpMl) s.pumpMl += d.pumpMl;
    if (d.diapers) s.diapers += d.diapers;
    if (d.wets) s.wets += d.wets;
    if (d.dirties) s.dirties += d.dirties;
    if (d.mixeds) s.mixeds += d.mixeds;
    if (d.meds) s.meds += d.meds;
  }
  // Breast feeds count by SESSION, not by event — see deltaForEvent for
  // the rationale. Each latched session contributes 1 to feeds and to
  // breast_feeds.
  const breastSessionCount = countLatchedBreastSessions(events);
  s.feeds += breastSessionCount;
  s.breast_feeds += breastSessionCount;
  return s;
}
