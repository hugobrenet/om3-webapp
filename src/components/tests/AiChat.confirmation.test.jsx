import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiChat from '../AiChat.jsx';
import i18n from '../../i18n';
import {replayRun} from '../../services/tests/agui-fixtures.js';
import {parseConfirmation} from '../../services/ai-agent.js';

const mocks = vi.hoisted(() => ({auth: null, client: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuth: () => mocks.auth}));
vi.mock('../../hooks/useFetchDaemonStatus.jsx', () => ({
    default: () => ({clusterId: 'cluster-id', clusterName: 'Lab cluster', fetchNodes: vi.fn(), loading: false, error: ''}),
}));
vi.mock('../../hooks/useAiAgent.js', () => ({
    default: () => ({client: mocks.client, enabled: true, ready: true, configurationError: null}),
}));

const existing = {id: 'existing', title: 'Previous diagnostic'};
const created = {id: 'new', title: 'New diagnostic'};

// A confirmation as the conversation read gives it after a reload, read by
// the client.
const pendingConfirmation = (fields = {}) => parseConfirmation({
    id: 'confirmation-1',
    turn_id: 'turn-1',
    tool: {name: 'stop_instance', title: 'Stop instance', destructive: true},
    arguments: {path: 'test/svc/web', node: 'dev5n1'},
    argument_types: {},
    editable: false,
    expires_at: '2026-10-26T17:45:00Z',
    ...fields,
});

describe('the confirmation card', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'hugo'};
        mocks.client = {
            listConversations: vi.fn().mockResolvedValue([existing]),
            createConversation: vi.fn().mockResolvedValue(created),
            getConversation: vi.fn().mockResolvedValue(existing),
            getConversationState: vi.fn().mockResolvedValue({conversation: existing, confirmation: null}),
            getMessages: vi.fn().mockResolvedValue({messages: [], next_cursor: ''}),
            newId: vi.fn(() => 'prompt-1'),
            run: vi.fn(),
        };
    });
    const ask = async (prompt) => {
        render(<AiChat/>);
        await waitFor(() => expect(screen.getByRole('button', {name: 'New conversation'})).toBeEnabled());
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: prompt}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));
        const card = await screen.findByRole('region', {name: 'Action waiting for confirmation'});
        // The card shows before the run ends: its buttons wait for the end.
        await waitFor(() => expect(within(card).getByRole('button', {name: 'Reject'})).toBeEnabled());
        return card;
    };
    const reload = async (confirmation, region = 'Action waiting for confirmation') => {
        mocks.client.getConversationState.mockResolvedValue({conversation: existing, confirmation});
        render(<AiChat/>);
        await waitFor(() => expect(screen.getByRole('button', {name: 'Previous diagnostic'})).toBeEnabled());
        fireEvent.click(screen.getByRole('button', {name: 'Previous diagnostic'}));
        return screen.findByRole('region', {name: region});
    };

    test('says an action in one sentence, its resources included, and approves it with the delete look', async () => {
        mocks.client.run.mockImplementationOnce(replayRun('confirmation_preview_action'));
        const card = await ask('Stop fs#1 of web on dev5n1');
        expect(within(card).getByText('Stop test/svc/web on dev5n1 (fs#1)')).toBeInTheDocument();
        expect(within(card).queryByRole('table')).not.toBeInTheDocument();
        expect(within(card).getByText(/The daemon may still refuse the call/)).toBeInTheDocument();
        expect(within(card).getByRole('button', {name: 'Approve'})).toHaveClass('bg-state-down');
        expect(within(card).getByRole('button', {name: 'Reject'})).toHaveClass('border-line');
    });

    test('shows the keys a configuration update changes, the sections it deletes and hides the secrets', async () => {
        mocks.client.run.mockImplementationOnce(replayRun('confirmation_preview_config'));
        const card = await ask('Add b to env.list of web');
        expect(within(card).getByText('Update the configuration of test/svc/web: 2 set, 1 unset, 1 sections deleted')).toBeInTheDocument();
        const rows = within(within(card).getByRole('table')).getAllByRole('row');
        expect(within(rows[0]).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Key', 'Current value', 'Operation', 'Proposed value*']);
        const row = (key) => rows.find((item) => within(item).queryByRole('rowheader')?.textContent.startsWith(key));
        expect(within(row('env.list')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['a', 'append b', 'a b']);
        expect(row('env.absent')).toHaveTextContent('not set');
        expect(within(row('env.absent')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['empty', 'unset', 'empty']);
        expect(within(row('cluster.secret')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['hidden', 'set to', 'hidden']);
        expect(within(row('cluster.secret')).getByRole('rowheader')).toHaveTextContent('cluster.secretsecret: values not shown');
        expect(within(card).getByText('Deletes the section fs#2 and its 2 keys:')).toBeInTheDocument();
        expect(within(within(card).getByRole('list', {name: 'fs#2'})).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['fs#2.dev', 'fs#2.type']);
        expect(within(card).getByText('1 change on a secret key: its values are not shown.')).toBeInTheDocument();
        expect(within(card).getByText(/Current values read at/)).toBeInTheDocument();
        // The arguments stay at hand, folded.
        expect(within(card).getByText('Arguments of the call').closest('details')).not.toHaveAttribute('open');
        expect((await axe(card)).violations).toHaveLength(0);
    });

    test('numbers the lines of the file a creation writes, without current values', async () => {
        mocks.client.run.mockImplementationOnce(replayRun('confirmation_preview_create'));
        const card = await ask('Create new with a flag');
        expect(within(card).getByText('Create test/svc/new, a svc of 2 sections')).toBeInTheDocument();
        const file = within(card).getByRole('group', {name: 'Configuration file'});
        expect(within(file).getAllByTestId('config-line-number').map((cell) => cell.textContent).slice(0, 5)).toEqual(['1', '2', '3', '4', '5']);
        expect(file).toHaveTextContent('[fs#1]');
        expect(within(card).queryByRole('columnheader', {name: 'Current value'})).not.toBeInTheDocument();
        expect(within(card).getByRole('row', {name: /env\.a/})).toHaveTextContent('applied after the configuration file');
    });

    test('says the notes in the language of the page by their keys, and an unknown one as the MCP wrote it', async () => {
        await i18n.changeLanguage('fr');
        try {
            const card = await reload(pendingConfirmation({
                tool: {name: 'update_object_config', title: 'Update', destructive: true},
                preview: {
                    summary: {text: 'Update', key: 'config_update', params: {path: 'web', sets: '2', unsets: '0', deletes: '1'}},
                    changes: [
                        {key: 'cluster.secret', op: '=', after_computed_by_mcp: false, note: 'secret: values not shown', note_keys: ['secret']},
                        {key: 'env.a', op: '=', value: '1', before: '', after: '1', after_computed_by_mcp: true, note: 'a new note', note_keys: ['new_note']},
                    ],
                    deleted: [{section: 'cluster', keys: ['cluster.name'], secrets_omitted: 1}],
                },
            }), 'Action en attente de confirmation');
            expect(within(card).getByRole('rowheader', {name: /cluster\.secret/})).toHaveTextContent('secret : valeurs non affichées');
            expect(within(card).getByRole('rowheader', {name: /env\.a/})).toHaveTextContent('a new note');
            expect(within(card).getByText('et 1 clé secrète, non nommée.')).toBeInTheDocument();
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('shows the arguments, and why, when the preview failed', async () => {
        mocks.client.run.mockImplementationOnce(replayRun('confirmation_preview_error'));
        const card = await ask('Set env.a of web');
        expect(within(card).getByText(/No preview: the preview was refused/)).toBeInTheDocument();
        expect(within(card).getByText('Arguments of the call').closest('details')).toHaveAttribute('open');
        expect(within(card).getByText('test/svc/web')).toHaveProperty('tagName', 'CODE');
    });

    test('recomputes the preview for edited arguments, nothing running', async () => {
        mocks.client.run.mockImplementationOnce(replayRun('confirmation_preview_config')).mockImplementationOnce(replayRun('resume_preview'));
        const card = await ask('Add b to env.list of web');
        fireEvent.click(within(card).getByRole('button', {name: 'Edit'}));
        expect(within(card).queryByRole('button', {name: 'Recompute the preview'})).not.toBeInTheDocument();
        fireEvent.change(within(card).getByRole('textbox', {name: /path/}), {target: {value: 'test/svc/api'}});
        expect(within(card).getByText(/The preview is of the arguments before your changes/)).toBeInTheDocument();
        fireEvent.click(within(card).getByRole('button', {name: 'Recompute the preview'}));
        await waitFor(() => expect(mocks.client.run).toHaveBeenCalledTimes(2));
        expect(mocks.client.run).toHaveBeenLastCalledWith(
            'new',
            expect.objectContaining({
                resume: expect.objectContaining({interruptId: 'confirmation-u', preview: true, editedArgs: expect.objectContaining({path: 'test/svc/api'})}),
            }),
            expect.anything()
        );
        // The call waits again, under the new interrupt, with the preview of the edit.
        const again = await screen.findByText('Update api');
        const region = again.closest('section');
        expect(within(region).getByText('The preview is of your edited arguments.')).toBeInTheDocument();
        expect(within(region).getByRole('textbox', {name: /path/})).toHaveValue('api');
        expect(within(region).getByRole('button', {name: 'Approve with my changes'})).toBeEnabled();
    });

    test('gives a non-destructive action the create look, and says an unknown sentence as the MCP wrote it', async () => {
        const card = await reload(pendingConfirmation({
            tool: {name: 'freeze_object', title: 'Freeze object', destructive: false},
            preview: {summary: {text: 'Freeze <img src=x onerror=alert(1)> **web**', key: 'freeze_object_new', params: {path: '**web**'}}},
        }));
        expect(within(card).getByText('Action to confirm')).toBeInTheDocument();
        expect(within(card).getByText('Freeze <img src=x onerror=alert(1)> **web**')).toBeInTheDocument();
        expect(card.querySelector('img')).toBeNull();
        expect(within(card).getByRole('button', {name: 'Approve'})).toHaveClass('bg-accent');
    });

    test('puts the params of a known sentence as text, and keeps the card without a preview', async () => {
        const card = await reload(pendingConfirmation({
            preview: {summary: {text: 'Stop', key: 'stop_instance', params: {path: '{{node}} <b>x</b>', node: 'n1'}}},
        }));
        expect(within(card).getByText('Stop {{node}} <b>x</b> on n1')).toBeInTheDocument();
        expect(card.querySelector('b')).toBeNull();
    });

    test('shows the card as before when the agent gives no preview', async () => {
        const card = await reload(pendingConfirmation());
        expect(within(card).getByText('Stop instance')).toBeInTheDocument();
        expect(within(card).queryByText(/The daemon may still refuse/)).not.toBeInTheDocument();
        expect(within(card).getByText('dev5n1')).toHaveProperty('tagName', 'CODE');
    });
});
