import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {MAX_ATTEMPTS, PACE, pacedFetch, resetPacing, retryAfterMs} from '../paced-fetch.js';

const answer = (status, retryAfter) => ({
    status,
    ok: status < 400,
    headers: new Headers(retryAfter === undefined ? {} : {'Retry-After': String(retryAfter)}),
});
const urls = () => global.fetch.mock.calls.map(([u]) => u);

describe('paced-fetch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPacing();
    });
    afterEach(() => {
        resetPacing();
        vi.useRealTimers();
    });

    test('the wait a refusal says, in ms; a second without one', () => {
        expect(retryAfterMs(answer(429, 3))).toBe(3000);
        expect(retryAfterMs(answer(429))).toBe(1000);
        expect(retryAfterMs(answer(429, 'soon'))).toBe(1000);
    });

    test('the burst at once, the rest at the rate', async () => {
        global.fetch = vi.fn(() => Promise.resolve(answer(200)));
        const sent = Array.from({length: PACE.burst + 10}, (_, i) => pacedFetch(`/api/x${i}`, {method: 'POST'}));
        await vi.advanceTimersByTimeAsync(0);
        expect(global.fetch).toHaveBeenCalledTimes(PACE.burst);
        await vi.advanceTimersByTimeAsync(500);
        expect(global.fetch.mock.calls.length).toBeGreaterThan(PACE.burst);
        expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(PACE.burst + 6);
        await vi.advanceTimersByTimeAsync(1000);
        expect(global.fetch).toHaveBeenCalledTimes(PACE.burst + 10);
        await Promise.all(sent);
    });

    test('refused for asking too often: every request held for the Retry-After, then asked again, none lost', async () => {
        let refuse = true;
        global.fetch = vi.fn((url) => Promise.resolve(refuse && url === '/api/a' ? answer(429, 2) : answer(200)));
        const a = pacedFetch('/api/a', {method: 'POST'});
        await vi.advanceTimersByTimeAsync(0);
        refuse = false;
        const b = pacedFetch('/api/b');
        await vi.advanceTimersByTimeAsync(1500);
        // Held: neither asked again nor b sent before the 2s are over.
        expect(urls()).toEqual(['/api/a']);
        await vi.advanceTimersByTimeAsync(1000);
        expect(urls()).toEqual(['/api/a', '/api/a', '/api/b']);
        expect((await a).status).toBe(200);
        expect((await b).status).toBe(200);
    });

    test('the writes before the reads waiting', async () => {
        global.fetch = vi.fn(() => Promise.resolve(answer(200)));
        const burst = Array.from({length: PACE.burst}, (_, i) => pacedFetch(`/api/r${i}`));
        await vi.advanceTimersByTimeAsync(0);
        const read = pacedFetch('/api/read');
        const write = pacedFetch('/api/write', {method: 'POST'});
        await vi.advanceTimersByTimeAsync(1000);
        expect(urls().slice(PACE.burst)).toEqual(['/api/write', '/api/read']);
        await Promise.all([...burst, read, write]);
    });

    test('given up after MAX_ATTEMPTS, the last refusal answered', async () => {
        global.fetch = vi.fn(() => Promise.resolve(answer(429, 1)));
        const r = pacedFetch('/api/a', {method: 'POST'});
        await vi.advanceTimersByTimeAsync(MAX_ATTEMPTS * 1100);
        expect((await r).status).toBe(429);
        expect(global.fetch).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });
});
