/**
 * Pure-function tests for lib/summaries. No emulator needed.
 *
 * Run with:  npx tsx --test tests/summaries.test.ts
 */

import { test } from "node:test";
import assert from "node:assert";
import { Timestamp } from "firebase/firestore";
import {
  dayKeyOf,
  dayKeysInRange,
  deltaForEvent,
  inverseDelta,
  splitSleepMinutes,
  summaryFromDayEvents,
} from "../lib/summaries";
import type { BabyEvent } from "../lib/events";

function evt<T extends BabyEvent["type"]>(
  type: T,
  occurred: Date,
  extra: Record<string, unknown> = {},
): BabyEvent {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    type,
    occurred_at: Timestamp.fromDate(occurred),
    created_at: Timestamp.fromDate(occurred),
    created_by: "uid",
    deleted: false,
    ...extra,
  } as BabyEvent;
}

test("dayKeyOf zero-pads month and day", () => {
  assert.strictEqual(
    dayKeyOf(new Date(2026, 0, 5, 12, 0)),
    "2026-01-05",
  );
  assert.strictEqual(
    dayKeyOf(new Date(2026, 11, 31, 23, 59)),
    "2026-12-31",
  );
});

test("dayKeysInRange covers inclusive day range", () => {
  const start = new Date(2026, 3, 25, 10, 0);
  const end = new Date(2026, 3, 27, 5, 0);
  assert.deepStrictEqual(dayKeysInRange(start, end), [
    "2026-04-25",
    "2026-04-26",
    "2026-04-27",
  ]);
});

test("dayKeysInRange returns single key for same-day range", () => {
  const start = new Date(2026, 3, 25, 0, 0);
  const end = new Date(2026, 3, 25, 23, 59);
  assert.deepStrictEqual(dayKeysInRange(start, end), ["2026-04-25"]);
});

test("deltaForEvent: breast_feed", () => {
  const d = deltaForEvent({ type: "breast_feed" });
  assert.deepStrictEqual(d, { feeds: 1, breast_feeds: 1 });
});

test("deltaForEvent: bottle_feed includes volume", () => {
  const d = deltaForEvent({
    type: "bottle_feed",
    volume_ml: 90,
  } as Partial<BabyEvent> & { type: "bottle_feed" });
  assert.deepStrictEqual(d, { feeds: 1, bottle_feeds: 1, milkMl: 90 });
});

test("deltaForEvent: pump includes volume", () => {
  const d = deltaForEvent({
    type: "pump",
    volume_ml: 60,
  } as Partial<BabyEvent> & { type: "pump" });
  assert.deepStrictEqual(d, { pump_count: 1, pumpMl: 60 });
});

test("deltaForEvent: diaper_mixed contributes to wets and dirties", () => {
  const d = deltaForEvent({ type: "diaper_mixed" });
  assert.deepStrictEqual(d, {
    diapers: 1,
    mixeds: 1,
    wets: 1,
    dirties: 1,
  });
});

test("deltaForEvent: returns null for sleep, weight, temperature, etc", () => {
  for (const t of [
    "sleep_start",
    "sleep_end",
    "weight",
    "book_read",
    "food_tried",
    "temperature",
  ] as const) {
    assert.strictEqual(deltaForEvent({ type: t }), null, `expected null for ${t}`);
  }
});

test("inverseDelta negates each present field", () => {
  assert.deepStrictEqual(
    inverseDelta({ feeds: 1, milkMl: 90 }),
    { feeds: -1, milkMl: -90 },
  );
});

test("splitSleepMinutes within a single day", () => {
  // 10:00 to 12:30 same day = 150 minutes
  const start = new Date(2026, 3, 25, 10, 0);
  const end = new Date(2026, 3, 25, 12, 30);
  assert.deepStrictEqual(splitSleepMinutes(start, end), {
    "2026-04-25": 150,
  });
});

test("splitSleepMinutes across midnight", () => {
  // 23:00 to 06:00 next day = 60 + 360 = 420 minutes
  const start = new Date(2026, 3, 25, 23, 0);
  const end = new Date(2026, 3, 26, 6, 0);
  assert.deepStrictEqual(splitSleepMinutes(start, end), {
    "2026-04-25": 60,
    "2026-04-26": 360,
  });
});

test("splitSleepMinutes spanning multiple days", () => {
  // 23:30 day1 -> 00:30 day3 = 30 + 1440 + 30 minutes
  const start = new Date(2026, 3, 25, 23, 30);
  const end = new Date(2026, 3, 27, 0, 30);
  assert.deepStrictEqual(splitSleepMinutes(start, end), {
    "2026-04-25": 30,
    "2026-04-26": 1440,
    "2026-04-27": 30,
  });
});

test("splitSleepMinutes returns empty object for non-positive window", () => {
  const start = new Date(2026, 3, 25, 10, 0);
  const end = new Date(2026, 3, 25, 10, 0);
  assert.deepStrictEqual(splitSleepMinutes(start, end), {});
});

test("summaryFromDayEvents accumulates day's events with given sleep minutes", () => {
  const day = new Date(2026, 3, 25, 12, 0);
  const events: BabyEvent[] = [
    evt("bottle_feed", day, { volume_ml: 90, milk_types: ["mom_pumped"] }),
    evt("breast_feed", day, { outcome: "latched_fed" }),
    evt("diaper_mixed", day),
    evt("diaper_wet", day),
    evt("temperature", day, { temp_f: 99.4 }),
    evt("temperature", day, { temp_f: 100.1 }),
    evt("medication", day, { name: "Tylenol" }),
  ];
  const s = summaryFromDayEvents("2026-04-25", events, 480);
  assert.strictEqual(s.feeds, 2);
  assert.strictEqual(s.breast_feeds, 1);
  assert.strictEqual(s.bottle_feeds, 1);
  assert.strictEqual(s.milkMl, 90);
  assert.strictEqual(s.diapers, 2);
  assert.strictEqual(s.wets, 2);
  assert.strictEqual(s.dirties, 1);
  assert.strictEqual(s.mixeds, 1);
  assert.strictEqual(s.meds, 1);
  assert.strictEqual(s.maxTempF, 100.1);
  assert.strictEqual(s.sleepMinutes, 480);
});
