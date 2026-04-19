"use client";

import { useEffect, useState } from "react";

const PREFIX = "babylog.pref.";

type PrefKey = "showGrowthCurves";

const DEFAULTS: Record<PrefKey, boolean> = {
  showGrowthCurves: false,
};

function read(key: PrefKey): boolean {
  if (typeof window === "undefined") return DEFAULTS[key];
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return DEFAULTS[key];
    return raw === "true";
  } catch {
    return DEFAULTS[key];
  }
}

function write(key: PrefKey, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent("babylog:pref-change", { detail: { key, value } }),
    );
  } catch {
    /* ignore */
  }
}

export function useBoolPref(key: PrefKey): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => DEFAULTS[key]);

  useEffect(() => {
    setValue(read(key));
    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as {
        key: PrefKey;
        value: boolean;
      } | null;
      if (detail && detail.key === key) setValue(detail.value);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === PREFIX + key) setValue(e.newValue === "true");
    }
    window.addEventListener("babylog:pref-change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("babylog:pref-change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  return [
    value,
    (v: boolean) => {
      setValue(v);
      write(key, v);
    },
  ];
}
