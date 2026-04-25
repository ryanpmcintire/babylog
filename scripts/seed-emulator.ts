/**
 * Seeds the emulator's legacy `events/*` collection with sample data, so
 * the migration script has something to copy.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/seed-emulator.ts
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to seed: FIRESTORE_EMULATOR_HOST not set.");
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? "babylog-ea6b2";

if (!getApps().length) initializeApp({ projectId });

const db = getFirestore();

async function main() {
  const now = Date.now();
  const docs = [
    {
      type: "diaper_wet",
      occurred_at: Timestamp.fromMillis(now - 1 * 3600_000),
      created_by: "uid-ryan",
      created_by_email: "ryanpmcintire@gmail.com",
      created_at: Timestamp.fromMillis(now - 1 * 3600_000),
      deleted: false,
    },
    {
      type: "bottle_feed",
      volume_ml: 90,
      milk_types: ["mom_pumped"],
      occurred_at: Timestamp.fromMillis(now - 2 * 3600_000),
      created_by: "uid-kelly",
      created_by_email: "kellynmelanson@gmail.com",
      created_at: Timestamp.fromMillis(now - 2 * 3600_000),
      deleted: false,
    },
    {
      type: "weight",
      weight_grams: 4200,
      occurred_at: Timestamp.fromMillis(now - 6 * 86400_000),
      created_by: "uid-ryan",
      created_by_email: "ryanpmcintire@gmail.com",
      created_at: Timestamp.fromMillis(now - 6 * 86400_000),
      deleted: false,
    },
  ];
  for (const data of docs) {
    const ref = await db.collection("events").add(data);
    console.log(`  + events/${ref.id} (${data.type})`);
  }
  console.log(`\nSeeded ${docs.length} legacy events.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
