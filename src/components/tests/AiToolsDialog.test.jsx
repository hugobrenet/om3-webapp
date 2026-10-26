import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, test, vi} from 'vitest';
import {axe} from 'vitest-axe';
import AiToolsDialog from '../AiToolsDialog.jsx';
import {AiAgentError} from '../../services/ai-agent.js';

const tools = [
    {name: 'stop_instance', title: 'Stop instance', summary: 'Stop the instance of one object on one node.', readOnly: false, needsConfirmation: true},
    {name: 'get_node_status', title: 'Get node status', summary: 'Read the status of one node.', readOnly: true, needsConfirmation: false},
    {name: 'get_cluster_status', title: 'Get cluster status snapshot', summary: 'Read a snapshot of the cluster.', readOnly: true, needsConfirmation: false},
    {name: 'freeze_object', title: 'Freeze object', summary: 'Freeze an object.', readOnly: false, needsConfirmation: false},
];

describe('what the assistant can do', () => {
    test('lists the tools by what they do, sorted, and filters them', async () => {
        const client = {listTools: vi.fn().mockResolvedValue(tools)};
        render(<AiToolsDialog open client={client} onClose={vi.fn()}/>);
        const dialog = screen.getByRole('dialog', {name: 'What the assistant can do'});
        await within(dialog).findByText('4 tools');
        const group = (name) => within(dialog).getByRole('region', {name});
        expect(within(group('Read')).getAllByRole('listitem').map((item) => item.querySelector('code').textContent)).toEqual(['get_cluster_status', 'get_node_status']);
        expect(within(group('Act, after your confirmation')).getByText('Stop instance')).toBeInTheDocument();
        expect(within(group('Act')).getByText('Freeze object')).toBeInTheDocument();
        expect((await axe(dialog)).violations).toHaveLength(0);
        fireEvent.change(within(dialog).getByRole('searchbox', {name: 'Filter the tools'}), {target: {value: 'NODE status'}});
        expect(within(dialog).getByText('1 tool')).toBeInTheDocument();
        expect(within(dialog).queryByRole('region', {name: 'Act'})).toBeNull();
        expect(within(group('Read')).getByText('Get node status')).toBeInTheDocument();
    });

    test('says when the agent could not read its tools', async () => {
        const client = {listTools: vi.fn().mockRejectedValue(new AiAgentError('tools_unavailable', 'x', 502))};
        render(<AiToolsDialog open client={client} onClose={vi.fn()}/>);
        expect(await screen.findByText('The agent could not read its tools. Try again later.')).toBeInTheDocument();
    });

    test('reads nothing while closed, and stops reading once closed', async () => {
        const client = {listTools: vi.fn(() => new Promise(() => {}))};
        const {rerender} = render(<AiToolsDialog open={false} client={client} onClose={vi.fn()}/>);
        expect(client.listTools).not.toHaveBeenCalled();
        rerender(<AiToolsDialog open client={client} onClose={vi.fn()}/>);
        const {signal} = client.listTools.mock.calls[0][0];
        rerender(<AiToolsDialog open={false} client={client} onClose={vi.fn()}/>);
        expect(signal.aborted).toBe(true);
    });
});
