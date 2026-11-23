import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import CreateObjectPage from '../CreateObjectPage';
import {clearDesignerCache} from '../ObjectDesigner';
import useEventStore from '../../hooks/useEventStore.js';
import {useActionTracker} from '../../app/action-tracker';

const stream = vi.hoisted(() => ({retain: null, release: null}));
vi.mock('../../eventSourceManager', () => {
    stream.release = vi.fn();
    stream.retain = vi.fn(() => stream.release);
    return {retainEventReception: (...args) => stream.retain(...args)};
});

vi.mock('../../hooks/useGrants', () => ({
    useGrants: () => ({root: null}),
    useIsRoot: () => true,
}));

/** Where the router is: the objects list a creation opens, or the page itself. */
function Where() {
    const location = useLocation();
    return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

const renderPage = (entry) => render(
    <MemoryRouter initialEntries={[entry]}>
        <Routes>
            <Route path="/create" element={<CreateObjectPage/>}/>
            <Route path="*" element={null}/>
        </Routes>
        <Where/>
    </MemoryRouter>
);

const where = () => screen.getByTestId('where').textContent;
const region = () => screen.getByRole('region', {name: /^New object/});

describe('CreateObjectPage', () => {
    beforeEach(() => {
        useActionTracker.setState({tracked: [], revealed: 0});
        clearDesignerCache();
        sessionStorage.clear();
        localStorage.setItem('authToken', 'tok');
        global.fetch = vi.fn((url, options = {}) => Promise.resolve({
            ok: true,
            status: options.method === 'POST' ? 204 : 200,
            text: () => Promise.resolve(''),
            json: () => Promise.resolve({items: []}),
        }));
        useEventStore.setState({objectStatus: {'test-ns/svc/test1': {avail: 'up'}}, objectInstanceStatus: {}});
    });

    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    test('opened in a tab of its own, it holds the stream of the objects itself, released once left', async () => {
        stream.retain.mockClear();
        stream.release.mockClear();
        const {unmount} = renderPage('/create?kind=svc&ns=test-ns&draft=s1');
        expect(stream.retain).toHaveBeenCalledWith('tok');
        unmount();
        expect(stream.release).toHaveBeenCalledTimes(1);
    });

    test('opens on the kind and namespace its address says, a draft of its own named in it; an object known refused', async () => {
        renderPage('/create?kind=cfg&ns=test-ns');
        await waitFor(() => expect(where()).toMatch(/[?&]draft=\w+/));
        expect(region().querySelector('[data-kind=cfg]')).toHaveAttribute('aria-pressed', 'true');
        expect(within(region()).getByRole('button', {name: 'test-ns', pressed: true})).toBeInTheDocument();
        fireEvent.click(region().querySelector('[data-kind=svc]'));
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'test1'}});
        expect(screen.getByText('test-ns/svc/test1 already exists.')).toBeInTheDocument();
    });

    test('each step in the address: Next pushes it, the way back goes a step back', async () => {
        renderPage('/create?kind=svc&ns=test-ns&draft=d1');
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'web'}});
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        await waitFor(() => expect(where()).toContain('step=from'));
        fireEvent.click(screen.getByRole('button', {name: 'Next'}));
        await waitFor(() => expect(where()).toContain('step=configure'));
        fireEvent.click(screen.getByRole('button', {name: 'Back'}));
        await waitFor(() => expect(where()).toContain('step=from'));
    });

    test('created from All, the object opens over All, its filters kept; a datastore on its keys', async () => {
        sessionStorage.setItem('om3-webapp.create.d2.from', '/objects?list=any&namespace=test-ns&peek=node:n1');
        renderPage('/create?kind=sec&ns=test-ns&draft=d2');
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'tls'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(where()).toBe('/objects?list=any&namespace=test-ns&sel=test-ns%2Fsec%2Ftls&tab=keys'));
        expect(sessionStorage.getItem('om3-webapp.create.d2.from')).toBeNull();
    });

    test('created from a list of another kind, or from nowhere: over the list of its own', async () => {
        renderPage('/create?kind=sec&ns=test-ns&draft=d3');
        fireEvent.change(screen.getByLabelText('Name'), {target: {value: 'tls'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(where()).toBe('/objects?list=secrets&sel=test-ns%2Fsec%2Ftls&tab=keys'));
    });

    test('cancelled, back where it was opened from; opened in a tab of its own, to the objects', async () => {
        sessionStorage.setItem('om3-webapp.create.d4.from', '/objects?list=volumes');
        const {unmount} = renderPage('/create?kind=vol&ns=test-ns&draft=d4');
        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        expect(where()).toBe('/objects?list=volumes');
        unmount();
        renderPage('/create?kind=vol&ns=test-ns&draft=d5');
        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        expect(where()).toBe('/objects');
    });
});
