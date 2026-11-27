import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AiAgentError, MAX_SKILLS, createAiAgentClient, isSkillName, parseSkills} from '../ai-agent.js';
import {GOLDEN_THREAD, goldenResponse} from './agui-fixtures.js';

const baseUrl = 'https://agent.example.com:8090';
const morning = {name: 'morning-check', description: 'Check the cluster in the morning.'};
const maintenance = {name: 'node-maintenance', description: 'Reboot a node.'};

describe('parseSkills', () => {
    it('reads the skills, in the order of the agent', () => {
        expect(parseSkills({skills: [morning, {...maintenance, extra: 1}]})).toEqual([morning, maintenance]);
        expect(parseSkills({skills: []})).toEqual([]);
    });
    it.each([
        ['no object', null],
        ['no list', {skills: {}}],
        ['too many', {skills: Array.from({length: MAX_SKILLS + 1}, (_, i) => ({name: `s${i}`, description: ''}))}],
        ['a repeated name', {skills: [morning, {...maintenance, name: 'morning-check'}]}],
        ['a name not shaped as one', {skills: [{...morning, name: 'Morning Check'}]}],
        ['a long description', {skills: [{...morning, description: 'é'.repeat(151)}]}],
        ['no description', {skills: [{name: 'morning-check'}]}],
    ])('refuses %s', (_name, value) => {
        expect(() => parseSkills(value)).toThrow(AiAgentError);
    });
    it('takes the names the agent takes', () => {
        expect(['a', 'node-maintenance', 'x'.repeat(64)].every(isSkillName)).toBe(true);
        expect(['', '-a', 'a-', 'A', 'a_b', 'a b', '/etc', 'x'.repeat(65), 7, null].some(isSkillName)).toBe(false);
    });
});

describe('AI agent skills client', () => {
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

    it('lists the skills of the agent', async () => {
        fetchMock.mockResolvedValueOnce(Response.json({skills: [morning, maintenance]}));
        await expect(client.listSkills()).resolves.toEqual([morning, maintenance]);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe(`${baseUrl}/v1/om3/skills`);
        expect(options).toMatchObject({method: 'GET', credentials: 'omit', headers: {Authorization: 'Bearer token', 'X-OpenSVC-Cluster-ID': 'cluster-id'}});
        fetchMock.mockResolvedValueOnce(Response.json({error: {code: 'skills_unavailable', message: 'raw'}}, {status: 502}));
        await expect(client.listSkills()).rejects.toMatchObject({code: 'skills_unavailable', message: 'The agent could not read its procedures.'});
    });
    it('sends the skill of a new prompt in the forwarded properties, with its model', async () => {
        fetchMock.mockResolvedValueOnce(goldenResponse('skill_asked'));
        await client.run(GOLDEN_THREAD, {prompt: '/morning-check', promptId: 'u-s', model: 'luna', skill: 'morning-check'}, {onEvent: () => {}});
        expect(sent().forwardedProps).toEqual({model: 'luna', skill: 'morning-check'});
        expect(sent().messages.at(-1)).toEqual({id: 'u-s', role: 'user', content: '/morning-check'});
    });
    it('sends no skill with the answer to a confirmation', async () => {
        fetchMock.mockResolvedValueOnce(goldenResponse('text_and_tools'));
        await client.run(GOLDEN_THREAD, {resume: {interruptId: 'confirmation-1', approved: false}, skill: 'morning-check'}, {onEvent: () => {}}).catch(() => {});
        expect(sent().forwardedProps).toEqual({});
    });
    it('refuses a skill not shaped as one without any request', () => {
        for (const skill of ['', 'Morning', '/morning-check', 'x'.repeat(65), 7, null]) {
            expect(() => client.run(GOLDEN_THREAD, {prompt: 'hi', promptId: 'u-1', skill})).toThrow(AiAgentError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('replays the load of the skill asked as a step, and explains a skill unavailable by its code', async () => {
        const events = [];
        fetchMock.mockResolvedValueOnce(goldenResponse('skill_asked'));
        await client.run(GOLDEN_THREAD, {prompt: '/morning-check', promptId: 'u-s', skill: 'morning-check'}, {onEvent: (event) => events.push(event)});
        expect(events.find((event) => event.type === 'TOOL_CALL_START')).toMatchObject({toolCallName: 'load_skill', parentMessageId: 'turn-s:2'});
        fetchMock.mockResolvedValueOnce(goldenResponse('skill_unavailable'));
        await expect(client.run(GOLDEN_THREAD, {prompt: '/morning-check', promptId: 'u-u', skill: 'morning-check'}, {onEvent: () => {}})).rejects.toMatchObject({
            code: 'skill_unavailable',
            message: 'This procedure is not available to you now: choose another, or send your message without it.',
        });
    });
});
