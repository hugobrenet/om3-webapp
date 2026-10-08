import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {renderHook} from '@testing-library/react';
import useAiAgent from '../useAiAgent.js';

const state = vi.hoisted(() => ({auth: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => state.auth}));
const target = {clusterId: 'cluster-id'};

describe('useAiAgent', () => {
    beforeEach(() => {
        state.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(Response.json({conversations: []})))
        );
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });
    it('disables the client when not configured', () => {
        vi.stubEnv('VITE_AI_AGENT_URL', '');
        const {result} = renderHook(() => useAiAgent(target));
        expect(result.current).toMatchObject({enabled: false, ready: false, client: null});
        expect(fetch).not.toHaveBeenCalled();
    });
    it('isolates invalid optional configuration from the rest of the webapp', () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'http://agent.example.com');
        const {result} = renderHook(() => useAiAgent(target));
        expect(result.current.enabled).toBe(false);
        expect(result.current.configurationError).toContain('HTTPS');
    });
    it.each([{clusterId: ''}, {}])('waits for a fresh cluster ID', async (value) => {
        const {result} = renderHook(() => useAiAgent(value));
        expect(result.current.ready).toBe(false);
        await expect(result.current.client.listConversations()).rejects.toMatchObject({
            code: 'not_ready',
        });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each(['basic', null, ''])(
        'uses the daemon JWT for a Basic session with authChoice %s',
        async (authChoice) => {
            state.auth.authChoice = authChoice;
            const {result} = renderHook(() => useAiAgent(target));
            expect(result.current.ready).toBe(true);
            await result.current.client.listConversations();
            expect(fetch.mock.calls[0][1]).toMatchObject({
                credentials: 'omit',
                headers: {
                    Authorization: 'Bearer token',
                    'X-OpenSVC-Cluster-ID': 'cluster-id',
                },
            });
        }
    );
    it.each(['openid', 'basic', null])('rejects a missing token for %s', async (authChoice) => {
        state.auth = {...state.auth, authChoice, accessToken: null};
        const {result} = renderHook(() => useAiAgent(target));
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
        const {result} = renderHook(() => useAiAgent(target));
        await result.current.client.listConversations();
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
        expect(fetch.mock.calls[0][1].body).toBeUndefined();
    });
    it.each(['openid', 'basic'])(
        'keeps the client stable with a renewed %s token',
        async (authChoice) => {
            state.auth.authChoice = authChoice;
            const {result, rerender} = renderHook(() => useAiAgent(target));
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
    it.each(['logout', 'user', 'cluster', 'unmount'])(
        'cancels outstanding requests on %s',
        (change) => {
            const {result, rerender, unmount} = renderHook((props) => useAiAgent(props), {
                initialProps: target,
            });
            const cancel = vi.spyOn(result.current.client, 'cancelAll');
            if (change === 'logout') {
                state.auth = {...state.auth, accessToken: null};
                rerender(target);
            }
            if (change === 'user') {
                state.auth = {...state.auth, user: 'someone-else'};
                rerender(target);
            }
            if (change === 'cluster') rerender({...target, clusterId: 'another-cluster'});
            if (change === 'unmount') unmount();
            expect(cancel).toHaveBeenCalledTimes(1);
        }
    );
});
