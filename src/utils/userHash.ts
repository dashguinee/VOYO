/**
 * User hash — account-linked ID if logged in, stable anon device hash otherwise.
 *
 * Extracted to a standalone util so it has no dependency on centralDJ/oyoDJ
 * (which import each other transitively via oyoPlan) — prevents circular deps.
 */

let cached: string | null = null;

export function getUserHash(): string {
  try {
    const accountData = localStorage.getItem('voyo-account');
    if (accountData) {
      const parsed = JSON.parse(accountData);
      if (parsed?.account?.id) return parsed.account.id;
    }
  } catch {
    // ignore parse errors
  }

  if (cached) return cached;

  const stored = localStorage.getItem('voyo_user_hash');
  if (stored) {
    cached = stored;
    return stored;
  }

  const fresh =
    'u_' +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  localStorage.setItem('voyo_user_hash', fresh);
  cached = fresh;
  return fresh;
}
