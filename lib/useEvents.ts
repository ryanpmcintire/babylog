"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { getDb, getFirebaseAuth } from "./firebase";
import type { BabyEvent, BreastFeedOutcome, MilkType } from "./events";

export function useRecentEvents(maxCount = 200): {
  events: BabyEvent[];
  loading: boolean;
  error: string | null;
} {
  const [events, setEvents] = useState<BabyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    const sevenDaysAgo = Timestamp.fromMillis(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );
    const q = query(
      collection(db, "events"),
      where("occurred_at", ">=", sevenDaysAgo),
      orderBy("occurred_at", "desc"),
      limit(maxCount),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: BabyEvent[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<BabyEvent, "id">;
          if (!data.deleted) {
            list.push({ ...(data as BabyEvent), id: d.id });
          }
        });
        setEvents(list);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, [maxCount]);

  return { events, loading, error };
}

export type NewEventPayload =
  | { type: "breast_feed"; outcome: BreastFeedOutcome }
  | { type: "bottle_feed"; volume_ml: number; milk_types: MilkType[] }
  | { type: "pump"; volume_ml: number }
  | { type: "diaper_wet" }
  | { type: "diaper_dirty" }
  | { type: "sleep_start" }
  | { type: "sleep_end" };

export async function writeEvent(
  payload: NewEventPayload,
  occurredAt?: Date,
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const db = getDb();
  const now = occurredAt ?? new Date();
  const nowTs = Timestamp.fromDate(now);

  await addDoc(collection(db, "events"), {
    ...payload,
    occurred_at: nowTs,
    created_by: user.uid,
    created_by_email: user.email ?? null,
    created_at: nowTs,
    deleted: false,
  });
}
