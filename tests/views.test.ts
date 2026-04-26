/**
 * Pure-function tests for lib/views. No emulator needed.
 *
 * Run with:  npx tsx --test tests/views.test.ts
 */

import { test } from "node:test";
import assert from "node:assert";
import { Timestamp } from "firebase/firestore";
import {
  computeHomeView,
  computeInsightsView,
  computeLibraryView,
  PREDICTION_LOOKBACK,
  RECENT_EVENTS_LIMIT,
} from "../lib/views";
import type { BabyEvent } from "../lib/events";

let nextId = 0;
function evt<T extends BabyEvent["type"]>(
  type: T,
  occurred: Date,
  extra: Record<string, unknown> = {},
): BabyEvent {
  return {
    id: `id-${nextId++}`,
    type,
    occurred_at: Timestamp.fromDate(occurred),
    created_at: Timestamp.fromDate(occurred),
    created_by: "uid",
    deleted: false,
    ...extra,
  } as BabyEvent;
}

const NOW = new Date(2026, 3, 26, 14, 0); // 2026-04-26 14:00

test("computeHomeView: latest pointers pick newest of each type", () => {
  const events: BabyEvent[] = [
    evt("breast_feed", new Date(2026, 3, 26, 12, 0), {
      outcome: "latched_fed",
      side: "left",
    }),
    evt("breast_feed", new Date(2026, 3, 26, 8, 0), {
      outcome: "latched_brief",
      side: "right",
    }),
    evt("bottle_feed", new Date(2026, 3, 26, 10, 0), {
      volume_ml: 90,
      milk_types: ["mom_pumped"],
    }),
    evt("diaper_wet", new Date(2026, 3, 26, 11, 0)),
    evt("diaper_mixed", new Date(2026, 3, 26, 9, 0)),
  ];
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.latest.feed?.kind, "breast");
  assert.strictEqual(v.latest.feed?.side, "left");
  assert.strictEqual(v.latest.breast?.outcome, "latched_fed");
  assert.strictEqual(v.latest.bottle?.volume_ml, 90);
  assert.strictEqual(v.latest.diaper?.kind, "wet");
});

test("computeHomeView: deleted events excluded", () => {
  const events: BabyEvent[] = [
    evt("breast_feed", new Date(2026, 3, 26, 12, 0), {
      outcome: "latched_fed",
      deleted: true,
    }),
    evt("breast_feed", new Date(2026, 3, 26, 8, 0), {
      outcome: "latched_brief",
    }),
  ];
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.latest.breast?.outcome, "latched_brief");
});

test("computeHomeView: today aggregate counts only today's events", () => {
  const events: BabyEvent[] = [
    evt("bottle_feed", new Date(2026, 3, 26, 10, 0), {
      volume_ml: 90,
      milk_types: ["mom_pumped"],
    }),
    evt("bottle_feed", new Date(2026, 3, 25, 10, 0), {
      volume_ml: 60,
      milk_types: ["mom_pumped"],
    }),
    evt("diaper_wet", new Date(2026, 3, 26, 11, 0)),
  ];
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.today.feeds, 1);
  assert.strictEqual(v.today.milkMl, 90);
  assert.strictEqual(v.today.diapers, 1);
  assert.strictEqual(v.today.wets, 1);
});

test("computeHomeView: meds_last_7d window is honored", () => {
  const events: BabyEvent[] = [
    evt("medication", new Date(2026, 3, 26, 12, 0), { name: "Tylenol" }),
    evt("medication", new Date(2026, 3, 22, 12, 0), { name: "Tylenol" }),
    // 9 days ago — outside 7d window
    evt("medication", new Date(2026, 3, 17, 12, 0), { name: "Tylenol" }),
  ];
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.meds_last_7d.length, 2);
});

test("computeHomeView: temps_last_24h window is honored", () => {
  const events: BabyEvent[] = [
    evt("temperature", new Date(2026, 3, 26, 13, 0), { temp_f: 99.0 }),
    evt("temperature", new Date(2026, 3, 26, 1, 0), { temp_f: 100.4 }),
    // 25 hours ago — outside 24h
    evt("temperature", new Date(2026, 3, 25, 13, 0), { temp_f: 98.6 }),
  ];
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.temps_last_24h.length, 2);
  assert.strictEqual(v.temps_last_24h[0]?.temp_f, 99.0); // newest first
});

test("computeHomeView: recent_feeds capped at PREDICTION_LOOKBACK", () => {
  const events: BabyEvent[] = [];
  for (let i = 0; i < 12; i++) {
    events.push(
      evt("breast_feed", new Date(2026, 3, 26, 12 - i, 0), {
        outcome: "latched_fed",
      }),
    );
  }
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.recent_feeds.length, PREDICTION_LOOKBACK);
});

test("computeHomeView: recent_events capped", () => {
  const events: BabyEvent[] = [];
  for (let i = 0; i < RECENT_EVENTS_LIMIT + 10; i++) {
    events.push(
      evt(
        "diaper_wet",
        new Date(2026, 3, 26, 12, 0, 0, -i * 1000), // 1s apart
      ),
    );
  }
  const v = computeHomeView(events, NOW);
  assert.strictEqual(v.recent_events.length, RECENT_EVENTS_LIMIT);
});

test("computeInsightsView: weights returned chronologically oldest-first", () => {
  const events: BabyEvent[] = [
    evt("weight", new Date(2026, 3, 26, 12, 0), { weight_grams: 4500 }),
    evt("weight", new Date(2026, 3, 20, 12, 0), { weight_grams: 4200 }),
    evt("weight", new Date(2026, 3, 12, 12, 0), { weight_grams: 3800 }),
  ];
  const v = computeInsightsView(events, NOW);
  assert.strictEqual(v.weights.length, 3);
  assert.strictEqual(v.weights[0]?.weight_grams, 3800);
  assert.strictEqual(v.weights[2]?.weight_grams, 4500);
});

test("computeInsightsView: daily_summaries cover INSIGHTS_DAYS days", () => {
  const events: BabyEvent[] = [
    evt("breast_feed", new Date(2026, 3, 26, 10, 0), {
      outcome: "latched_fed",
    }),
  ];
  const v = computeInsightsView(events, NOW);
  assert.strictEqual(v.daily_summaries.length, 30);
  // Today's bucket should have 1 breast feed.
  const today = v.daily_summaries[v.daily_summaries.length - 1]!;
  assert.strictEqual(today.feeds, 1);
  assert.strictEqual(today.breast_feeds, 1);
});

test("computeLibraryView: dedupes books by open_library_key or title", () => {
  const events: BabyEvent[] = [
    evt("book_read", new Date(2026, 3, 26, 12, 0), {
      title: "Goodnight Moon",
      open_library_key: "/works/OL12345W",
      author: "Brown",
    }),
    evt("book_read", new Date(2026, 3, 25, 12, 0), {
      title: "Goodnight Moon",
      open_library_key: "/works/OL12345W",
    }),
    evt("book_read", new Date(2026, 3, 24, 12, 0), {
      title: "The Very Hungry Caterpillar",
    }),
  ];
  const v = computeLibraryView(events);
  assert.strictEqual(v.books.length, 2);
  const goodnight = v.books.find((b) => b.title === "Goodnight Moon")!;
  assert.strictEqual(goodnight.count, 2);
});

test("computeLibraryView: dedupes foods and accumulates reactions", () => {
  const events: BabyEvent[] = [
    evt("food_tried", new Date(2026, 3, 26, 12, 0), {
      food_name: "avocado",
      reaction: "loved",
      first_try: false,
    }),
    evt("food_tried", new Date(2026, 3, 25, 12, 0), {
      food_name: "Avocado",
      reaction: "liked",
      first_try: false,
    }),
    evt("food_tried", new Date(2026, 3, 24, 12, 0), {
      food_name: "avocado",
      reaction: "loved",
      first_try: true,
    }),
  ];
  const v = computeLibraryView(events);
  assert.strictEqual(v.foods.length, 1);
  const avocado = v.foods[0]!;
  assert.strictEqual(avocado.count, 3);
  assert.strictEqual(avocado.reactions.loved, 2);
  assert.strictEqual(avocado.reactions.liked, 1);
  assert.ok(avocado.first_try_at);
});
