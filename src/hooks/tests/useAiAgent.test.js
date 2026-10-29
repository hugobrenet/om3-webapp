import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {renderHook} from '@testing-library/react';
import useAiAgent from '../useAiAgent.js';

const state = vi.hoisted(() => ({auth: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => state.auth}));

describe('useAiAgent', () => {
    beforeEach(() => {
        state.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({conversations: []})))
        );
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });
    it('is ready with a token alone, through the relay, the daemon naming the cluster', async () => {
        const {result} = renderHook(() => useAiAgent());
        expect(result.current.ready).toBe(true);
        await result.current.client.listConversations();
        expect(fetch.mock.calls[0][0]).toBe('/api/ai/conversations');
        expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('X-OpenSVC-Cluster-ID');
    });
    it.each(['basic', null, ''])(
        'uses the daemon JWT for a Basic session with authChoice %s',
        async (authChoice) => {
            state.auth.authChoice = authChoice;
            const {result} = renderHook(() => useAiAgent());
            expect(result.current.ready).toBe(true);
            await result.current.client.listConversations();
            expect(fetch.mock.calls[0][1]).toMatchObject({
                credentials: 'omit',
                headers: {Authorization: 'Bearer token'},
            });
        }
    );
    it.each(['openid', 'basic', null])('rejects a missing token for %s', async (authChoice) => {
        state.auth = {...state.auth, authChoice, accessToken: null};
        const {result} = renderHook(() => useAiAgent());
        expect(result.current.ready).toBe(false);
        await expect(result.current.client.listConversations()).rejects.toMatchObject({
            code: 'not_ready',
        });
        expect(fetch).not.toHaveBeenCalled();
    });
    it('forwards a native access JWT unchanged as Bearer, not Basic credentials', async () => {
        const payload = {
            iss: 'node1',
            sub: 'hugo',
            cluster_id: 'cluster-id',
            token_use: 'access',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const token = `${btoa(JSON.stringify({alg: 'RS256', typ: 'JWT'}))}.${btoa(JSON.stringify(payload))}.signature`;
        state.auth = {authChoice: null, accessToken: token, user: null};
        const {result} = renderHook(() => useAiAgent());
        await result.current.client.listConversations();
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
        expect(fetch.mock.calls[0][1].body).toBeUndefined();
    });
    it.each(['openid', 'basic'])(
        'keeps the client stable with a renewed %s token',
        async (authChoice) => {
            state.auth.authChoice = authChoice;
            const {result, rerender} = renderHook(() => useAiAgent());
            const client = result.current.client;
            const cancel = vi.spyOn(client, 'cancelAll');
            await client.listConversations();
            state.auth = {...state.auth, accessToken: 'renewed-token'};
            rerender();
            expect(result.current.client).toBe(client);
            expect(cancel).not.toHaveBeenCalled();
            await client.listConversations();
            expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer renewed-token');
        }
    );
    it.each(['logout', 'user', 'unmount'])(
        'cancels outstanding requests on %s',
        (change) => {
            const {result, rerender, unmount} = renderHook(() => useAiAgent());
            const cancel = vi.spyOn(result.current.client, 'cancelAll');
            if (change === 'logout') {
                state.auth = {...state.auth, accessToken: null};
                rerender();
            }
            if (change === 'user') {
                state.auth = {...state.auth, user: 'someone-else'};
                rerender();
            }
            if (change === 'unmount') unmount();
            expect(cancel).toHaveBeenCalledTimes(1);
        }
    );
});
