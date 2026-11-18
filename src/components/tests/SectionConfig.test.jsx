import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import {SectionConfig} from '../SectionConfig';
import {useMenuState} from '../../hooks/useSidebarAlerts';

const mockGrants = vi.hoisted(() => ({value: {root: null}}));
vi.mock('../../hooks/useGrants', () => ({useGrants: () => mockGrants.value}));
vi.mock('../ConfigText', () => ({
    ConfigText: ({text, label}) => <pre aria-label={label}>{text}</pre>,
}));

const FILE = `[network#backend3]
type = routed_bridge
network = 10.100.0.0/22
`;

describe('SectionConfig read again as the cluster configuration changes', () => {
    // The configuration as read now, or a failure to read it.
    let file;
    let fails;
    let reads;

    beforeEach(() => {
        file = FILE;
        fails = false;
        reads = 0;
        vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
            if (String(url).startsWith('/api/cluster/config/file')) {
                reads += 1;
                if (fails) return new Response('down', {status: 500});
                return new Response(file, {status: 200});
            }
            return new Response('not found', {status: 404});
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const changed = () => act(() => useMenuState.setState({clusterConfig: {changed: Math.random()}}));
    const shown = () => screen.getByLabelText('Configuration of the network backend3');

    test('an edit elsewhere shown, the user doing nothing', async () => {
        render(<SectionConfig section="network" name="backend3" prefix="networks.panel"/>);
        expect(await screen.findByLabelText('Configuration of the network backend3')).toHaveTextContent('network = 10.100.0.0/22');
        file = FILE.replace('10.100.0.0/22', '10.100.0.0/23').concat('subnet@n1 = 10.100.0.0/24\n');
        changed();
        await waitFor(() => expect(shown()).toHaveTextContent('subnet@n1 = 10.100.0.0/24'));
        expect(shown()).toHaveTextContent('network = 10.100.0.0/23');
    });

    test('a failed read again keeps the section shown, no error', async () => {
        render(<SectionConfig section="network" name="backend3" prefix="networks.panel"/>);
        await screen.findByLabelText('Configuration of the network backend3');
        fails = true;
        const before = reads;
        changed();
        await waitFor(() => expect(reads).toBeGreaterThan(before));
        await act(async () => {});
        expect(shown()).toHaveTextContent('network = 10.100.0.0/22');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    test('an edit open keeps its draft as the section is read again', async () => {
        render(<SectionConfig section="network" name="backend3" prefix="networks.panel"/>);
        fireEvent.click(await screen.findByRole('button', {name: 'Edit the configuration of the network backend3'}));
        const editor = await screen.findByRole('textbox', {name: 'Configuration of the network backend3'});
        fireEvent.change(editor, {target: {value: 'type = routed_bridge\nnetwork = 10.100.0.0/21'}});
        file = FILE.replace('10.100.0.0/22', '10.100.0.0/23');
        const before = reads;
        changed();
        await waitFor(() => expect(reads).toBeGreaterThan(before));
        await act(async () => {});
        expect(screen.getByRole('textbox', {name: 'Configuration of the network backend3'})).toHaveValue('type = routed_bridge\nnetwork = 10.100.0.0/21');
    });
});
