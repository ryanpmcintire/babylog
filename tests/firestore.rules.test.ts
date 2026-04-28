/**
 * Rules unit tests. Runs against the Firestore emulator.
 *
 * Run with:  npm run test:rules
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
  collection,
  addDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "babylog-rules-test";
const HID = "mcintire";
const OTHER_HID = "other";
const MEMBER_UID = "uid-member";
const MEMBER_EMAIL = "ryanpmcintire@gmail.com";
const NON_MEMBER_UID = "uid-nonmember";
const NON_MEMBER_EMAIL = "stranger@example.com";
const OTHER_MEMBER_UID = "uid-other";
const OTHER_MEMBER_EMAIL = "alice@example.com";

let env: RulesTestEnvironment;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed two households with admin context (bypasses rules).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adb = ctx.firestore();
    await setDoc(doc(adb, "households", HID), {
      baby: { name: "Lily", birthdate: new Date("2026-04-09") },
      member_emails: [MEMBER_EMAIL],
      members: {},
    });
    await setDoc(doc(adb, "households", OTHER_HID), {
      baby: { name: "Other", birthdate: new Date("2026-04-09") },
      member_emails: [OTHER_MEMBER_EMAIL],
      members: {},
    });
  });
});

function memberCtx() {
  return env.authenticatedContext(MEMBER_UID, {
    email: MEMBER_EMAIL,
    email_verified: true,
  });
}

function nonMemberCtx() {
  return env.authenticatedContext(NON_MEMBER_UID, {
    email: NON_MEMBER_EMAIL,
    email_verified: true,
  });
}

function otherCtx() {
  return env.authenticatedContext(OTHER_MEMBER_UID, {
    email: OTHER_MEMBER_EMAIL,
    email_verified: true,
  });
}

test("member can read their household doc", async () => {
  const db = memberCtx().firestore();
  await assertSucceeds(getDoc(doc(db, "households", HID)));
});

test("non-member cannot read household doc", async () => {
  const db = nonMemberCtx().firestore();
  await assertFails(getDoc(doc(db, "households", HID)));
});

test("member of household A cannot read household B", async () => {
  const db = otherCtx().firestore();
  await assertFails(getDoc(doc(db, "households", HID)));
});

test("member can create event in their household", async () => {
  const db = memberCtx().firestore();
  await assertSucceeds(
    addDoc(collection(db, "households", HID, "events"), {
      type: "diaper_wet",
      occurred_at: Timestamp.now(),
      created_by: MEMBER_UID,
      created_by_email: MEMBER_EMAIL,
      created_at: Timestamp.now(),
      deleted: false,
    }),
  );
});

test("create event with mismatched created_by is denied", async () => {
  const db = memberCtx().firestore();
  await assertFails(
    addDoc(collection(db, "households", HID, "events"), {
      type: "diaper_wet",
      occurred_at: Timestamp.now(),
      created_by: "someone-else",
      created_by_email: MEMBER_EMAIL,
      created_at: Timestamp.now(),
      deleted: false,
    }),
  );
});

test("non-member cannot create event in household", async () => {
  const db = nonMemberCtx().firestore();
  await assertFails(
    addDoc(collection(db, "households", HID, "events"), {
      type: "diaper_wet",
      occurred_at: Timestamp.now(),
      created_by: NON_MEMBER_UID,
      created_by_email: NON_MEMBER_EMAIL,
      created_at: Timestamp.now(),
      deleted: false,
    }),
  );
});

test("member of A cannot create event in household B", async () => {
  const db = otherCtx().firestore();
  await assertFails(
    addDoc(collection(db, "households", HID, "events"), {
      type: "diaper_wet",
      occurred_at: Timestamp.now(),
      created_by: OTHER_MEMBER_UID,
      created_by_email: OTHER_MEMBER_EMAIL,
      created_at: Timestamp.now(),
      deleted: false,
    }),
  );
});

test("member cannot update event older than 24h", async () => {
  // Seed an old event with admin
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adb = ctx.firestore();
    const oldTs = Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000);
    await setDoc(doc(adb, "households", HID, "events", "old-event"), {
      type: "diaper_wet",
      occurred_at: oldTs,
      created_by: MEMBER_UID,
      created_by_email: MEMBER_EMAIL,
      created_at: oldTs,
      deleted: false,
    });
  });

  const db = memberCtx().firestore();
  await assertFails(
    updateDoc(doc(db, "households", HID, "events", "old-event"), {
      deleted: true,
    }),
  );
});

test("client cannot write to household doc directly", async () => {
  const db = memberCtx().firestore();
  await assertFails(
    setDoc(doc(db, "households", HID), {
      baby: { name: "Hacked" },
      member_emails: [MEMBER_EMAIL, "evil@example.com"],
    }),
  );
});

test("top-level legacy events path is denied for everyone after Phase B cleanup", async () => {
  // The legacy /events/{id} rules were removed once the migration to
  // households/{hid}/events finished and the top-level collection was
  // deleted. Both reads and writes there must now hit the default-deny.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adb = ctx.firestore();
    await setDoc(doc(adb, "events", "phantom"), {
      type: "diaper_wet",
      occurred_at: Timestamp.now(),
      created_by: MEMBER_UID,
      deleted: false,
    });
  });

  const memberDb = memberCtx().firestore();
  await assertFails(getDoc(doc(memberDb, "events", "phantom")));
  await assertFails(
    addDoc(collection(memberDb, "events"), {
      type: "diaper_wet",
      occurred_at: Timestamp.now(),
      created_by: MEMBER_UID,
      created_at: Timestamp.now(),
      deleted: false,
    }),
  );
});
