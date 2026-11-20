import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {SETTLE_EVERY_MS, SETTLE_TRIES, useSettle} from '../useSettle.js';

describe('useSettle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('reads until the list says so, a second apart: true', async () => {
        const read = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue(['fast']);
        const {result} = renderHook(() => useSettle());
        let settled;
        const done = result.current(read, (items) => items.includes('fast')).then((v) => (settled = v));
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(read).toHaveBeenCalledTimes(1);
        await act(() => vi.advanceTimersByTimeAsync(SETTLE_EVERY_MS));
        expect(read).toHaveBeenCalledTimes(2);
        await act(() => vi.advanceTimersByTimeAsync(SETTLE_EVERY_MS));
        await done;
        expect(read).toHaveBeenCalledTimes(3);
        expect(settled).toBe(true);
    });

    test('gives up after its tries: false', async () => {
        const read = vi.fn().mockResolvedValue([]);
        const {result} = renderHook(() => useSettle());
        const done = result.current(read, (items) => items.includes('fast'));
        await act(() => vi.advanceTimersByTimeAsync(SETTLE_TRIES * SETTLE_EVERY_MS));
        expect(await done).toBe(false);
        expect(read).toHaveBeenCalledTimes(SETTLE_TRIES);
    });

    test('the view left while it waits: stops at once, reads no more, false', async () => {
        const read = vi.fn().mockResolvedValueOnce([]).mockResolvedValue(['fast']);
        const {result, unmount} = renderHook(() => useSettle());
        const done = result.current(read, (items) => items.includes('fast'));
        await act(() => vi.advanceTimersByTimeAsync(0));
        unmount();
        expect(await done).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(SETTLE_TRIES * SETTLE_EVERY_MS);
        expect(read).toHaveBeenCalledTimes(1);
    });

    test('the view left while it reads: what it read says nothing, false', async () => {
        let answer;
        const read = vi.fn(() => new Promise((resolve) => (answer = resolve)));
        const {result, unmount} = renderHook(() => useSettle());
        const done = result.current(read, (items) => items.includes('fast'));
        unmount();
        answer(['fast']);
        expect(await done).toBe(false);
    });
});
