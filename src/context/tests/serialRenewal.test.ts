import { afterEach, describe, expect, test, vi } from "vitest";
import type { UserManager } from "oidc-client-ts";
import { RENEW_RETRY_MS, serializeSilentRenew } from "../serialRenewal";

/** A UserManager whose renewal answers when told to, counting the requests it sends. */
function manager() {
  const pending: { resolve: (u: unknown) => void; reject: (e: unknown) => void }[] = [];
  const signinSilent = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const um = serializeSilentRenew({ signinSilent } as unknown as UserManager);
  return { um, signinSilent, pending };
}

afterEach(() => vi.useRealTimers());

describe("serializeSilentRenew", () => {
  test("renewals asked together send one request, its user to all of them: the refresh token is spent once", async () => {
    const { um, signinSilent, pending } = manager();
    const first = um.signinSilent();
    const second = um.signinSilent();
    const third = um.signinSilent();
    expect(signinSilent).toHaveBeenCalledTimes(1);
    pending[0].resolve({ access_token: "new" });
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { access_token: "new" },
      { access_token: "new" },
      { access_token: "new" },
    ]);
  });

  test("a renewal asked after the last one ended sends a request of its own", async () => {
    const { um, signinSilent, pending } = manager();
    const first = um.signinSilent();
    pending[0].resolve({ access_token: "a" });
    await first;
    const second = um.signinSilent();
    expect(signinSilent).toHaveBeenCalledTimes(2);
    pending[1].resolve({ access_token: "b" });
    await expect(second).resolves.toEqual({ access_token: "b" });
  });

  test("the provider refusing it fails at once, for all the callers: the session is over", async () => {
    const { um, signinSilent, pending } = manager();
    const first = um.signinSilent();
    const second = um.signinSilent();
    pending[0].reject({ error: "invalid_grant" });
    await expect(first).rejects.toEqual({ error: "invalid_grant" });
    await expect(second).rejects.toEqual({ error: "invalid_grant" });
    expect(signinSilent).toHaveBeenCalledTimes(1);
  });

  test("no answer, a network error or a timeout, is tried once more before failing", async () => {
    vi.useFakeTimers();
    const { um, signinSilent, pending } = manager();
    const renewal = um.signinSilent();
    pending[0].reject(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(RENEW_RETRY_MS);
    expect(signinSilent).toHaveBeenCalledTimes(2);
    pending[1].resolve({ access_token: "after the blip" });
    await expect(renewal).resolves.toEqual({ access_token: "after the blip" });
  });
});
