import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ReadableStream} from 'node:stream/web';
import {createAiAgentClient} from '../ai-agent.js';

const baseUrl = 'https://agent.example.com:8090';
const confirmation = {
    id: 'confirmation-1',
    turn_id: 'turn-1',
    tool: {name: 'stop_object', title: 'Stop object', destructive: true},
    arguments: {path: 'prod/svc/web'},
    expires_at: '2026-10-09T17:45:00Z',
};
const frame = (type, fields = {}) => `event: ${type}\ndata: ${JSON.stringify({type, ...fields})}\n\n`;
const streamResponse = (chunks) =>
    new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
                controller.close();
            },
        }),
        {headers: {'Content-Type': 'text/event-stream; charset=utf-8'}}
    );

describe('AI agent action confirmation client', () => {
    let client, fetchMock;
    beforeEach(() => {
        client = createAiAgentClient({
            baseUrl,
            getCredentials: () => ({accessToken: 'token', clusterId: 'cluster-id'}),
        });
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        client.cancelAll();
        vi.unstubAllGlobals();
    });

    it('ends a turn on a confirmation request and returns it', async () => {
        fetchMock.mockResolvedValue(
            streamResponse([frame('text_delta', {text_delta: 'Stopping', iteration: 1}), frame('confirmation_required', {iteration: 1, confirmation})])
        );
        const events = [];
        const result = await client.sendTurn('conversation-1', 'stop web', {onEvent: (event) => events.push(event.type)});
        expect(result.type).toBe('confirmation_required');
        expect(result.confirmation).toEqual(confirmation);
        expect(events).toEqual(['text_delta', 'confirmation_required']);
    });

    it('rejects a malformed confirmation request', async () => {
        for (const bad of [
            {...confirmation, id: 'bad id'},
            {...confirmation, tool: {...confirmation.tool, destructive: 'yes'}},
            {...confirmation, arguments: ['prod/svc/web']},
            {...confirmation, expires_at: 'tomorrow'},
        ]) {
            fetchMock.mockResolvedValueOnce(streamResponse([frame('confirmation_required', {iteration: 1, confirmation: bad})]));
            await expect(client.sendTurn('conversation-1', 'stop web')).rejects.toMatchObject({code: 'invalid_response'});
        }
    });

    it('posts the decision on the confirmation route and streams the rest of the turn', async () => {
        fetchMock.mockResolvedValue(streamResponse([frame('text_delta', {text_delta: 'Done', iteration: 2}), frame('completed', {iteration: 2, finish_reason: 'completed'})]));
        const result = await client.confirmTurn('conversation-1', 'turn-1', 'confirmation-1', 'approve');
        expect(result.type).toBe('completed');
        const [url, request] = fetchMock.mock.calls[0];
        expect(url).toBe(`${baseUrl}/v1/conversations/conversation-1/turns/turn-1/confirmation`);
        expect(request.method).toBe('POST');
        expect(JSON.parse(request.body)).toEqual({confirmation_id: 'confirmation-1', decision: 'approve'});
        expect(request.headers).toMatchObject({Authorization: 'Bearer token', 'X-OpenSVC-Cluster-ID': 'cluster-id'});
    });

    it('refuses any decision other than approve or reject without a request', () => {
        for (const decision of ['yes', 'Approve', '']) {
            expect(() => client.confirmTurn('conversation-1', 'turn-1', 'confirmation-1', decision)).toThrow();
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('explains a confirmation no longer pending or expired', async () => {
        fetchMock.mockResolvedValueOnce(new Response('{}', {status: 409})).mockResolvedValueOnce(new Response('{}', {status: 410}));
        await expect(client.confirmTurn('conversation-1', 'turn-1', 'confirmation-1', 'reject')).rejects.toMatchObject({
            message: 'This action no longer waits for a decision.',
        });
        await expect(client.confirmTurn('conversation-1', 'turn-1', 'confirmation-1', 'reject')).rejects.toMatchObject({
            message: 'The confirmation request expired. The action was not run.',
        });
    });

    it('reads the confirmation a conversation waits on', async () => {
        fetchMock
            .mockResolvedValueOnce(Response.json({conversation: {id: 'conversation-1'}, pending_confirmation: confirmation}))
            .mockResolvedValueOnce(Response.json({conversation: {id: 'conversation-1'}}));
        expect(await client.getConversationState('conversation-1')).toEqual({conversation: {id: 'conversation-1'}, confirmation});
        expect(await client.getConversationState('conversation-1')).toEqual({conversation: {id: 'conversation-1'}, confirmation: null});
    });
});
