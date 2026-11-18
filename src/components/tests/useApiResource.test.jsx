import {renderHook, waitFor} from '@testing-library/react';
import {describe, expect, test, vi} from 'vitest';
import {useApiResource} from '../NodePanel';

const answer = (status, body) => Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(), clone() { return this; },
});

describe('useApiResource, read again as what it reads changes', () => {
    test('a change read quietly: what was read shown meanwhile, kept when that read fails', async () => {
        let reply = answer(200, {n: 1});
        global.fetch = vi.fn(() => reply);
        const {result, rerender} = renderHook(({changes}) => useApiResource('/api/x', {changes}), {initialProps: {changes: 0}});
        await waitFor(() => expect(result.current.data).toEqual({n: 1}));

        let release;
        reply = new Promise((resolve) => { release = () => resolve(answer(200, {n: 2})); });
        rerender({changes: 1});
        // Under way: no loading, the data shown.
        expect(result.current).toMatchObject({data: {n: 1}, loading: false, error: null});
        release();
        await waitFor(() => expect(result.current.data).toEqual({n: 2}));

        reply = answer(500, {detail: 'down'});
        rerender({changes: 2});
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(result.current).toMatchObject({data: {n: 2}, error: null, loading: false});
    });

    test('another url, or a reload asked: read as at first, its failure said', async () => {
        global.fetch = vi.fn(() => answer(200, {n: 1}));
        const {result, rerender} = renderHook(({url}) => useApiResource(url), {initialProps: {url: '/api/a'}});
        await waitFor(() => expect(result.current.data).toEqual({n: 1}));
        global.fetch = vi.fn(() => answer(500, {detail: 'down'}));
        rerender({url: '/api/b'});
        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.data).toBeNull();
    });
});
