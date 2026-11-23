import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AiAgentError, MAX_MODELS, createAiAgentClient, parseModels} from '../ai-agent.js';
import {GOLDEN_THREAD, goldenResponse} from './agui-fixtures.js';

const baseUrl = 'https://agent.example.com:8090';
const haiku = {id: 'default', label: 'Claude Haiku', default: true, ready: true};
const luna = {id: 'luna', label: 'GPT Luna', default: false, ready: true};

describe('parseModels', () => {
    it('reads the models, the default first', () => {
        expect(parseModels({models: [haiku, {...luna, extra: 1}]})).toEqual([haiku, luna]);
        expect(parseModels({models: [haiku]})).toEqual([haiku]);
    });
    it.each([
        ['no object', null],
        ['no list', {models: {}}],
        ['an empty list', {models: []}],
        ['too many', {models: Array.from({length: MAX_MODELS + 1}, (_, i) => ({...luna, id: `m${i}`, default: i === 0}))}],
        ['a repeated ID', {models: [haiku, {...luna, id: 'default'}]}],
        ['an empty ID', {models: [haiku, {...luna, id: ''}]}],
        ['a long ID', {models: [haiku, {...luna, id: 'x'.repeat(65)}]}],
        ['an empty label', {models: [haiku, {...luna, label: ' '}]}],
        ['a long label', {models: [haiku, {...luna, label: 'é'.repeat(65)}]}],
        ['no default', {models: [{...haiku, default: false}, luna]}],
        ['two defaults', {models: [haiku, {...luna, default: true}]}],
        ['a ready string', {models: [haiku, {...luna, ready: 'true'}]}],
    ])('refuses %s', (_name, value) => {
        expect(() => parseModels(value)).toThrow(AiAgentError);
    });
});

describe('AI agent models client', () => {
    let client, fetchMock;
    beforeEach(() => {
        client = createAiAgentClient({baseUrl, getCredentials: () => ({accessToken: 'token', clusterId: 'cluster-id'}), newId: () => 'run-1'});
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
        client.cancelAll();
        vi.unstubAllGlobals();
    });
    const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body);

    it('lists the models of the agent', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({models: [haiku, luna]}));
        await expect(client.listModels()).resolves.toEqual([haiku, luna]);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe(`${baseUrl}/v1/om3/models`);
        expect(options).toMatchObject({method: 'GET', credentials: 'omit', headers: {Authorization: 'Bearer token', 'X-OpenSVC-Cluster-ID': 'cluster-id'}});
        fetchMock.mockResolvedValueOnce(Response.json({models: []}));
        await expect(client.listModels()).rejects.toMatchObject({code: 'invalid_response'});
    });
    it('sends the model of a new prompt in the forwarded properties', async () => {
        fetchMock.mockResolvedValueOnce(goldenResponse('text_and_tools'));
        await client.run(GOLDEN_THREAD, {prompt: 'How many nodes?', promptId: 'u-1', model: 'luna'}, {onEvent: () => {}});
        expect(sent().forwardedProps).toEqual({model: 'luna'});
    });
    it('sends no model when none is chosen', async () => {
        fetchMock.mockResolvedValueOnce(goldenResponse('text_and_tools'));
        await client.run(GOLDEN_THREAD, {prompt: 'How many nodes?', promptId: 'u-1'}, {onEvent: () => {}});
        expect(sent().forwardedProps).toEqual({});
    });
    it('sends no model with the answer to a confirmation: the turn keeps its own', async () => {
        fetchMock.mockResolvedValueOnce(goldenResponse('text_and_tools'));
        await client.run(GOLDEN_THREAD, {resume: {interruptId: 'confirmation-1', approved: false}, model: 'luna'}, {onEvent: () => {}}).catch(() => {});
        expect(sent().forwardedProps).toEqual({});
        expect(sent().resume).toBeDefined();
    });
    it('refuses an invalid model without any request', () => {
        for (const model of ['', 'x'.repeat(65), 7, null]) {
            expect(() => client.run(GOLDEN_THREAD, {prompt: 'hi', promptId: 'u-1', model})).toThrow(AiAgentError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('explains a model the agent no longer offers by its code', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({error: {code: 'model_unknown', message: 'raw'}}, {status: 400}));
        await expect(client.run(GOLDEN_THREAD, {prompt: 'hi', promptId: 'u-1', model: 'gone'}, {onEvent: () => {}})).rejects.toMatchObject({
            code: 'model_unknown',
            status: 400,
            message: 'This model is no longer available: the default model is selected. Send your message again.',
        });
    });
    it('reads the model of a turn on its last answer of the history', async () => {
        const page = (extra) => ({
            messages: [
                {id: 'turn-1:1', turn_id: 'turn-1', role: 'user', text: 'Q', created_at: '2026-10-05T12:00:00Z'},
                {id: 'turn-1:2', turn_id: 'turn-1', role: 'assistant', text: 'A', created_at: '2026-10-05T12:00:01Z', ...extra},
            ],
            next_cursor: '',
        });
        fetchMock.mockResolvedValueOnce(Response.json(page({model_id: 'luna'})));
        const {messages} = await client.getMessages('conversation-1');
        expect(messages[1].model_id).toBe('luna');
        expect(messages[0]).not.toHaveProperty('model_id');
        fetchMock.mockResolvedValueOnce(Response.json(page({model_id: 7})));
        await expect(client.getMessages('conversation-1')).rejects.toMatchObject({code: 'invalid_response'});
    });
});
