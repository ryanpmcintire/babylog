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
      return { feeds: 1, breast_feeds: 1 };
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
  return s;
}
