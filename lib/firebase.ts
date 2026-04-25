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

function getApp(): FirebaseApp {
  if (app) return app;
  app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
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
  if (dbInstance) return dbInstance;
  try {
    dbInstance = initializeFirestore(getApp(), {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
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
