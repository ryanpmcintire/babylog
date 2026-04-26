/**
 * Local-only verification: seeds events into the emulator, runs the views
 * backfill, then prints the resulting view docs for spot-checking.
 *
 * Usage (assumes emulator is already running):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/verify-views-emulator.ts
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing: FIRESTORE_EMULATOR_HOST must be set.");
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? "babylog-ea6b2";
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();

const HID = "mcintire";
const NOW = new Date(2026, 3, 26, 14, 0); // 2026-04-26 14:00

function ts(d: Date): Timestamp {
  return Timestamp.fromDate(d);
}

async function clear() {
  for (const c of ["events", "daily_summaries", "views"] as const) {
    const snap = await db.collection(`households/${HID}/${c}`).get();
    for (const d of snap.docs) await d.ref.delete();
  }
}

async function seed() {
  await db.doc(`households/${HID}`).set(
    {
      member_emails: ["ryanpmcintire@gmail.com"],
      baby: { name: "Lily" },
    },
    { merge: true },
  );

  function evt(type: string, at: Date, extra: Record<string, unknown> = {}) {
    return {
      type,
      occurred_at: ts(at),
      created_at: ts(at),
      created_by: "uid-test",
      created_by_email: "ryanpmcintire@gmail.com",
      deleted: false,
      ...extra,
    };
  }
  const events = [
    evt("bottle_feed", new Date(2026, 3, 26, 13, 0), {
      volume_ml: 90,
      milk_types: ["mom_pumped"],
    }),
    evt("breast_feed", new Date(2026, 3, 26, 10, 0), {
      outcome: "latched_fed",
      side: "left",
    }),
    evt("diaper_wet", new Date(2026, 3, 26, 9, 0)),
    evt("diaper_mixed", new Date(2026, 3, 26, 7, 0)),
    evt("temperature", new Date(2026, 3, 26, 5, 0), {
      temp_f: 99.4,
      method: "forehead",
    }),
    evt("medication", new Date(2026, 3, 24, 8, 0), {
      name: "Vitamin D",
      dose: "400 IU",
    }),
    evt("medication", new Date(2026, 3, 25, 8, 0), {
      name: "Vitamin D",
      dose: "400 IU",
    }),
    evt("sleep_start", new Date(2026, 3, 25, 22, 0)),
    evt("weight", new Date(2026, 3, 25, 12, 0), { weight_grams: 4500 }),
    evt("weight", new Date(2026, 3, 18, 12, 0), { weight_grams: 4200 }),
    evt("book_read", new Date(2026, 3, 25, 19, 0), {
      title: "Goodnight Moon",
      author: "Brown",
    }),
    evt("book_read", new Date(2026, 3, 24, 19, 0), {
      title: "Goodnight Moon",
      author: "Brown",
    }),
  ];
  for (const e of events) {
    await db.collection(`households/${HID}/events`).add(e);
  }
  console.log(`  seeded ${events.length} events`);
}

async function runBackfill() {
  const { spawnSync } = await import("node:child_process");
  console.log("→ summaries backfill");
  let r = spawnSync(
    "npx",
    ["tsx", "scripts/backfill-summaries.ts", "--execute"],
    {
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        FIREBASE_PROJECT_ID: projectId,
      },
      stdio: "inherit",
      shell: true,
    },
  );
  if (r.status !== 0) throw new Error(`summaries backfill exit ${r.status}`);
  console.log("→ views backfill");
  r = spawnSync("npx", ["tsx", "scripts/backfill-views.ts", "--execute"], {
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_PROJECT_ID: projectId,
    },
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) throw new Error(`views backfill exit ${r.status}`);
}

async function inspect() {
  console.log("\n=== views/home ===");
  const home = await db.doc(`households/${HID}/views/home`).get();
  if (!home.exists) {
    console.log("  (missing)");
    return;
  }
  const d = home.data() as Record<string, unknown>;
  const { recent_events: re, ...rest } = d;
  console.log(`  fields: ${JSON.stringify(rest, null, 2)}`);
  console.log(
    `  recent_events count: ${(re as unknown[] | undefined)?.length ?? 0}`,
  );

  console.log("\n=== views/insights ===");
  const insights = await db.doc(`households/${HID}/views/insights`).get();
  if (insights.exists) {
    const id = insights.data() as Record<string, unknown>;
    const ds = (id.daily_summaries as unknown[] | undefined)?.length ?? 0;
    const ms = (id.markers as unknown[] | undefined)?.length ?? 0;
    const ws = (id.weights as unknown[] | undefined)?.length ?? 0;
    console.log(`  daily_summaries: ${ds}, markers: ${ms}, weights: ${ws}`);
  } else {
    console.log("  (missing)");
  }

  console.log("\n=== views/library ===");
  const lib = await db.doc(`households/${HID}/views/library`).get();
  if (lib.exists) {
    const ld = lib.data() as Record<string, unknown>;
    const bs = (ld.books as unknown[] | undefined)?.length ?? 0;
    const fs = (ld.foods as unknown[] | undefined)?.length ?? 0;
    console.log(`  books: ${bs}, foods: ${fs}`);
    if (bs > 0) console.log(`  first book: ${JSON.stringify((ld.books as unknown[])[0])}`);
  } else {
    console.log("  (missing)");
  }
}

async function main() {
  void NOW;
  console.log("→ clearing");
  await clear();
  console.log("→ seeding");
  await seed();
  await runBackfill();
  await inspect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
