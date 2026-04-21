"use client";

import { useEffect, useState } from "react";

export type FunAgeMode =
  | "tally"
  | "minutes"
  | "heartbeats"
  | "breaths"
  | "moons"
  | "firstYear";

const STORAGE_KEY = "babylog.funAgeMode";
const CHANGE_EVENT = "babylog:funAgeMode";

export function readFunAgeMode(): FunAgeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (
      v === "tally" ||
      v === "minutes" ||
      v === "heartbeats" ||
      v === "breaths" ||
      v === "moons" ||
      v === "firstYear"
    ) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setFunAgeMode(mode: FunAgeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: mode }),
    );
  } catch {
    /* ignore */
  }
}

export function useFunAgeMode(): FunAgeMode {
  const [mode, setMode] = useState<FunAgeMode>("tally");

  useEffect(() => {
    const stored = readFunAgeMode();
    if (stored) setMode(stored);

    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as FunAgeMode;
      setMode(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue) {
        setMode(e.newValue as FunAgeMode);
      }
    }
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return mode;
}

export function rhythmClassFor(mode: FunAgeMode): string {
  if (mode === "heartbeats") return "rhythm-heartbeat";
  if (mode === "breaths") return "rhythm-breath";
  return "";
}
