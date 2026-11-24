import { afterEach, describe, expect, test, vi } from "vitest";
import { InMemoryWebStorage, User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import { RENEW_LOCK, RENEW_RETRY_MS, serializeSilentRenew } from "../serialRenewal";

/** A UserManager whose renewal answers when told to, counting the requests it sends. */
function manager() {
  const pending: { resolve: (u: unknown) => void; reject: (e: unknown) => void }[] = [];
  const signinSilent = vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const um = serializeSilentRenew({ signinSilent } as unknown as UserManager);
  return { um, signinSilent, pending };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Two tabs of a browser: the user they share (localStorage), the lock they share
 * (Web Locks), each its UserManager. A renewal answers when told to, its refresh
 * token then spent: the provider refuses it again, as one rotating it does.
 */
function browser({ locks = true } = {}) {
  let saved = { access_token: "a1", refresh_token: "r1", expired: false };
  const spent = new Set<string>();
  const held: string[] = [];
  let queue = Promise.resolve();
  if (locks) {
    vi.stubGlobal("navigator", {
      ...navigator,
      locks: {
        request: (name: string, fn: () => Promise<unknown>) => {
          const run = queue.then(() => {
            held.push(name);
            return fn();
          });
          queue = run.then(() => undefined, () => undefined);
          return run;
        },
      },
    });
  }
  const tab = () => {
    const pending: (() => void)[] = [];
    const loaded: unknown[] = [];
    const signinSilent = vi.fn(async () => {
      const token = saved.refresh_token;
      await new Promise<void>((resolve) => pending.push(resolve));
      if (spent.has(token)) throw { error: "invalid_grant" };
      spent.add(token);
      const n = Number(token.slice(1)) + 1;
      saved = { access_token: `a${String(n)}`, refresh_token: `r${String(n)}`, expired: false };
      return saved;
    });
    const getUser = vi.fn(async (raise?: boolean) => {
      if (raise) loaded.push(saved);
      return saved;
    });
    const _loadUser = vi.fn(async () => saved);
    const um = serializeSilentRenew({ signinSilent, getUser, _loadUser } as unknown as UserManager);
    return { um, signinSilent, pending, loaded };
  };
  // The refresh token stored spent, by a tab of an older webapp say: refused from now on.
  const spend = () => spent.add(saved.refresh_token);
  return { tab, held, saved: () => saved, spend };
}

/** Lets the promises queued run, a renewal reaching its request: no timer, fake ones too. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("serializeSilentRenew", () => {
  test("renewals asked together send one request, its user to all of them: the refresh token is spent once", async () => {
    const { um, signinSilent, pending } = manager();
    const first = um.signinSilent();
    const second = um.signinSilent();
    const third = um.signinSilent();
    await settle();
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
    await settle();
    pending[0].resolve({ access_token: "a" });
    await first;
    const second = um.signinSilent();
    await settle();
    expect(signinSilent).toHaveBeenCalledTimes(2);
    pending[1].resolve({ access_token: "b" });
    await expect(second).resolves.toEqual({ access_token: "b" });
  });

  test("the provider refusing it fails at once, for all the callers: the session is over", async () => {
    const { um, signinSilent, pending } = manager();
    const first = um.signinSilent();
    const second = um.signinSilent();
    await settle();
    pending[0].reject({ error: "invalid_grant" });
    await expect(first).rejects.toEqual({ error: "invalid_grant" });
    await expect(second).rejects.toEqual({ error: "invalid_grant" });
    expect(signinSilent).toHaveBeenCalledTimes(1);
  });

  test("no answer, a network error or a timeout, is tried once more before failing", async () => {
    vi.useFakeTimers();
    const { um, signinSilent, pending } = manager();
    const renewal = um.signinSilent();
    await settle();
    pending[0].reject(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(RENEW_RETRY_MS);
    expect(signinSilent).toHaveBeenCalledTimes(2);
    pending[1].resolve({ access_token: "after the blip" });
    await expect(renewal).resolves.toEqual({ access_token: "after the blip" });
  });

  test("two tabs renewing together, one at a time: the second takes the user the first renewed, no request of its own", async () => {
    const { tab, held, saved } = browser();
    const a = tab();
    const b = tab();
    const first = a.um.signinSilent();
    const second = b.um.signinSilent();
    await settle();
    expect(a.signinSilent).toHaveBeenCalledTimes(1);
    expect(b.signinSilent).not.toHaveBeenCalled();
    a.pending[0]();
    await expect(first).resolves.toEqual({ access_token: "a2", refresh_token: "r2", expired: false });
    await expect(second).resolves.toEqual(saved());
    expect(b.signinSilent).not.toHaveBeenCalled();
    // Told loaded, for the tab to use it, its timers set on it.
    expect(b.loaded).toEqual([saved()]);
    expect(held).toEqual([RENEW_LOCK, RENEW_LOCK]);
  });

  test("a tab renewing after the other ended sends a request of its own, the token renewed by the other", async () => {
    const { tab } = browser();
    const a = tab();
    const b = tab();
    const first = a.um.signinSilent();
    await settle();
    a.pending[0]();
    await first;
    const second = b.um.signinSilent();
    await settle();
    expect(b.signinSilent).toHaveBeenCalledTimes(1);
    b.pending[0]();
    await expect(second).resolves.toMatchObject({ refresh_token: "r3" });
  });

  test("no Web Locks, refused, the token spent by the other tab meanwhile: the user it saved taken, the session kept", async () => {
    const { tab, saved } = browser({ locks: false });
    const a = tab();
    const b = tab();
    const first = a.um.signinSilent();
    const second = b.um.signinSilent();
    await settle();
    expect(b.signinSilent).toHaveBeenCalledTimes(1);
    a.pending[0]();
    await first;
    b.pending[0]();
    await expect(second).resolves.toEqual(saved());
    expect(b.loaded).toEqual([saved()]);
  });

  test("refused, nothing renewed since by another tab: the session is over", async () => {
    const { tab, spend } = browser();
    const a = tab();
    spend();
    const renewal = a.um.signinSilent();
    await settle();
    a.pending[0]();
    await expect(renewal).rejects.toEqual({ error: "invalid_grant" });
    expect(a.loaded).toEqual([]);
  });

  test("the real UserManagers of two tabs, one store: one refresh, the other tab the user it stored", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      locks: {
        queue: Promise.resolve() as Promise<unknown>,
        request(_name: string, fn: () => Promise<unknown>) {
          const run = this.queue.then(fn);
          this.queue = run.catch(() => undefined);
          return run;
        },
      },
    });
    const store = new InMemoryWebStorage();
    const settings = {
      authority: "https://idp.example", client_id: "om3", redirect_uri: "https://node/auth-callback",
      userStore: new WebStorageStateStore({ store }),
    };
    const user = (n: number) => new User({
      access_token: `a${String(n)}`, token_type: "Bearer", refresh_token: `r${String(n)}`,
      profile: { sub: "u", iss: settings.authority, aud: settings.client_id, exp: 0, iat: 0 },
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    // The refresh, rotating: the token stored spent, a new one stored; spent, refused.
    const spent = new Set<string>();
    const refreshes = vi.spyOn(UserManager.prototype, "signinSilent").mockImplementation(async function (this: UserManager) {
      const current = await this.getUser();
      const token = current?.refresh_token ?? "";
      if (spent.has(token)) throw { error: "invalid_grant" };
      spent.add(token);
      const next = user(Number(token.slice(1)) + 1);
      await this.storeUser(next);
      return next;
    });
    await new UserManager(settings).storeUser(user(1));
    const a = serializeSilentRenew(new UserManager(settings));
    const b = serializeSilentRenew(new UserManager(settings));
    const [first, second] = await Promise.all([a.signinSilent(), b.signinSilent()]);
    expect(refreshes).toHaveBeenCalledTimes(1);
    expect(first?.refresh_token).toBe("r2");
    expect(second?.refresh_token).toBe("r2");
    refreshes.mockRestore();
  });
});
