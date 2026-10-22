import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import {NamespaceObjects, useNamespaceObjectTabs} from '../NamespaceObjects';
import useEventStore from '../../hooks/useEventStore';

vi.mock('../../hooks/useKeyStats', () => ({
    useKeyStats: (path) => (path === 'prod/cfg/app' ? {count: 2, size: 2048} : undefined),
}));

const OBJECTS = {
    'prod/svc/web': {avail: 'up', orchestrate: 'ha', topology: 'failover'},
    'prod/svc/api': {avail: 'down', overall: 'warn', orchestrate: 'no', topology: 'flex', flex: {min: 1, max: 3, target: 2}},
    'prod/vol/data': {avail: 'up'},
    'prod/cfg/app': {avail: 'n/a'},
    'prod/sec/tls': {avail: 'n/a'},
    'prod/usr/bob': {avail: 'n/a'},
    'prod/': {avail: 'n/a'},
    'dev/svc/x': {avail: 'up'},
};

beforeEach(() => {
    localStorage.setItem('authToken', 'tok');
    global.fetch = vi.fn(async () => new Response('{}', {status: 200}));
    useEventStore.setState({objectStatus: structuredClone(OBJECTS), objectInstanceStatus: {}, instanceMonitor: {}});
});

const Search = () => <span data-testid="search">{useLocation().search}</span>;
const renderList = (list) => render(
    <MemoryRouter initialEntries={['/objects?list=namespaces']}>
        <NamespaceObjects namespace="prod" list={list}/>
        <Search/>
    </MemoryRouter>,
);
const Tabs = ({namespace}) => (
    <ul>{useNamespaceObjectTabs(namespace).map((tab) => <li key={tab.key}>{tab.label}{tab.badge}</li>)}</ul>
);
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
/** The cells of a row past its checkbox. */
const texts = (row) => within(row).getAllByRole('cell').slice(1).map((c) => c.textContent);
const headers = () => within(screen.getByRole('table')).getAllByRole('columnheader').slice(1).map((h) => h.textContent);

describe('NamespaceObjects', () => {
    test('a tab a kind, no users: the users are the cluster\'s; the namespace configuration a tab of its own', () => {
        render(<Tabs namespace="prod"/>);
        expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Services2!', 'Volumes1', 'Configurations1', 'Secrets1']);
    });

    test('the services: name, orchestrate, topology and status, as in the objects table', () => {
        renderList('services');
        expect(screen.getByRole('table', {name: 'Services of prod'})).toBeInTheDocument();
        expect(headers()).toEqual(['Object', 'Orchestrate', 'Topology', 'Status']);
        expect(rows().map((r) => texts(r)[0])).toEqual(['api', 'web']);
        expect(texts(rows()[1])).toEqual(['web', 'ha', 'failover', 'up']);
        // The flex parameters badged, the status in its tint, degraded marked.
        expect(texts(rows()[0])[2]).toBe('flex1-3 · 2');
        const status = within(rows()[0]).getAllByRole('cell')[4];
        expect(status.querySelector('[data-state]')).toHaveClass('text-state-down');
        expect(within(status).getByRole('img', {name: 'Degraded'})).toBeInTheDocument();
    });

    test('the configurations: name, keys and their size', () => {
        renderList('configs');
        expect(headers()).toEqual(['Object', 'Keys', 'Size']);
        expect(rows().map(texts)).toEqual([['app', '2', '2 KiB']]);
    });

    test('the name of an object a badge opening it over the view; the row opens nothing', () => {
        renderList('services');
        fireEvent.click(within(rows()[1]).getAllByRole('cell')[2]);
        expect(screen.getByTestId('search')).not.toHaveTextContent('peek=');
        fireEvent.click(within(rows()[1]).getByRole('button', {name: 'web'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object%3Aprod%2Fsvc%2Fweb');
    });

    test('none of a kind: said so', () => {
        useEventStore.setState({objectStatus: {'prod/svc/web': {avail: 'up'}}});
        renderList('secrets');
        expect(screen.getByText('No secrets in prod.')).toBeInTheDocument();
    });

    test('objects selected, acted on from the Actions menu, as on the Objects page', async () => {
        renderList('services');
        expect(screen.getByText('Select objects to act on them')).toBeInTheDocument();
        // A checkbox selects, it does not open the object.
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select object prod/svc/web'}));
        expect(screen.getByTestId('search')).not.toHaveTextContent('peek=');
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select object prod/svc/api'}));
        expect(screen.getByText('2 selected')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
        fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', {name: /^Freeze$/i}));
        const dialog = await screen.findByRole('dialog');
        const confirm = within(dialog).queryByRole('checkbox');
        if (confirm) fireEvent.click(confirm);
        fireEvent.click(within(dialog).getByRole('button', {name: /confirm/i}));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/object/path/prod/svc/web/action/freeze', expect.any(Object)));
        expect(global.fetch).toHaveBeenCalledWith('/api/object/path/prod/svc/api/action/freeze', expect.any(Object));
        // What comes of it, the actions tray says: no message of the list's own.
        expect(screen.queryByText(/requested on 2 objects/)).not.toBeInTheDocument();
        // Done, the selection is cleared.
        await waitFor(() => expect(screen.getByText('Select objects to act on them')).toBeInTheDocument());
    });

    test('all of a kind selected at once; keys only deleted, purged or aborted', async () => {
        renderList('configs');
        fireEvent.click(screen.getByRole('checkbox', {name: 'Select all the Configurations'}));
        expect(screen.getByRole('checkbox', {name: 'Select object prod/cfg/app'})).toBeChecked();
        fireEvent.click(screen.getByRole('button', {name: 'Actions'}));
        const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent.trim().toLowerCase());
        expect(items).toContain('delete');
        expect(items.every((item) => ['abort', 'delete', 'purge'].includes(item))).toBe(true);
    });
});
