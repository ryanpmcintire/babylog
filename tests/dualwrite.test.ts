/**
 * Integration tests for the dual-write path (events + daily_summaries +
 * views) running the actual writeEvent/updateEvent/softDeleteEvent code
 * against the Firestore emulator.
 *
 * Free of charge — emulator is in-memory and never touches prod. Catches
 * the class of bugs our pure unit tests can't: race conditions between
 * rapid writes, missing currentEvents propagation, view-doc drift, edits
 * that don't propagate, etc.
 *
 * Run with:  npm run test:dualwrite
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  setLogLevel,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import type { Auth } from "firebase/auth";
import { __setTestFirebase } from "../lib/firebase";
import {
  writeEvent,
  updateEvent,
  softDeleteEvent,
  type NewEventPayload,
} from "../lib/useEvents";
import type { BabyEvent } from "../lib/events";
import type { HomeView } from "../lib/views";

// Quiet down emulator's "missing index" / pending-write chatter.
setLogLevel("error");

const PROJECT_ID = "babylog-dualwrite-test";
const HID = "mcintire";
const UID = "uid-ryan";
const EMAIL = "ryanpmcintire@gmail.com";

let env: RulesTestEnvironment;
let db: Firestore;

// Read all events from a household, newest-first, with the test db.
async function readEvents(): Promise<BabyEvent[]> {
  const snap = await getDocs(
    query(
      collection(db, "households", HID, "events"),
      orderBy("occurred_at", "desc"),
    ),
  );
  return snap.docs
    .map((d) => ({ ...(d.data() as object), id: d.id }) as unknown as BabyEvent)
    .filter((e) => !e.deleted);
}

async function readHomeView(): Promise<HomeView | null> {
  const snap = await getDoc(doc(db, "households", HID, "views", "home"));
  return snap.exists() ? (snap.data() as HomeView) : null;
}

before(async () => {
  // Spin up the emulator wrapper. The same emulator instance the
  // existing test:rules suite uses is fine.
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
  // Authenticated context — same shape the real app produces after
  // email-link sign-in.
  const ctx = env.authenticatedContext(UID, {
    email: EMAIL,
    email_verified: true,
  });
  db = ctx.firestore() as unknown as Firestore;

  // Seed the household membership so isHouseholdMember() rule passes.
  // Use rules-bypass to write the parent doc; client writes are denied
  // by rules.
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const adb = adminCtx.firestore();
    await setDoc(doc(adb, "households", HID), {
      member_emails: [EMAIL],
      baby: { name: "Lily", birthdate: new Date("2026-04-09") },
    });
  });

  // Inject the test db + a fake Auth into lib/firebase so writeEvent
  // and friends pick them up instead of the real singletons.
  const fakeAuth = {
    currentUser: { uid: UID, email: EMAIL, emailVerified: true },
  } as unknown as Auth;
  __setTestFirebase(db, fakeAuth);
});

after(async () => {
  __setTestFirebase(null, null);
  await env.cleanup();
});

beforeEach(async () => {
  // Fresh slate for each test: wipe events, daily_summaries, views.
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const adb = adminCtx.firestore();
    await setDoc(doc(adb, "households", HID), {
      member_emails: [EMAIL],
      baby: { name: "Lily", birthdate: new Date("2026-04-09") },
    });
  });
});

// ---- The actual test scenarios ----

test("single bottle_feed write populates events + summary + view", async () => {
  await writeEvent(
    { type: "bottle_feed", volume_ml: 90, milk_types: ["mom_pumped"] },
    new Date(),
    [],
  );

  const events = await readEvents();
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0]!.type, "bottle_feed");

  const view = await readHomeView();
  assert.ok(view, "home view should exist");
  assert.strictEqual(view!.recent_events.length, 1);
  assert.strictEqual(view!.recent_events[0]!.type, "bottle_feed");
  assert.strictEqual(view!.today.feeds, 1);
  assert.strictEqual(view!.today.milkMl, 90);
  assert.ok(view!.latest.bottle, "latest.bottle should be set");
});

test("REGRESSION: L+R pump (two serial writes) keeps both in view", async () => {
  // Reproduces the production bug where multi-payload pump logging only
  // landed one event in the view. Each writeEvent must merge the prior
  // write's contribution (read from the view doc) since the snapshot
  // listener hasn't propagated yet.
  const when = new Date();
  let events: BabyEvent[] = [];

  // First payload — passes initial events array (empty in this test).
  await writeEvent(
    { type: "pump", volume_ml: 60, side: "left" },
    when,
    events,
  );

  // Same `events` closure as ActionGrid's for-loop — listener hasn't
  // updated it. The fix in stageViewWrites should still find the first
  // pump by reading the view doc directly.
  await writeEvent(
    { type: "pump", volume_ml: 60, side: "right" },
    when,
    events,
  );

  const allEvents = await readEvents();
  assert.strictEqual(allEvents.length, 2);

  const view = await readHomeView();
  assert.ok(view);
  assert.strictEqual(
    view!.recent_events.length,
    2,
    "both pumps must be in recent_events",
  );
  const sides = view!.recent_events.map(
    (e) => (e as Extract<BabyEvent, { type: "pump" }>).side,
  );
  assert.deepStrictEqual([...sides].sort(), ["left", "right"]);
});

test("REGRESSION: backdated event lands in view", async () => {
  // Reproduces the BackdateSheet bug: events with an explicit older
  // occurred_at must show up in views/home.recent_events and
  // recent_feeds (used by next-feed prediction).
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  await writeEvent(
    { type: "bottle_feed", volume_ml: 60, milk_types: ["formula"] },
    thirtyMinAgo,
    [],
  );

  const view = await readHomeView();
  assert.ok(view);
  assert.strictEqual(view!.recent_events.length, 1);
  assert.strictEqual(view!.recent_feeds.length, 1);
  assert.strictEqual(view!.today.bottle_feeds, 1);
});

test("REGRESSION: edit propagates to view", async () => {
  // Reproduces the EditEventSheet bug: updateEvent without currentEvents
  // skipped the view dual-write; the events collection updated but
  // views/home stayed stale.
  const id = await writeEvent(
    { type: "bottle_feed", volume_ml: 60, milk_types: ["mom_pumped"] },
    new Date(),
    [],
  );
  const eventsBeforeEdit = await readEvents();

  // Edit volume to 90.
  await updateEvent(id, { type: "bottle_feed", volume_ml: 90, milk_types: ["mom_pumped"] }, eventsBeforeEdit);

  const view = await readHomeView();
  assert.ok(view);
  const updated = view!.recent_events.find((e) => e.id === id);
  assert.ok(updated, "edited event must remain in recent_events");
  assert.strictEqual(
    (updated as Extract<BabyEvent, { type: "bottle_feed" }>).volume_ml,
    90,
    "view must reflect edited volume",
  );
});

test("REGRESSION: soft-delete removes from view", async () => {
  const id = await writeEvent(
    { type: "diaper_wet" },
    new Date(),
    [],
  );
  const eventsBeforeDelete = await readEvents();

  await softDeleteEvent(id, eventsBeforeDelete);

  const view = await readHomeView();
  assert.ok(view);
  const present = view!.recent_events.find((e) => e.id === id);
  assert.ok(!present, "deleted event must not appear in recent_events");
  assert.strictEqual(view!.today.diapers, 0);
  assert.strictEqual(view!.today.wets, 0);
});

test("REGRESSION: insightsView weights/markers/segments survive subsequent event writes", async () => {
  // Reproduces the bug where dual-write recomputed insightsView from
  // a 50-event projection — wiping weights, markers, and sleep segments
  // older than that window on every event log. Backfill restored them
  // briefly, then the next feed/diaper destroyed them again.
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const adb = adminCtx.firestore();
    await setDoc(doc(adb, "households", HID, "views", "insights"), {
      daily_summaries: [],
      markers: [
        { dayKey: "2026-04-01", atMin: 600, kind: "breast", eventId: "old-1" },
        { dayKey: "2026-04-01", atMin: 720, kind: "bottle", eventId: "old-2" },
      ],
      sleep_segments: [
        {
          dayKey: "2026-04-01",
          startMin: 1320,
          endMin: 1440,
          ongoing: false,
          source: "explicit",
        },
      ],
      weights: [
        { at: Date.now() - 14 * 86400_000, eventId: "weight-old", weight_grams: 4200 },
        { at: Date.now() - 7 * 86400_000, eventId: "weight-newer", weight_grams: 4500 },
      ],
    });
  });

  // A normal event write — historically clobbered the view.
  await writeEvent({ type: "diaper_wet" }, new Date(), []);

  const snap = await getDoc(doc(db, "households", HID, "views", "insights"));
  const v = snap.data() as {
    weights: { eventId: string }[];
    markers: { eventId: string }[];
    sleep_segments: { dayKey: string }[];
  };
  // Old weights still present
  const weightIds = v.weights.map((w) => w.eventId).sort();
  assert.deepStrictEqual(weightIds, ["weight-newer", "weight-old"]);
  // Old markers still present
  const oldMarkerIds = v.markers
    .map((m) => m.eventId)
    .filter((id) => id.startsWith("old-"))
    .sort();
  assert.deepStrictEqual(oldMarkerIds, ["old-1", "old-2"]);
  // Old sleep segments still present (April 1 is outside the new event's
  // touched-day window so it must not be recomputed).
  const oldSegmentDays = v.sleep_segments
    .map((s) => s.dayKey)
    .filter((dk) => dk === "2026-04-01");
  assert.strictEqual(oldSegmentDays.length, 1);
});

test("REGRESSION: weight write appends to insightsView.weights without losing prior", async () => {
  // Seed an existing weight, then log a new one.
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const adb = adminCtx.firestore();
    await setDoc(doc(adb, "households", HID, "views", "insights"), {
      daily_summaries: [],
      markers: [],
      sleep_segments: [],
      weights: [
        { at: Date.now() - 7 * 86400_000, eventId: "weight-prior", weight_grams: 4500 },
      ],
    });
  });

  await writeEvent({ type: "weight", weight_grams: 5000 }, new Date(), []);

  const snap = await getDoc(doc(db, "households", HID, "views", "insights"));
  const v = snap.data() as { weights: { weight_grams: number }[] };
  assert.strictEqual(v.weights.length, 2, "both weights must be present");
  const grams = v.weights.map((w) => w.weight_grams).sort();
  assert.deepStrictEqual(grams, [4500, 5000]);
});

test("REGRESSION: book write without currentEvents updates libraryView", async () => {
  // Reproduces the bug where Library tab's writeEvent calls don't pass
  // a currentEvents array (Library doesn't have a unified events list,
  // just sparse-type listeners that are disabled when the view is
  // loaded). Old gate `!currentEvents` caused the dual-write to skip
  // view updates entirely; new books vanished from the libraryView.
  await writeEvent(
    {
      type: "book_read",
      title: "Goodnight Moon",
      author: "Margaret Wise Brown",
    },
    new Date(),
    // No events array — same shape as Library tab's call site.
  );

  const libSnap = await getDoc(doc(db, "households", HID, "views", "library"));
  assert.ok(libSnap.exists(), "library view must be created");
  const lib = libSnap.data() as { books: { title: string; count: number }[] };
  assert.strictEqual(lib.books.length, 1);
  assert.strictEqual(lib.books[0]!.title, "Goodnight Moon");
  assert.strictEqual(lib.books[0]!.count, 1);
});

test("REGRESSION: book write preserves prior books in libraryView", async () => {
  // Layered scenario: backfill seeds the library with one book, then
  // a new book is logged from the Library tab (no currentEvents). The
  // recompute-from-recent-events path used to clobber the seeded book
  // because it wasn't in the small projection. Incremental update via
  // applyChangeToLibraryView preserves it.
  await env.withSecurityRulesDisabled(async (adminCtx) => {
    const adb = adminCtx.firestore();
    await setDoc(doc(adb, "households", HID, "views", "library"), {
      books: [
        {
          key: "the very hungry caterpillar",
          title: "The Very Hungry Caterpillar",
          author: "Eric Carle",
          count: 3,
          last_at: Date.now() - 30 * 86400_000,
          last_event_id: "old-id",
        },
      ],
      foods: [],
    });
  });

  await writeEvent(
    {
      type: "book_read",
      title: "Goodnight Moon",
    },
    new Date(),
  );

  const libSnap = await getDoc(doc(db, "households", HID, "views", "library"));
  const lib = libSnap.data() as { books: { title: string; count: number }[] };
  assert.strictEqual(lib.books.length, 2, "both books must be present");
  const titles = lib.books.map((b) => b.title).sort();
  assert.deepStrictEqual(titles, ["Goodnight Moon", "The Very Hungry Caterpillar"]);
});

test("REGRESSION: re-reading the same book increments count", async () => {
  await writeEvent({ type: "book_read", title: "Goodnight Moon" }, new Date());
  await writeEvent({ type: "book_read", title: "Goodnight Moon" }, new Date());
  await writeEvent({ type: "book_read", title: "Goodnight Moon" }, new Date());

  const libSnap = await getDoc(doc(db, "households", HID, "views", "library"));
  const lib = libSnap.data() as { books: { title: string; count: number }[] };
  assert.strictEqual(lib.books.length, 1);
  assert.strictEqual(lib.books[0]!.count, 3);
});

test("rapid serial writes (5 events with stale events array) all land", async () => {
  // The most aggressive race scenario: simulate the user tapping 5
  // backdate buttons in quick succession. Every writeEvent uses the
  // same (stale, empty) `events` array — only the inter-write view
  // merge can recover the previous events.
  const when = new Date();
  const staleEvents: BabyEvent[] = [];
  const payloads: NewEventPayload[] = [
    { type: "bottle_feed", volume_ml: 60, milk_types: ["formula"] },
    { type: "diaper_wet" },
    { type: "diaper_dirty" },
    { type: "breast_feed", outcome: "latched_fed", side: "left" },
    { type: "pump", volume_ml: 50, side: "right" },
  ];
  for (const p of payloads) {
    await writeEvent(p, when, staleEvents);
  }

  const events = await readEvents();
  assert.strictEqual(events.length, 5);

  const view = await readHomeView();
  assert.ok(view);
  assert.strictEqual(
    view!.recent_events.length,
    5,
    "all five events must survive in recent_events",
  );
  // Today aggregates should reflect each event.
  assert.strictEqual(view!.today.feeds, 2); // bottle + breast
  assert.strictEqual(view!.today.diapers, 2); // wet + dirty
  assert.strictEqual(view!.today.pump_count, 1);
});
