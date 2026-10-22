import React from 'react';
import '@testing-library/jest-dom';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import Objects from '../Objects';
import '../../i18n';

// The Objects view against the router itself, not mocked: the URL holds the filters
// and the open panel together.

vi.mock('../../hooks/useEventStore', async (importOriginal) => {
    const actual = await importOriginal();
    const state = {
        objectStatus: {
            'a/svc/one': {avail: 'up'},
            'a/svc/two': {avail: 'down'},
            'b/svc/three': {avail: 'up'},
        },
        objectInstanceStatus: {
            'a/svc/one': {node1: {avail: 'up'}},
            'a/svc/two': {node1: {avail: 'down'}},
            'b/svc/three': {node1: {avail: 'up'}},
        },
        instanceMonitor: {},
        removeObject: vi.fn(),
        setObjectStatuses: vi.fn(),
    };
    const useEventStore = vi.fn((selector) => selector(state));
    useEventStore.getState = () => state;
    return {...actual, __esModule: true, default: useEventStore, getState: useEventStore.getState};
});
vi.mock('../../hooks/useFetchDaemonStatus', () => ({default: () => ({daemon: {cluster: {object: {}}}})}));
vi.mock('../../eventSourceManager', () => ({
    retainEventReception: () => () => {},
    forceFlush: vi.fn(),
    startLoggerReception: vi.fn(),
    closeLoggerEventSource: vi.fn(),
}));
vi.mock('../RecordPanels', () => ({
    ObjectDetailPanel: ({path}) => (path ? <div data-testid="object-panel">{path}</div> : null),
}));

let location;
const LocationSpy = () => {
    location = useLocation();
    return null;
};

const objectRow = (name) => screen.getByRole('row', {name: new RegExp(name)});

test('a row opened after a filter changed keeps the filter', async () => {
    render(
        <MemoryRouter initialEntries={['/objects']}>
            <Objects/>
            <LocationSpy/>
        </MemoryRouter>
    );
    await waitFor(() => expect(objectRow('b/svc/three')).toBeInTheDocument());

    const namespaces = screen.getByRole('group', {name: 'Namespace'});
    fireEvent.click(namespaces.closest('details').querySelector('summary'));
    fireEvent.click(within(namespaces).getByRole('checkbox', {name: /^a$/}));
    await waitFor(() => expect(location.search).toBe('?namespace=a'));
    await waitFor(() => expect(screen.queryByRole('row', {name: /b\/svc\/three/})).not.toBeInTheDocument());

    fireEvent.click(within(objectRow('a/svc/one')).getByText('a/svc/one'));
    await waitFor(() => expect(screen.getByTestId('object-panel')).toHaveTextContent('a/svc/one'));
    expect(new URLSearchParams(location.search).get('namespace')).toBe('a');
    expect(screen.queryByRole('row', {name: /b\/svc\/three/})).not.toBeInTheDocument();
});
