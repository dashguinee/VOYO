/**
 * User hash — account-linked ID if logged in, stable anon device hash otherwise.
 *
 * Contract (C3, 2026-04-22):
 *   The `voyo-account` key is written by dash-auth.tsx (signInWithDashId,
 *   exchangeSSOToken, handleSSOCallback) and universeStore.handleDashCallback,
 *   and cleared by signOutDash + universeStore.logout. Shape:
 *     { account: { id: <dash coreId> } }
 *   When present, getUserHash returns the DASH coreId so voyo_signals rows
 *   are keyed to a stable identity that follows the user cross-device.
 *   When absent (anon / logged-out), falls back to the device hash in
 *   `voyo_user_hash` so anon users still get a persistent local identity.
 *
 *   voyo-account takes precedence on EVERY call, so the `cached` anon hash
 *   never leaks into a post-login session. Still: sites that login the user
 *   must write voyo-account BEFORE firing any signal; otherwise the first
 *   few rows of the session land under the anon hash.
 *
 *   Follow-up (not implemented here): a historical-migration pass that
 *   rewrites voyo_signals.user_hash from the device anon to the DASH id the
 *   first time a device authenticates, so pre-login taste follows the user
 *   into their account.
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
