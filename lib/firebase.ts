import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const useEmulator =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

const firebaseConfig = {
  apiKey: useEmulator
    ? "demo-api-key"
    : process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let testDbOverride: Firestore | null = null;
let testAuthOverride: Auth | null = null;

// Test-only hook: integration tests inject a Firestore instance bound to
// the emulator (via @firebase/rules-unit-testing) and a fake Auth whose
// currentUser matches the test's authentication context. With these set,
// getDb() and getFirebaseAuth() return the test instances instead of
// instantiating real ones, so writeEvent / updateEvent / softDeleteEvent
// run unmodified against the emulator.
export function __setTestFirebase(
  db: Firestore | null,
  auth: Auth | null,
): void {
  testDbOverride = db;
  testAuthOverride = auth;
}

function getApp(): FirebaseApp {
  if (app) return app;
  app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (testAuthOverride) return testAuthOverride;
  if (authInstance) return authInstance;
  authInstance = getAuth(getApp());
  if (useEmulator && typeof window !== "undefined") {
    try {
      connectAuthEmulator(authInstance, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
    } catch {
      /* already connected */
    }
  }
  setPersistence(authInstance, browserLocalPersistence).catch(() => {
    // Persistence failure is non-fatal; session works for this tab.
  });
  return authInstance;
}

export function getDb(): Firestore {
  if (testDbOverride) return testDbOverride;
  if (dbInstance) return dbInstance;
  try {
    dbInstance = initializeFirestore(getApp(), {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
      // View docs embed events whose optional fields (notes, side, dose,
      // milk_types entries, etc.) are sometimes undefined; the dual-write
      // batch.set would otherwise throw. Equivalent of the admin SDK's
      // ignoreUndefinedProperties used in scripts/backfill-views.ts.
      ignoreUndefinedProperties: true,
    });
  } catch {
    // initializeFirestore throws if called twice or if persistence unsupported;
    // fall back to default instance in that case.
    const { getFirestore } = require("firebase/firestore") as typeof import("firebase/firestore");
    dbInstance = getFirestore(getApp());
  }
  if (useEmulator && typeof window !== "undefined") {
    try {
      connectFirestoreEmulator(dbInstance, "127.0.0.1", 8080);
    } catch {
      /* already connected */
    }
  }
  return dbInstance;
}
