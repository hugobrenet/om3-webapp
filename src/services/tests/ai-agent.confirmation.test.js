import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAiAgentClient} from '../ai-agent.js';

const baseUrl = 'https://agent.example.com:8090';
const confirmation = {
    id: 'confirmation-1',
    turn_id: 'turn-1',
    tool: {name: 'stop_object', title: 'Stop object', destructive: true},
    arguments: {path: 'prod/svc/web'},
    expires_at: '2026-10-09T17:45:00Z',
};

// A confirmation left waiting is read with the conversation, after a reload:
// the runs give it with their interrupt (ai-agent.runs.test.js).
describe('AI agent pending confirmation', () => {
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
    const read = (pending) => {
        fetchMock.mockResolvedValueOnce(Response.json({conversation: {id: 'conversation-1'}, pending_confirmation: pending}));
        return client.getConversationState('conversation-1');
    };

    it('reads the confirmation a conversation waits on, with the types of its arguments', async () => {
        expect(await read({...confirmation, argument_types: {yaml: 'application/yaml'}})).toEqual({
            conversation: {id: 'conversation-1'},
            confirmation: {...confirmation, argument_types: {yaml: 'application/yaml'}, editable: false},
        });
        expect((await read(confirmation)).confirmation.argument_types).toEqual({});
        // An editable call carries the input schema of its tool.
        const inputSchema = {type: 'object', properties: {path: {type: 'string'}}};
        expect((await read({...confirmation, editable: true, input_schema: inputSchema})).confirmation).toMatchObject({
            editable: true,
            input_schema: inputSchema,
        });
        fetchMock.mockResolvedValueOnce(Response.json({conversation: {id: 'conversation-1'}}));
        expect(await client.getConversationState('conversation-1')).toEqual({
            conversation: {id: 'conversation-1'},
            confirmation: null,
        });
    });

    it.each([
        {...confirmation, id: 'bad id'},
        {...confirmation, tool: {...confirmation.tool, destructive: 'yes'}},
        {...confirmation, arguments: ['prod/svc/web']},
        {...confirmation, expires_at: 'tomorrow'},
        {...confirmation, argument_types: ['yaml']},
        {...confirmation, argument_types: {yaml: 42}},
        {...confirmation, argument_types: {yaml: 'application/yaml\n'}},
        {...confirmation, editable: 'yes'},
        {...confirmation, editable: true},
        {...confirmation, editable: true, input_schema: {type: 'string'}},
        {...confirmation, editable: true, input_schema: {type: 'object', description: 'x'.repeat(64 * 1024)}},
        {...confirmation, argument_types: Object.fromEntries(Array.from({length: 33}, (_, index) => [`a${index}`, 'text/plain']))},
    ])('rejects a malformed confirmation %#', async (pending) => {
        await expect(read(pending)).rejects.toMatchObject({code: 'invalid_response'});
    });
});
