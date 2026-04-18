"use client";

import { useAuth } from "../providers";

export function SignOutButton() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <button
      type="button"
      onClick={() => signOut()}
      className="text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
    >
      Sign out
    </button>
  );
}
