export const ALLOWED_EMAILS: readonly string[] = [
  "ryanpmcintire@gmail.com",
  "kellynmelanson@gmail.com",
];

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase().trim());
}
