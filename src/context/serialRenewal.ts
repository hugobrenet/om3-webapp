import type { User, UserManager } from "oidc-client-ts";

/** How long a renewal that failed for want of an answer waits before it is tried again. */
export const RENEW_RETRY_MS = 2000;

/**
 * Whether a renewal failed because the provider refused it, saying why (`error`):
 * the session is over. A renewal failing for want of an answer, a network error or
 * a timeout, leaves the session to the next attempt.
 */
export const isRenewalRefused = (error: unknown): boolean =>
  Boolean((error as { error?: string } | null)?.error);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes the silent renewals of a UserManager one at a time: a call made while
 * another runs shares its outcome rather than sending a request of its own.
 *
 * The renewals use the refresh token, and a provider rotating it on every use
 * (authentik, refresh token threshold 0) takes the first request and refuses the
 * second, which carries the token the first just spent. The webapp renews from
 * several places, the automatic renewal of the library, the expiry of the access
 * token, the event streams told 401, the page coming back to the front: two of
 * them close together ended the session.
 *
 * A renewal failing for want of an answer, a network error or a timeout, is tried
 * once more before it fails: only the provider refusing it, which says why
 * (`error`), ends the session at once.
 */
export function serializeSilentRenew(userManager: UserManager): UserManager {
  if (typeof userManager?.signinSilent !== "function") return userManager;
  const renew = userManager.signinSilent.bind(userManager);
  let running: Promise<User | null> | null = null;

  const once = async (args?: Parameters<UserManager["signinSilent"]>[0]) => {
    try {
      return await renew(args);
    } catch (error) {
      if (isRenewalRefused(error)) throw error;
      await wait(RENEW_RETRY_MS);
      return await renew(args);
    }
  };

  userManager.signinSilent = (args) => {
    if (running === null) {
      running = once(args).finally(() => {
        running = null;
      });
    }
    return running;
  };
  return userManager;
}
