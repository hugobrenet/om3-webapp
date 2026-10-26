import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiChat from '../AiChat.jsx';
import {formatDuration} from '../AiSteps.jsx';
import {GOLDEN_RUN, GOLDEN_THREAD, replayEvents} from '../../services/tests/agui-fixtures.js';

const mocks = vi.hoisted(() => ({auth: null, client: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', fetchNodes: vi.fn(), loading: false, error: ''}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({client: mocks.client, enabled: true, ready: true, configurationError: null}),
}));

const T0 = 1_000_000;
const T1 = 9_000_000;
const run = {threadId: GOLDEN_THREAD, runId: GOLDEN_RUN};
const call = (id, name, args, at, parent = 'turn-s:2') => [
    {type: 'TOOL_CALL_START', toolCallId: id, toolCallName: name, parentMessageId: parent, timestamp: at},
    {type: 'TOOL_CALL_ARGS', toolCallId: id, delta: JSON.stringify(args), timestamp: at},
    {type: 'TOOL_CALL_END', toolCallId: id, timestamp: at},
];
const result = (id, payload, at) => ({type: 'TOOL_CALL_RESULT', messageId: `${id}-result`, toolCallId: id, role: 'tool', content: JSON.stringify(payload), timestamp: at});
const text = (id, delta, at) => [
    {type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant', timestamp: at},
    {type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta, timestamp: at},
    {type: 'TEXT_MESSAGE_END', messageId: id, timestamp: at},
];
const big = 'x'.repeat(5000);

// A turn as the agent streams it, on its clock: a search, two reads that
// overlap, a refusal of the MCP, a refusal of an older agent without isError,
// a result past 4 KB, then an action the user rejects.
const firstRun = [
    {type: 'RUN_STARTED', ...run, timestamp: T0},
    ...call('call-0', 'search_tools', {query: 'verrous'}, T0 + 100),
    result('call-0', {content: [{type: 'text', text: 'list_cluster_locks'}]}, T0 + 150),
    ...call('call-1', 'get_object_status', {path: 'test/svc/web'}, T0 + 400),
    ...call('call-2', 'get_node_status', {node: 'dev5n9'}, T0 + 410),
    result('call-1', {content: [], structuredContent: {avail: 'up'}}, T0 + 700),
    result('call-2', {content: [], structuredContent: {state: 'up'}}, T0 + 800),
    ...call('call-3', 'get_instance_status', {path: 'test/svc/web', node: 'dev5n1'}, T0 + 1000),
    result('call-3', {content: [{type: 'text', text: 'instance test/svc/web on dev5n1: not found'}], isError: true}, T0 + 1100),
    ...call('call-4', 'list_cluster_locks', {}, T0 + 1200),
    result('call-4', {content: [{type: 'text', text: 'refused by an older agent'}]}, T0 + 1300),
    ...call('call-5', 'get_cluster_status', {}, T0 + 1400),
    result('call-5', {content: [], structuredContent: {note: big}}, T0 + 1500),
    ...text('turn-s:2', 'I will stop `test/svc/web`, not `test/svc/ghost`.', T0 + 1800),
    ...call('call-6', 'stop_instance', {path: 'test/svc/web', node: 'dev5n1'}, T0 + 2000),
    {
        type: 'RUN_FINISHED', ...run, timestamp: T0 + 2500,
        outcome: {type: 'interrupt', interrupts: [{
            id: 'confirmation-s', reason: 'tool_call', toolCallId: 'call-6', message: 'Confirm',
            responseSchema: {type: 'object', properties: {approved: {type: 'boolean'}}, required: ['approved']},
            expiresAt: '2026-10-26T17:45:00Z',
            metadata: {turnId: 'turn-s', tool: {name: 'stop_instance', title: 'Stop instance', destructive: true}, editable: false},
        }]},
    },
];
const secondRun = [
    {type: 'RUN_STARTED', ...run, timestamp: T1},
    result('call-6', {rejected: true, message: 'the user rejected this action; it did not run'}, T1 + 10),
    ...text('turn-s:4', 'Not stopped.', T1 + 300),
    {type: 'RUN_FINISHED', ...run, timestamp: T1 + 500, outcome: {type: 'success'}, result: {turnId: 'turn-s'}},
];

const status = {
    objects: {'test/svc/web': {avail: 'up', overall: 'up'}},
    nodeStatus: {dev5n1: {frozen_at: '0001-01-01T00:00:00Z'}},
};

describe('the steps of an answer', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: ''}),
            getConversation: vi.fn().mockResolvedValue({id: 'new', title: 'Stop web'}),
            getConversationState: vi.fn(),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(),
        };
    });
    const ask = async (prompt) => {
        const view = render(
            <MemoryRouter>
                <AiChat status={status}/>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: prompt}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        return view;
    };
    const answer = () => screen.getByText('Not stopped.').closest('li');
    const step = (sentence) => within(answer()).getByRole('button', {name: sentence}).closest('li');

    test('tells each step of the turn, in order, with the times of the agent', async () => {
        mocks.client.run.mockImplementationOnce(replayEvents(firstRun)).mockImplementationOnce(replayEvents(secondRun));
        const {container} = await ask('Stop web on dev5n1');
        const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
        await waitFor(() => expect(within(card).getByRole('button', {name: 'Reject'})).toBeEnabled());
        fireEvent.click(within(card).getByRole('button', {name: 'Reject'}));
        await screen.findByText('Not stopped.');

        // Folded: the steps and the duration of the runs, the wait for the decision left out.
        const summary = within(answer()).getByRole('button', {name: '7 steps · 3 s'});
        expect(summary).toHaveAttribute('aria-expanded', 'false');
        expect(within(answer()).getByText('3 s · 7 steps · 1 action rejected by you')).toBeInTheDocument();
        fireEvent.click(summary);
        const list = within(answer()).getByRole('list', {name: 'Steps of the answer'});
        expect(within(list).getAllByRole('button', {expanded: false}).map((button) => button.textContent)).toEqual([
            'Search the tools: “verrous”',
            'Read the status of test/svc/web',
            'Read the status of dev5n9',
            'Read the status of test/svc/web on dev5n1',
            'Read the locks of the cluster',
            'Read the cluster status',
            'Stop test/svc/web on dev5n1',
        ]);
        // The time of the model between steps, the reads that overlap said so.
        expect(within(list).getAllByText(/^model /).map((line) => line.textContent)).toEqual([
            'model 100 ms',
            'model 250 ms',
            'model 200 ms',
            'model 100 ms',
            'model 100 ms',
        ]);
        expect(step('Read the status of test/svc/web')).toHaveTextContent(/done.*300 ms/);
        expect(step('Read the status of dev5n9')).toHaveTextContent(/in parallel.*390 ms/);
        // A refusal of the MCP, by isError; one of an older agent, by its missing structured content.
        expect(step('Read the status of test/svc/web on dev5n1')).toHaveTextContent('refused by the tool');
        expect(step('Read the locks of the cluster')).toHaveTextContent('refused by the tool');
        // The agent tools are steps too, greyed.
        expect(step('Search the tools: “verrous”')).toHaveClass('text-ink-muted');
        // The action the user rejected did not run: no duration; a read of a
        // few milliseconds says them, not 0 s.
        expect(step('Stop test/svc/web on dev5n1')).toHaveTextContent('rejected by you');
        expect(step('Stop test/svc/web on dev5n1')).not.toHaveTextContent(/\d ms|\d s/);
        expect(step('Search the tools: “verrous”')).toHaveTextContent(/50 ms/);

        // Badges for what the cluster holds; a node it does not hold stays text.
        expect(within(step('Read the status of test/svc/web')).getByRole('button', {name: /^up\s*test\/svc\/web$/})).toBeInTheDocument();
        expect(within(step('Read the status of dev5n9')).queryByRole('button', {name: 'dev5n9'})).not.toBeInTheDocument();
        expect(within(step('Read the status of dev5n9')).getByText('dev5n9')).toHaveProperty('tagName', 'CODE');
        expect(within(step('Read the status of test/svc/web on dev5n1')).getByRole('button', {name: 'dev5n1'})).toBeInTheDocument();
        // In the text, a path the cluster holds is a badge, another stays code.
        const first = screen.getByText(/I will stop/).closest('p');
        expect(within(first).getByRole('button', {name: /^up\s*test\/svc\/web$/})).toBeInTheDocument();
        expect(within(first).getByText('test/svc/ghost')).toHaveProperty('tagName', 'CODE');

        // The details: the refusal whole, before the excerpt.
        fireEvent.click(within(list).getByRole('button', {name: 'Read the status of test/svc/web on dev5n1'}));
        const refused = step('Read the status of test/svc/web on dev5n1');
        const refusal = within(refused).getByText('instance test/svc/web on dev5n1: not found');
        const excerpt = within(refused).getByText(/"isError":true/);
        expect(refusal.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(within(refused).getByLabelText('Arguments')).toHaveTextContent('"node": "dev5n1"');
        // An excerpt is bounded at reading, said so.
        fireEvent.click(within(list).getByRole('button', {name: 'Read the cluster status'}));
        const bounded = step('Read the cluster status');
        expect(within(bounded).getByText('Result, its first 4 KB:')).toBeInTheDocument();
        expect(within(bounded).getByText(/xxxx/).textContent).toHaveLength(4096);

        expect((await axe(container)).violations).toHaveLength(0);
    });

    test('counts the time of a running turn live, and tells an interrupted step', async () => {
        mocks.client.run.mockImplementation(
            (_id, _input, {signal, onEvent}) =>
                new Promise((_resolve, reject) => {
                    onEvent({type: 'RUN_STARTED', at: T0});
                    onEvent({type: 'TOOL_CALL_START', toolCallId: 'call-1', toolCallName: 'get_cluster_status', parentMessageId: 'turn-s:2', at: T0 + 10});
                    signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), {once: true});
                })
        );
        await ask('How is the cluster?');
        const live = await screen.findByRole('button', {name: /^Running · 00:0\d$/});
        // The step running, under the folded summary.
        expect(screen.getAllByText('Read the cluster status')[0]).toBeVisible();
        fireEvent.click(screen.getByRole('button', {name: 'Stop'}));
        await screen.findByText(/Incomplete response — stopped/);
        expect(live).not.toHaveTextContent(/Running/);
        fireEvent.click(screen.getByRole('button', {name: /^1 step · /}));
        expect(screen.getByRole('button', {name: 'Read the cluster status'}).closest('li')).toHaveTextContent('interrupted');
    });
});

describe('the steps of a thread given again', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([]),
            createConversation: vi.fn().mockResolvedValue({id: 'new', title: ''}),
            getConversation: vi.fn().mockResolvedValue({id: 'new', title: 'Nodes'}),
            getConversationState: vi.fn(),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(),
        };
    });
    const ask = async (prompt) => {
        render(
            <MemoryRouter>
                <AiChat status={status}/>
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: prompt}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
    };

    test('tells a result the compaction of the history cut as done, not refused', async () => {
        mocks.client.run.mockImplementationOnce(replayEvents([
            {type: 'RUN_STARTED', ...run, timestamp: T0},
            {type: 'MESSAGES_SNAPSHOT', messages: [
                {id: 'u-1', role: 'user', content: 'How many nodes?'},
                {id: 'turn-1:2', role: 'assistant', content: '', toolCalls: [{id: 'call-1', type: 'function', function: {name: 'get_cluster_status', arguments: '{}'}}]},
                {id: 'call-1-result', role: 'tool', toolCallId: 'call-1', content: JSON.stringify({content: [], _history_compaction: {omitted: ['structuredContent']}})},
                {id: 'turn-1:4', role: 'assistant', content: 'Two nodes.'},
                {id: 'u-2', role: 'user', content: 'And now?'},
            ]},
            ...text('turn-2:2', 'Still two.', T0 + 100),
            {type: 'RUN_FINISHED', ...run, timestamp: T0 + 200, outcome: {type: 'success'}, result: {turnId: 'turn-2'}},
        ]));
        await ask('And now?');
        const earlier = (await screen.findByText('Two nodes.')).closest('li');
        fireEvent.click(within(earlier).getByRole('button', {name: /^1 step · /}));
        const read = within(earlier).getByRole('button', {name: 'Read the cluster status'}).closest('li');
        expect(read).toHaveTextContent('done');
        expect(read).not.toHaveTextContent('Refused by the tool');
    });

    test('shows the answer waits for the agent before the run starts', async () => {
        mocks.client.run.mockImplementation(() => new Promise(() => {}));
        await ask('Hello');
        expect(await screen.findByText('Waiting for the agent…')).toBeInTheDocument();
    });
});

describe('formatDuration', () => {
    test.each([
        [4, 'en', '4 ms'],
        [400, 'en', '400 ms'],
        [1240, 'en', '1.2 s'],
        [12345, 'en', '12 s'],
        [65000, 'en', '1 min 05 s'],
        [2500, 'fr', '2,5 s'],
    ])('%i ms in %s is %s', (ms, language, text) => {
        expect(formatDuration(ms, language)).toBe(text);
    });
});
