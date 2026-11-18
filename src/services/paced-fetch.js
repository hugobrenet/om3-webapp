/**
 * The daemon throttles each client address (listener.throttle_rate, 20 requests a
 * second by default, and throttle_burst, 100): a request over it is answered 429,
 * Retry-After saying when to ask again, refused before it is run. The requests the
 * webapp sends by the hundred, an action on a selection and the tray following each,
 * go through one budget under it, the rest of the page keeping its share: an action
 * on 300 objects sent at once lost those refused, and the reads of the tray refused
 * by the thousand starved the page of its own.
 *
 * A request waits its turn, the writes (an action) before the reads (the tray); a 429
 * holds every request until its Retry-After is over, then asks again.
 */
export const PACE = {rate: 10, burst: 30};

/** How many times a request refused for asking too often is asked again. */
export const MAX_ATTEMPTS = 8;

let tokens = PACE.burst;
let refilledAt = Date.now();
let blockedUntil = 0;
let timer = null;
const writes = [];
const reads = [];

function refill() {
    const now = Date.now();
    tokens = Math.min(PACE.burst, tokens + ((now - refilledAt) * PACE.rate) / 1000);
    refilledAt = now;
}

function pump() {
    timer = null;
    const now = Date.now();
    if (now < blockedUntil) {
        timer = setTimeout(pump, blockedUntil - now);
        return;
    }
    refill();
    while (tokens >= 1 && (writes.length > 0 || reads.length > 0)) {
        tokens -= 1;
        (writes.length > 0 ? writes : reads).shift()();
    }
    if (writes.length > 0 || reads.length > 0) timer = setTimeout(pump, Math.ceil(1000 / PACE.rate));
}

/** Resolves when the request may go: at once while the budget lasts, in its order after. */
function turn(write) {
    return new Promise((resolve) => {
        (write ? writes : reads).push(resolve);
        if (timer === null) pump();
    });
}

/** How long a refusal for asking too often says to wait (Retry-After, in seconds), `fallback` ms when it says nothing. */
export function retryAfterMs(response, fallback = 1000) {
    const seconds = Number(response?.headers?.get?.("Retry-After"));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}

/**
 * `fetch`, paced within the budget, asked again while refused for asking too often
 * (up to MAX_ATTEMPTS, the last answer then given as it is). A write unless a GET.
 */
export async function pacedFetch(url, init = {}) {
    const write = (init.method ?? "GET").toUpperCase() !== "GET";
    for (let attempt = 1; ; attempt += 1) {
        await turn(write);
        const response = await fetch(url, init);
        if (response.status !== 429 || attempt >= MAX_ATTEMPTS) return response;
        blockedUntil = Math.max(blockedUntil, Date.now() + retryAfterMs(response));
    }
}

/** The budget full again, nothing waiting: for the tests. */
export function resetPacing() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    tokens = PACE.burst;
    refilledAt = Date.now();
    blockedUntil = 0;
    writes.length = 0;
    reads.length = 0;
}
