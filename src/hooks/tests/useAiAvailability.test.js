import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import useAiAvailability, {resetAiAvailability} from '../useAiAvailability.js';

const state = {auth: {accessToken: 'token-1'}};
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => state.auth}));

const answer = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

describe('useAiAvailability', () => {
    let fetchMock;
    beforeEach(() => {
        resetAiAvailability();
        state.auth = {accessToken: 'token-1'};
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('follows the build configuration with the agent on its own origin, asking nothing', () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        expect(renderHook(() => useAiAvailability()).result.current).toEqual({available: true, reason: null});
        vi.stubEnv('VITE_AI_AGENT_URL', '');
        expect(renderHook(() => useAiAvailability()).result.current).toEqual({available: false, reason: null});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['an agent', answer(200, {backend: 'om3'}), {available: true, reason: null}],
        ['no agent configured', answer(404, {error: {code: 'ai_not_configured', message: 'x'}}), {available: false, reason: 'not_configured'}],
        ['a session not OpenID', answer(403, {error: {code: 'ai_openid_required', message: 'x'}}), {available: false, reason: 'openid_required'}],
        ['an agent unavailable', answer(502, {error: {code: 'ai_agent_unavailable', message: 'x'}}), {available: true, reason: null}],
    ])('asks the relay of the cluster, which answers %s', async (_name, response, expected) => {
        vi.stubEnv('VITE_AI_AGENT_URL', '/api/ai');
        fetchMock.mockResolvedValue(response);
        const {result} = renderHook(() => useAiAvailability());
        expect(result.current.available).toBe(null);
        await waitFor(() => expect(result.current).toEqual(expected));
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/ai/capabilities');
        expect(options.headers.Authorization).toBe('Bearer token-1');
    });

    it('keeps the entry on a network error, which the assistant tells', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', '/api/ai');
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const {result} = renderHook(() => useAiAvailability());
        await waitFor(() => expect(result.current.available).toBe(true));
    });

    it('asks once per sign-in: a renewed token keeps the answer, a sign-out drops it', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', '/api/ai');
        fetchMock.mockResolvedValue(answer(404, {error: {code: 'ai_not_configured', message: 'x'}}));
        const {result, rerender} = renderHook(() => useAiAvailability());
        await waitFor(() => expect(result.current.available).toBe(false));
        state.auth = {accessToken: 'token-2'};
        rerender();
        renderHook(() => useAiAvailability());
        await act(async () => {});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        state.auth = {accessToken: null};
        rerender();
        await waitFor(() => expect(result.current.available).toBe(null));
        fetchMock.mockResolvedValue(answer(200, {}));
        state.auth = {accessToken: 'token-3'};
        rerender();
        await waitFor(() => expect(result.current.available).toBe(true));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
