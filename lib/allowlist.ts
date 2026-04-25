import { getAllowedEmails } from "./baby";

export const ALLOWED_EMAILS: readonly string[] = getAllowedEmails();

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase().trim());
}
