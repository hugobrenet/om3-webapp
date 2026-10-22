import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ReadableStream} from 'node:stream/web';
import {createAiAgentClient} from '../ai-agent.js';

const baseUrl = 'https://agent.example.com:8090';
const metadata = {id: 'conversation-1', title: 'Diagnostic', expires_at: '2030-01-01T00:00:00Z'};
const savedMessage = {
    id: 'turn-1:1',
    turn_id: 'turn-1',
    role: 'user',
    text: 'Previous prompt',
    created_at: '2026-10-05T12:00:00Z',
};
describe('AI agent conversations client', () => {
    let credentials, client, fetchMock;
    beforeEach(() => {
        credentials = {accessToken: 'current-token', clusterId: 'cluster-id'};
        client = createAiAgentClient({baseUrl, getCredentials: () => credentials});
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        client.cancelAll();
        vi.unstubAllGlobals();
    });

    it('creates, lists and resumes with the three headers and no cookies', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json({conversation: metadata}, {status: 201}))
            .mockResolvedValueOnce(Response.json({conversations: [metadata]}))
            .mockResolvedValueOnce(Response.json({conversation: metadata}));
        expect(await client.createConversation()).toEqual(metadata);
        expect(await client.listConversations()).toEqual([metadata]);
        expect(await client.getConversation(metadata.id)).toEqual(metadata);
        expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
            [`${baseUrl}/v1/om3/conversations`, 'POST'],
            [`${baseUrl}/v1/om3/conversations`, 'GET'],
            [`${baseUrl}/v1/om3/conversations/conversation-1`, 'GET'],
        ]);
        for (const [, options] of fetchMock.mock.calls) {
            expect(options).toMatchObject({
                credentials: 'omit',
                redirect: 'error',
                cache: 'no-store',
                headers: {
                    Authorization: 'Bearer current-token',
                    'X-OpenSVC-Cluster-ID': 'cluster-id',
                },
            });
        }
        expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    });
    it('reads the renewed access token at each operation', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(Response.json({conversations: []})));
        await client.listConversations();
        credentials.accessToken = 'renewed-token';
        await client.listConversations();
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer renewed-token');
    });
    it('loads messages with the same headers and exclusive cursor pagination', async () => {
        const page = {messages: [savedMessage], next_cursor: '1:1'};
        fetchMock
            .mockResolvedValueOnce(Response.json(page))
            .mockResolvedValueOnce(Response.json({messages: [], next_cursor: ''}));
        expect(await client.getMessages(metadata.id)).toEqual(page);
        credentials.accessToken = 'renewed-token';
        await client.getMessages(metadata.id, {limit: 10, before: '1:1'});
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            `${baseUrl}/v1/om3/conversations/conversation-1/messages?limit=50`,
            `${baseUrl}/v1/om3/conversations/conversation-1/messages?limit=10&before=1%3A1`,
        ]);
        expect(fetchMock.mock.calls[1][1]).toMatchObject({
            method: 'GET',
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            headers: {
                Accept: 'application/json',
                Authorization: 'Bearer renewed-token',
                'X-OpenSVC-Cluster-ID': 'cluster-id',
            },
        });
        expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
    });
    it.each([
        {limit: 0},
        {limit: 101},
        {limit: 1.5},
        {limit: '50'},
        {before: null},
        {before: '01:1'},
        {before: '0:1'},
        {before: '1:1:1'},
        {before: '9223372036854775808:1'},
    ])('rejects invalid history query %j before HTTP', (query) => {
        expect(() => client.getMessages(metadata.id, query)).toThrow('pagination');
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each([
        {},
        {messages: [], next_cursor: null},
        {messages: [], next_cursor: '1:1'},
        {messages: [savedMessage], next_cursor: '01:1'},
        {messages: [null], next_cursor: ''},
        {messages: [{...savedMessage, role: 'tool'}], next_cursor: ''},
        {messages: [{...savedMessage, role: 'assistant', id: 'wrong-id'}], next_cursor: ''},
        {messages: [{...savedMessage, id: 'wrong id'}], next_cursor: ''},
        {messages: [{...savedMessage, text: null}], next_cursor: ''},
        {messages: [{...savedMessage, created_at: 'invalid'}], next_cursor: ''},
        {messages: [savedMessage, savedMessage], next_cursor: ''},
        {
            messages: Array.from({length: 101}, (_, index) => ({
                ...savedMessage,
                id: `turn-1:${index + 1}`,
            })),
            next_cursor: '',
        },
    ])('rejects malformed history pages', async (page) => {
        fetchMock.mockResolvedValue(Response.json(page));
        await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
            code: 'invalid_response',
        });
    });
    it.each(['2:2', '3:1'])('rejects a non-progressing history cursor %s', async (next_cursor) => {
        fetchMock.mockResolvedValue(Response.json({messages: [savedMessage], next_cursor}));
        await expect(client.getMessages(metadata.id, {before: '2:2'})).rejects.toMatchObject({
            code: 'invalid_response',
        });
    });
    it('accepts a prompt under the ID the webapp gave it, never an answer', async () => {
        const prompt = {...savedMessage, id: '0f3c2a9e5b7d4c1a8e6f2b9d0c4a7e13'};
        fetchMock
            .mockResolvedValueOnce(Response.json({messages: [prompt], next_cursor: ''}))
            .mockResolvedValueOnce(
                Response.json({messages: [{...prompt, role: 'assistant'}], next_cursor: ''})
            )
            .mockResolvedValueOnce(Response.json({messages: [{...prompt, id: 'has space'}], next_cursor: ''}));
        expect((await client.getMessages(metadata.id)).messages).toEqual([prompt]);
        for (let index = 0; index < 2; index++)
            await expect(client.getMessages(metadata.id)).rejects.toMatchObject({code: 'invalid_response'});
    });
    it('projects only display fields from a history message', async () => {
        fetchMock.mockResolvedValue(
            Response.json({
                messages: [
                    {...savedMessage, tool_results: 'not display data', usage: 'not saved usage'},
                ],
                next_cursor: '',
            })
        );
        expect(await client.getMessages(metadata.id)).toEqual({
            messages: [savedMessage],
            next_cursor: '',
        });
    });
    it('decodes UTF-8 history split across network chunks', async () => {
        const page = {messages: [{...savedMessage, text: 'État 😀'}], next_cursor: ''};
        const bytes = new TextEncoder().encode(JSON.stringify(page));
        fetchMock.mockResolvedValue(
            new Response(
                new ReadableStream({
                    start(controller) {
                        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
                        controller.close();
                    },
                }),
                {headers: {'Content-Type': 'application/json; charset=utf-8'}}
            )
        );
        expect(await client.getMessages(metadata.id)).toEqual(page);
    });
    it('cancels an oversized history body before it finishes', async () => {
        const cancel = vi.fn();
        fetchMock.mockResolvedValue(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
                    },
                    cancel,
                }),
                {headers: {'Content-Type': 'application/json'}}
            )
        );
        await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
            code: 'invalid_response',
        });
        expect(cancel).toHaveBeenCalled();
    });
    it('cancels an unexpected non-JSON history response', async () => {
        const cancel = vi.fn();
        fetchMock.mockResolvedValue(
            new Response(new ReadableStream({cancel}), {
                headers: {'Content-Type': 'text/html'},
            })
        );
        await expect(client.getMessages(metadata.id)).rejects.toMatchObject({
            code: 'invalid_response',
        });
        expect(cancel).toHaveBeenCalled();
    });
    it('aborts history while its body is still streaming', async () => {
        const cancel = vi.fn();
        const response = new Response(new ReadableStream({cancel}), {
            headers: {'Content-Type': 'application/json'},
        });
        fetchMock.mockResolvedValue(response);
        const controller = new AbortController();
        const pending = client.getMessages(metadata.id, {signal: controller.signal});
        const assertion = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        await vi.waitFor(() => expect(response.body.locked).toBe(true));
        controller.abort();
        await assertion;
        expect(cancel).toHaveBeenCalled();
    });
    it.each([401, 403, 404, 410, 413, 503])(
        'sanitizes a history HTTP %s failure without retrying',
        async (status) => {
            fetchMock.mockResolvedValue(
                Response.json({error: 'private upstream failure'}, {status})
            );
            const error = await client.getMessages(metadata.id).catch((error) => error);
            expect(error).toMatchObject({code: 'http_error', status});
            expect(error.message).not.toContain('private');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    );
    it('renames with PATCH and returns updated metadata', async () => {
        const renamed = {...metadata, title: 'Cluster health'};
        fetchMock.mockResolvedValue(Response.json({conversation: renamed}));
        expect(await client.renameConversation(metadata.id, '  Cluster\thealth\n ')).toEqual(
            renamed
        );
        expect(fetchMock).toHaveBeenCalledWith(
            `${baseUrl}/v1/om3/conversations/conversation-1`,
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({title: 'Cluster health'}),
                credentials: 'omit',
                redirect: 'error',
                cache: 'no-store',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer current-token',
                    'X-OpenSVC-Cluster-ID': 'cluster-id',
                },
            })
        );
    });
    it('counts Unicode code points for titles and normalizes controls', async () => {
        const title = '😀'.repeat(80);
        fetchMock.mockResolvedValue(Response.json({conversation: {...metadata, title}}));
        await client.renameConversation(metadata.id, ` \u200b${title}\t `);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({title});
    });
    it.each([undefined, null, 42, '', ' \t\n\u200b ', 'a'.repeat(81), '😀'.repeat(81)])(
        'rejects invalid titles before sending HTTP',
        (title) => {
            expect(() => client.renameConversation(metadata.id, title)).toThrow('80 characters');
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );
    it('deletes with DELETE and does not parse the empty 204 response', async () => {
        const response = new Response(null, {status: 204});
        const json = vi.spyOn(response, 'json');
        fetchMock.mockResolvedValue(response);
        await expect(client.deleteConversation(metadata.id)).resolves.toBeUndefined();
        expect(json).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith(
            `${baseUrl}/v1/om3/conversations/conversation-1`,
            expect.objectContaining({
                method: 'DELETE',
                credentials: 'omit',
                redirect: 'error',
                cache: 'no-store',
                headers: {
                    Accept: 'application/json',
                    Authorization: 'Bearer current-token',
                    'X-OpenSVC-Cluster-ID': 'cluster-id',
                },
            })
        );
        expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    });
    it('rejects an unexpected successful deletion response and closes its body', async () => {
        const cancel = vi.fn();
        fetchMock.mockResolvedValue(new Response(new ReadableStream({cancel}), {status: 200}));
        await expect(client.deleteConversation(metadata.id)).rejects.toMatchObject({
            code: 'invalid_response',
        });
        expect(cancel).toHaveBeenCalledTimes(1);
    });
    it.each(['rename', 'delete'])('uses renewed credentials for %s', async (operation) => {
        credentials.accessToken = 'renewed-token';
        fetchMock.mockResolvedValue(
            operation === 'rename'
                ? Response.json({conversation: metadata})
                : new Response(null, {status: 204})
        );
        if (operation === 'rename') await client.renameConversation(metadata.id, 'New title');
        else await client.deleteConversation(metadata.id);
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer renewed-token');
    });
    it.each(['rename', 'delete'])(
        'refuses %s without credentials or a valid ID',
        async (operation) => {
            const invoke = (id) =>
                operation === 'rename'
                    ? client.renameConversation(id, 'New title')
                    : client.deleteConversation(id);
            expect(() => invoke('../ask')).toThrow('valid conversation ID');
            credentials = null;
            await expect(invoke(metadata.id)).rejects.toMatchObject({code: 'not_ready'});
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );
    it.each(['rename', 'delete'])(
        'preserves authorization, missing, expired and busy errors for %s without retries',
        async (operation) => {
            for (const status of [401, 403, 404, 409, 410]) {
                fetchMock.mockResolvedValueOnce(
                    Response.json({error: {message: 'secret upstream'}}, {status})
                );
                const pending =
                    operation === 'rename'
                        ? client.renameConversation(metadata.id, 'New title')
                        : client.deleteConversation(metadata.id);
                const error = await pending.catch((error) => error);
                expect(error).toMatchObject({code: 'http_error', status});
                expect(error.message).not.toContain('secret');
            }
            expect(fetchMock).toHaveBeenCalledTimes(5);
        }
    );
    it.each(['rename', 'delete'])('supports an external abort signal for %s', async (operation) => {
        const controller = new AbortController();
        fetchMock.mockImplementation(
            (_url, {signal}) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('Canceled', 'AbortError')),
                        {once: true}
                    );
                })
        );
        const pending =
            operation === 'rename'
                ? client.renameConversation(metadata.id, 'New title', {signal: controller.signal})
                : client.deleteConversation(metadata.id, {signal: controller.signal});
        const assertion = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        controller.abort();
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it.each([
        null,
        {},
        {accessToken: 'token'},
        {accessToken: 'token', clusterId: ''},
        {accessToken: 'token', clusterId: 'cluster-id\r\nInjected: yes'},
        {accessToken: 'token', clusterId: 'cluster-a,cluster-b'},
        {accessToken: 'token', clusterId: ' cluster-id'},
        {accessToken: 'token', clusterId: 'é'.repeat(129)},
    ])('does not send HTTP without a valid authentication and cluster ID', async (value) => {
        credentials = value;
        await expect(client.listConversations()).rejects.toMatchObject({code: 'not_ready'});
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it.each(['../ask', 'a/b', '', 'a?token=secret'])('rejects invalid conversation IDs', (id) => {
        expect(() => client.getConversation(id)).toThrow('valid conversation ID');
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects an invalid JSON envelope', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({conversations: null}));
        await expect(client.listConversations()).rejects.toMatchObject({code: 'invalid_response'});
    });
    it.each([401, 403, 404, 409, 410, 429, 500, 503])(
        'reports HTTP %s without exposing body or retrying',
        async (status) => {
            fetchMock.mockResolvedValue(
                Response.json({error: {message: 'secret upstream'}}, {status})
            );
            const error = await client.listConversations().catch((error) => error);
            expect(error.status).toBe(status);
            expect(error.message).not.toContain('secret');
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    );
    it('sanitizes network failures', async () => {
        fetchMock.mockRejectedValue(new Error('request contained current-token'));
        const error = await client.createConversation().catch((error) => error);
        expect(error.code).toBe('network_error');
        expect(error.message).not.toContain('current-token');
    });
    it('does not fetch for a previously aborted signal', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(client.listConversations({signal: controller.signal})).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
