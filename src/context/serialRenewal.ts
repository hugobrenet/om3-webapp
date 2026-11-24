import type { User, UserManager } from "oidc-client-ts";

/** How long a renewal that failed for want of an answer waits before it is tried again. */
export const RENEW_RETRY_MS = 2000;

/** The lock the tabs of the browser renew under, one at a time (Web Locks). */
export const RENEW_LOCK = "om3-oidc-renewal";

/**
 * Whether a renewal failed because the provider refused it, saying why (`error`):
 * the session is over. A renewal failing for want of an answer, a network error or
 * a timeout, leaves the session to the next attempt.
 */
export const isRenewalRefused = (error: unknown): boolean =>
  Boolean((error as { error?: string } | null)?.error);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` under the lock every tab of the browser shares; without Web Locks, as is. */
const acrossTabs = async <T>(fn: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return typeof locks?.request === "function" ? await locks.request(RENEW_LOCK, fn) : await fn();
};

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
 * The tabs of a browser share the user, its refresh token with it (localStorage),
 * each its UserManager timed on the same expiry: two tabs renewed together, one
 * refused ended the session of both. They renew one at a time, under a lock of
 * the browser (RENEW_LOCK); the user renewed by another tab while this one waited
 * for it is taken, no request sent, the timers of this tab set on it. Refused
 * still, the token it carried spent by another tab meanwhile (a browser without
 * Web Locks, a tab of an older webapp), the user that tab saved is taken too.
 *
 * A renewal failing for want of an answer, a network error or a timeout, is tried
 * once more before it fails: only the provider refusing it, which says why
 * (`error`), ends the session at once.
 */
export function serializeSilentRenew(userManager: UserManager): UserManager {
  if (typeof userManager?.signinSilent !== "function") return userManager;
  const renew = userManager.signinSilent.bind(userManager);
  // The user stored, shared by the tabs, read as it is: getUser would set the timers
  // of this tab on it, a renewal asked again a second later within the expiry notice.
  const load = (userManager as unknown as { _loadUser?: () => Promise<User | null> })._loadUser?.bind(userManager);
  const stored = async (): Promise<User | null> => (load ? await load() : null);
  // Another tab's, taken: told loaded, the timers of this tab set on it.
  const take = () => userManager.getUser(true);
  // Another tab's: a refresh token other than `before`'s, and an access token still valid.
  const renewedSince = (user: User | null, before: User | null): user is User =>
    user !== null && before !== null && !user.expired && user.refresh_token !== before.refresh_token;
  let running: Promise<User | null> | null = null;

  const attempt = async (args?: Parameters<UserManager["signinSilent"]>[0]) => {
    try {
      return await renew(args);
    } catch (error) {
      if (isRenewalRefused(error)) throw error;
      await wait(RENEW_RETRY_MS);
      return await renew(args);
    }
  };

  const once = async (args?: Parameters<UserManager["signinSilent"]>[0]) => {
    const asked = await stored();
    return acrossTabs(async () => {
      const before = await stored();
      if (renewedSince(before, asked)) return take();
      try {
        return await attempt(args);
      } catch (error) {
        if (isRenewalRefused(error) && renewedSince(await stored(), before)) return take();
        throw error;
      }
    });
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
