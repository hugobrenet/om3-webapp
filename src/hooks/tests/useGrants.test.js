import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {clearGrants, RETRY_DELAYS, useGrants, useIsRoot} from '../useGrants.js';

const ok = (grant) => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({grant})});
const failed = (status) => Promise.resolve({ok: false, status, json: () => Promise.resolve({})});

describe('useGrants', () => {
    beforeEach(() => {
        clearGrants();
        localStorage.setItem('authToken', 'token-1');
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.clear();
    });

    test('reads the grants once per token, shared by every view', async () => {
        global.fetch.mockReturnValue(ok({root: null}));
        const first = renderHook(() => useIsRoot());
        const second = renderHook(() => useGrants());
        await waitFor(() => expect(first.result.current).toBe(true));
        await waitFor(() => expect(second.result.current).toEqual({root: null}));
        renderHook(() => useGrants());
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['a 502', () => failed(502)],
        ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ])('after %s at load, read again: root gets its actions back without a reload', async (_label, failure) => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        global.fetch.mockImplementationOnce(failure).mockReturnValue(ok({root: null}));
        const {result} = renderHook(() => useIsRoot());
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        // Not read: not said either way.
        expect(result.current).toBeUndefined();
        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS[0]));
        await waitFor(() => expect(result.current).toBe(true));
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('a view opened after a failure reads again at once', async () => {
        global.fetch.mockReturnValueOnce(failed(502)).mockReturnValue(ok({admin: ['ns1']}));
        const first = renderHook(() => useGrants());
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        first.unmount();
        const {result} = renderHook(() => useGrants());
        await waitFor(() => expect(result.current).toEqual({admin: ['ns1']}));
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('tries again later and later while the read fails, and stops once unmounted', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        global.fetch.mockImplementation(() => failed(502));
        const {unmount} = renderHook(() => useGrants());
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS[0]));
        expect(global.fetch).toHaveBeenCalledTimes(2);
        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS[1] - 1));
        expect(global.fetch).toHaveBeenCalledTimes(2);
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(global.fetch).toHaveBeenCalledTimes(3);
        unmount();
        await act(() => vi.advanceTimersByTimeAsync(RETRY_DELAYS.at(-1) * 2));
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('root not said either way while the grants are read; said once read', async () => {
        let answer;
        global.fetch.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        const {result} = renderHook(() => useIsRoot());
        expect(result.current).toBeUndefined();
        await act(async () => answer(await ok({root: null})));
        await waitFor(() => expect(result.current).toBe(true));
        clearGrants();
        global.fetch.mockReturnValue(ok({admin: ['ns1']}));
        const other = renderHook(() => useIsRoot());
        expect(other.result.current).toBeUndefined();
        await waitFor(() => expect(other.result.current).toBe(false));
    });

    test('a view opened once they are read: given them at once, nothing read again', async () => {
        global.fetch.mockReturnValue(ok({root: null}));
        const first = renderHook(() => useIsRoot());
        await waitFor(() => expect(first.result.current).toBe(true));
        const later = renderHook(() => ({root: useIsRoot(), grants: useGrants()}));
        expect(later.result.current).toEqual({root: true, grants: {root: null}});
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('the grants not read, the same empty ones from a render to the next', () => {
        global.fetch.mockReturnValue(new Promise(() => {}));
        const {result, rerender} = renderHook(() => useGrants());
        const before = result.current;
        rerender();
        expect(result.current).toBe(before);
        expect(before).toEqual({});
    });

    test('reads nothing without a token', () => {
        localStorage.removeItem('authToken');
        const {result} = renderHook(() => ({grants: useGrants(), root: useIsRoot()}));
        // Nothing to read: no grant, said so at once.
        expect(result.current).toEqual({grants: {}, root: false});
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
