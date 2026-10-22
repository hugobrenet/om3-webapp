import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AiAgentError, createAiAgentClient, parseFeedback} from '../ai-agent.js';

const baseUrl = 'https://agent.example.com:8090';
const path = `${baseUrl}/v1/om3/conversations/conversation-1/turns/turn-1/feedback`;
const answer = {
    id: 'turn-1:4',
    turn_id: 'turn-1',
    role: 'assistant',
    text: 'Answer',
    created_at: '2026-10-05T12:00:01Z',
};
describe('parseFeedback', () => {
    it('normalizes the reasons order and the expected text', () => {
        expect(
            parseFeedback({rating: 'down', reasons: ['action_not_done', 'not_answered'], expected: '  per OS\n '})
        ).toEqual({rating: 'down', reasons: ['not_answered', 'action_not_done'], expected: 'per OS'});
        expect(parseFeedback({rating: 'up'})).toEqual({rating: 'up', reasons: [], expected: ''});
    });
    it.each([
        null,
        {},
        {rating: 'meh'},
        {rating: 'up', reasons: ['not_answered']},
        {rating: 'down', reasons: ['unknown']},
        {rating: 'down', reasons: ['not_answered', 'not_answered']},
        {rating: 'down', reasons: 'not_answered'},
        {rating: 'down', expected: 'é'.repeat(1001)},
        {rating: 'down', expected: 'bell\u0007'},
        {rating: 'down', expected: 3},
    ])('refuses %j', (value) => {
        expect(parseFeedback(value)).toBeNull();
    });
    it('accepts an expected text of exactly 1000 characters', () => {
        expect(parseFeedback({rating: 'down', expected: '😀'.repeat(1000)})).not.toBeNull();
    });
});

describe('AI agent feedback client', () => {
    let client, fetchMock;
    beforeEach(() => {
        client = createAiAgentClient({baseUrl, getCredentials: () => ({accessToken: 'token', clusterId: 'cluster-id'})});
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        client.cancelAll();
        vi.unstubAllGlobals();
    });

    it('puts the normalized feedback and returns the stored one', async () => {
        const stored = {rating: 'down', reasons: ['missing_information'], expected: 'per OS'};
        fetchMock.mockResolvedValueOnce(Response.json({feedback: stored, created_at: '2026-10-15T10:00:00Z', updated_at: '2026-10-15T10:00:00Z'}));
        expect(await client.setFeedback('conversation-1', 'turn-1', {rating: 'down', reasons: ['missing_information'], expected: ' per OS '})).toEqual(stored);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe(path);
        expect(options).toMatchObject({
            method: 'PUT',
            credentials: 'omit',
            headers: {'Content-Type': 'application/json', Authorization: 'Bearer token', 'X-OpenSVC-Cluster-ID': 'cluster-id'},
        });
        expect(JSON.parse(options.body)).toEqual(stored);
    });
    it('refuses an invalid feedback or turn without any request', () => {
        expect(() => client.setFeedback('conversation-1', 'turn-1', {rating: 'up', reasons: ['not_answered']})).toThrow(AiAgentError);
        expect(() => client.setFeedback('conversation-1', '../x', {rating: 'up'})).toThrow(AiAgentError);
        expect(() => client.deleteFeedback('conversation-1', '')).toThrow(AiAgentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('rejects an invalid stored feedback', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({feedback: {rating: 'maybe'}}));
        await expect(client.setFeedback('conversation-1', 'turn-1', {rating: 'up'})).rejects.toMatchObject({code: 'invalid_response'});
    });
    it.each([
        [400, 'The feedback is invalid.'],
        [404, 'This answer can no longer be rated.'],
        [409, 'The agent keeps no more feedback for now.'],
        [410, 'Conversation expired.'],
    ])('explains HTTP %i', async (status, message) => {
        fetchMock.mockResolvedValueOnce(Response.json({error: {code: 'x', message: 'secret upstream'}}, {status}));
        await expect(client.setFeedback('conversation-1', 'turn-1', {rating: 'up'})).rejects.toMatchObject({status, message});
    });
    it('deletes the feedback and requires 204', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, {status: 204})).mockResolvedValueOnce(Response.json({}));
        await expect(client.deleteFeedback('conversation-1', 'turn-1')).resolves.toBeUndefined();
        expect(fetchMock.mock.calls[0][0]).toBe(path);
        expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
        await expect(client.deleteFeedback('conversation-1', 'turn-1')).rejects.toMatchObject({code: 'invalid_response'});
    });
    it('keeps the feedback of assistant messages and refuses it elsewhere', async () => {
        const feedback = {rating: 'down', reasons: ['not_answered'], expected: ''};
        fetchMock
            .mockResolvedValueOnce(Response.json({messages: [{...answer, feedback}], next_cursor: ''}))
            .mockResolvedValueOnce(Response.json({messages: [{...answer, role: 'user', feedback}], next_cursor: ''}))
            .mockResolvedValueOnce(Response.json({messages: [{...answer, feedback: {rating: 'bad'}}], next_cursor: ''}))
            .mockResolvedValueOnce(Response.json({messages: [answer], next_cursor: ''}));
        expect((await client.getMessages('conversation-1')).messages[0].feedback).toEqual(feedback);
        await expect(client.getMessages('conversation-1')).rejects.toMatchObject({code: 'invalid_response'});
        await expect(client.getMessages('conversation-1')).rejects.toMatchObject({code: 'invalid_response'});
        expect((await client.getMessages('conversation-1')).messages[0]).not.toHaveProperty('feedback');
    });
});
