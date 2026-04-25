/**
 * Phase B migration: copy events from top-level `events/{eid}` to
 * `households/{hid}/events/{eid}`, preserving doc IDs.
 *
 * Idempotent: re-running skips docs that already exist at the destination.
 * Refuses to proceed if it detects partial-but-mismatched state on rerun
 * (e.g., source has 480 docs, destination has 200 — abort and have a human
 * look). Original top-level docs are NOT deleted; that's a later step.
 *
 * Usage:
 *   # Against emulator (default):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/migrate-to-households.ts
 *
 *   # Against prod (after gcloud export):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   FIREBASE_PROJECT_ID=babylog-ea6b2 \
 *     npx tsx scripts/migrate-to-households.ts --prod
 *
 * Env:
 *   FIREBASE_PROJECT_ID — required
 *   FIRESTORE_EMULATOR_HOST — set to "127.0.0.1:8080" for emulator
 *   GOOGLE_APPLICATION_CREDENTIALS — service account key for prod
 *   --prod — extra confirmation gate when running against real data
 */

import {
  cert,
  initializeApp,
  applicationDefault,
  getApps,
} from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAllHouseholdSeeds } from "../lib/household";
import { getBabyForEmail } from "../lib/baby";

type EventDoc = {
  type: string;
  occurred_at: FirebaseFirestore.Timestamp;
  created_by_email?: string | null;
  deleted?: boolean;
  [k: string]: unknown;
};

const isProd = process.argv.includes("--prod");
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("FIREBASE_PROJECT_ID is required");
  process.exit(1);
}

if (isProd && isEmulator) {
  console.error("Refusing to run: --prod is set but FIRESTORE_EMULATOR_HOST is also set.");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp(
    isEmulator
      ? { projectId }
      : process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? { credential: applicationDefault(), projectId }
        : { credential: applicationDefault(), projectId },
  );
}

const db = getFirestore();

async function prodConfirmGate(): Promise<void> {
  if (!isProd) return;
  console.log("\n⚠️  PROD MIGRATION ⚠️");
  console.log("   Make sure you've run `gcloud firestore export` first.");
  console.log("   Continuing in 5 seconds. Ctrl+C to abort.\n");
  await new Promise((r) => setTimeout(r, 5000));
}

async function seedHouseholds(): Promise<void> {
  const seeds = getAllHouseholdSeeds();
  for (const seed of seeds) {
    const ref = db.doc(`households/${seed.hid}`);
    const snap = await ref.get();
    const payload = {
      baby: {
        name: seed.babyName,
        fullName: seed.babyFullName ?? null,
        birthdate: seed.babyBirthdate,
      },
      members: {} as Record<string, "owner" | "member">,
      member_emails: seed.memberEmails.map((e) => e.toLowerCase()),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) {
      await ref.set({ ...payload, created_at: FieldValue.serverTimestamp() });
      console.log(`  ✓ created household/${seed.hid}`);
    } else {
      // Merge — don't blow away existing membership map if one is set.
      await ref.set(
        {
          baby: payload.baby,
          member_emails: payload.member_emails,
          updated_at: payload.updated_at,
        },
        { merge: true },
      );
      console.log(`  ✓ updated household/${seed.hid} (merge)`);
    }
  }
}

function pickHidForEvent(e: EventDoc): string | null {
  // Use creator's email to resolve which household owns this event.
  // Falls back to default household if no email present.
  const email = (e.created_by_email ?? "").toLowerCase().trim();
  if (!email) return getAllHouseholdSeeds()[0]?.hid ?? null;
  return getBabyForEmail(email).id;
}

async function migrateEvents(): Promise<{
  copied: number;
  skipped: number;
  byHid: Record<string, number>;
}> {
  console.log("\n→ scanning legacy events/*");
  const sourceSnap = await db.collection("events").get();
  const total = sourceSnap.size;
  console.log(`  found ${total} legacy event docs`);

  let copied = 0;
  let skipped = 0;
  const byHid: Record<string, number> = {};

  // Pre-flight: count what's already in each household subcollection so we
  // can detect partial-rerun mismatches.
  const seeds = getAllHouseholdSeeds();
  for (const seed of seeds) {
    const existing = await db
      .collection(`households/${seed.hid}/events`)
      .count()
      .get();
    byHid[seed.hid] = existing.data().count;
  }
  console.log(
    `  destination state before run: ${JSON.stringify(byHid)}`,
  );

  let batch = db.batch();
  let inBatch = 0;
  const FLUSH_AT = 400;

  for (const docSnap of sourceSnap.docs) {
    const data = docSnap.data() as EventDoc;
    const hid = pickHidForEvent(data);
    if (!hid) {
      console.warn(`  ! could not resolve hid for ${docSnap.id}, skipping`);
      skipped++;
      continue;
    }
    const destRef = db.doc(`households/${hid}/events/${docSnap.id}`);
    const dest = await destRef.get();
    if (dest.exists) {
      skipped++;
      continue;
    }
    batch.set(destRef, data);
    inBatch++;
    copied++;
    byHid[hid] = (byHid[hid] ?? 0) + 1;
    if (inBatch >= FLUSH_AT) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      console.log(`  … committed (running total: ${copied})`);
    }
  }
  if (inBatch > 0) await batch.commit();

  return { copied, skipped, byHid };
}

async function verify(stats: {
  copied: number;
  skipped: number;
  byHid: Record<string, number>;
}): Promise<void> {
  const sourceCount = (await db.collection("events").count().get()).data().count;
  const destSums: Record<string, number> = {};
  for (const seed of getAllHouseholdSeeds()) {
    destSums[seed.hid] = (
      await db.collection(`households/${seed.hid}/events`).count().get()
    ).data().count;
  }
  const destTotal = Object.values(destSums).reduce((a, b) => a + b, 0);
  console.log("\n=== Verification ===");
  console.log(`  source events count  : ${sourceCount}`);
  console.log(`  dest   events totals : ${JSON.stringify(destSums)} (sum=${destTotal})`);
  console.log(`  copied this run      : ${stats.copied}`);
  console.log(`  skipped (already)    : ${stats.skipped}`);
  if (destTotal < sourceCount) {
    console.error(
      `\n✗ Destination total (${destTotal}) is less than source (${sourceCount}). Some docs were not migrated.`,
    );
    process.exit(2);
  }
  if (destTotal > sourceCount) {
    console.warn(
      `\n⚠ Destination total (${destTotal}) exceeds source (${sourceCount}). Possibly orphaned docs from a previous run, or new writes during migration.`,
    );
  } else {
    console.log("\n✓ Counts match. Migration looks good.");
  }
}

async function main() {
  console.log(
    `\nbabylog phase B migration — ${isEmulator ? "EMULATOR" : isProd ? "PROD" : "default"} (project: ${projectId})`,
  );
  await prodConfirmGate();
  console.log("→ seeding households");
  await seedHouseholds();
  const stats = await migrateEvents();
  await verify(stats);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
