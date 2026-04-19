"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // Dev: make sure no stale prod SW is hijacking HMR.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) r.unregister();
      });
      if ("caches" in window) {
        caches.keys().then((keys) => {
          for (const k of keys) if (k.startsWith("babylog-")) caches.delete(k);
        });
      }
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        /* registration failures are non-fatal */
      });
  }, []);

  return null;
}
