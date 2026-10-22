import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi} from 'vitest';
import '../../i18n';
import {SecCertificate, certificateUrl} from '../SecCertificate';
import {useActionTracker} from '../../app/action-tracker';
import useEventStore from '../../hooks/useEventStore';

const PATH = 'test/sec/tls';
const CONFIG = '/api/object/path/test/sec/tls/config';
const CREATE = '/api/object/path/test/sec/tls/certificate/create';
const RENEW = '/api/object/path/test/sec/tls/certificate/renew?force=false';
const FORCE = '/api/object/path/test/sec/tls/certificate/renew?force=true';

const answer = (status, body) => ({
    ok: status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    clone() { return this; },
});

/** The daemon: the sec naming `ca` ("" none); `routes`, answers of their own by "METHOD url". */
const daemon = ({ca = '', routes = {}} = {}) => {
    global.fetch = vi.fn(async (url, options = {}) => {
        const method = options.method ?? 'GET';
        const own = routes[`${method} ${url}`];
        if (own) return own();
        if (method === 'GET' && url === CONFIG) return answer(200, {items: ca ? [{keyword: 'nodes', value: '*'}, {keyword: 'ca', value: ca}] : []});
        if (method === 'PATCH') return answer(204);
        if (url === CREATE) return answer(204);
        return answer(200, {renewed: true, reason: 'due'});
    });
};

const calls = (method) => global.fetch.mock.calls.filter(([, o]) => (o?.method ?? 'GET') === method).map(([u]) => u);
const tray = () => useActionTracker.getState().tracked;
const labels = () => tray().map((e) => [e.label, e.state]).reverse();

const show = (props = {}) => render(
    <MemoryRouter>
        <SecCertificate path={PATH} keyNames={[]} {...props}/>
    </MemoryRouter>,
);
const openMenu = () => fireEvent.click(screen.getByRole('button', {name: 'Certificate'}));
const askCreate = async () => {
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', {name: 'Create'}));
    const dialog = screen.getByRole('dialog', {name: `Create: ${PATH}`});
    await within(dialog).findByRole('group', {name: 'Signed by'});
    return dialog;
};
const clusterCa = () => screen.getByRole('checkbox', {name: 'Sign with the cluster ca'});

describe('SecCertificate', () => {
    beforeAll(() => {
        // The list of the combobox keeps its active option in view: jsdom has no layout.
        Element.prototype.scrollIntoView ??= vi.fn();
    });

    beforeEach(() => {
        localStorage.setItem('authToken', 'mock-token');
        useActionTracker.setState({tracked: [], revealed: 0});
        useEventStore.setState({objectStatus: {
            'test/sec/tls': {}, 'test/sec/myca': {}, 'test/sec/other': {}, 'test/cfg/c': {}, 'prod/sec/ca2': {}, 'system/sec/ca': {},
        }});
    });

    test('the requests: create, renew when due, renew forced', () => {
        expect(certificateUrl(PATH, 'create')).toBe(CREATE);
        expect(certificateUrl(PATH, 'renew')).toBe(RENEW);
        expect(certificateUrl(PATH, 'force')).toBe(FORCE);
    });

    test('the menu: each entry said what it does, force red, renew off with no certificate', () => {
        show();
        openMenu();
        expect(screen.getByRole('menuitem', {name: 'Create'})).toHaveAccessibleDescription(/self-signed or signed by the ca/);
        expect(screen.getByRole('menuitem', {name: 'Renew'})).toBeDisabled();
        expect(screen.getByRole('menuitem', {name: 'Force renew'})).toHaveClass('text-state-down');
    });

    test('create, no ca: self-signed, nothing written but the certificate; the keys read again', async () => {
        daemon();
        const onWritten = vi.fn();
        show({onWritten});
        const dialog = await askCreate();
        expect(clusterCa()).not.toBeChecked();
        expect(dialog).toHaveTextContent('No ca: self-signed.');
        // The cluster ca, a link to it.
        expect(within(dialog).getByRole('link', {name: 'cluster ca'})).toHaveAttribute('href', '/objects?sel=system%2Fsec%2Fca');
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(onWritten).toHaveBeenCalled());
        expect(calls('PATCH')).toEqual([]);
        expect(calls('POST')).toEqual([CREATE]);
        expect(labels()).toEqual([['Create', 'succeeded']]);
    });

    test('create signed with the cluster ca: written as the ca of the sec first', async () => {
        daemon();
        show();
        const dialog = await askCreate();
        fireEvent.click(clusterCa());
        expect(dialog).toHaveTextContent('Signed by system/sec/ca, written as the ca of the sec.');
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(calls('POST')).toEqual([CREATE]));
        expect(calls('PATCH')).toEqual([`${CONFIG}?set=ca%3Dsystem%2Fsec%2Fca`]);
        expect(labels()).toEqual([['Set ca = system/sec/ca', 'succeeded'], ['Create', 'succeeded']]);
    });

    test('create signed with another ca: picked among the secs of the namespace', async () => {
        daemon();
        show();
        const dialog = await askCreate();
        expect(screen.queryByRole('combobox')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', {name: 'other ca'}));
        const picker = screen.getByRole('combobox', {name: 'Ca of the namespace'});
        fireEvent.focus(picker);
        fireEvent.keyDown(picker, {key: 'ArrowDown'});
        // Its own namespace, secs only, itself left out.
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['test/sec/myca', 'test/sec/other']);
        fireEvent.click(screen.getByRole('option', {name: 'test/sec/myca'}));
        expect(clusterCa()).not.toBeChecked();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(calls('POST')).toEqual([CREATE]));
        expect(calls('PATCH')).toEqual([`${CONFIG}?set=ca%3Dtest%2Fsec%2Fmyca`]);
    });

    test('the ca of the sec shown as chosen; kept, not written again; unchecked, unset', async () => {
        daemon({ca: 'system/sec/ca'});
        show();
        let dialog = await askCreate();
        expect(clusterCa()).toBeChecked();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(calls('POST')).toEqual([CREATE]));
        expect(calls('PATCH')).toEqual([]);

        dialog = await askCreate();
        fireEvent.click(clusterCa());
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(calls('POST')).toHaveLength(2));
        expect(calls('PATCH')).toEqual([`${CONFIG}?unset=ca`]);
    });

    test('another ca named: the picker open on it', async () => {
        daemon({ca: 'prod/sec/ca2'});
        show();
        await askCreate();
        expect(screen.getByRole('combobox', {name: 'Ca of the namespace'})).toHaveValue('prod/sec/ca2');
        expect(clusterCa()).not.toBeChecked();
    });

    test('the ca refused: no certificate asked', async () => {
        daemon({routes: {[`PATCH ${CONFIG}?set=ca%3Dsystem%2Fsec%2Fca`]: () => answer(403, {title: 'Forbidden', detail: 'not admin of system', status: 403})}});
        show();
        const dialog = await askCreate();
        fireEvent.click(clusterCa());
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(tray()[0]).toMatchObject({state: 'refused', error: expect.stringContaining('not admin of system')}));
        expect(calls('POST')).toEqual([]);
    });

    test('create over a certificate: said the private key is kept', async () => {
        daemon();
        show({keyNames: ['certificate', 'private_key']});
        const dialog = await askCreate();
        expect(dialog).toHaveTextContent('The current certificate is replaced; the private key is kept.');
    });

    test.each([
        [true, 'Certificate renewed: expires in 10 days'],
        [false, 'Certificate not renewed: valid until 2027-01-01'],
    ])('renew, renewed %s: the reason in the tray', async (renewed, label) => {
        const reason = renewed ? 'expires in 10 days' : 'valid until 2027-01-01';
        let reply;
        global.fetch = vi.fn().mockReturnValue(new Promise((resolve) => { reply = resolve; }));
        show({keyNames: ['certificate']});
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', {name: 'Renew'}));
        // Tens of seconds from an ACME directory: busy, the menu out of reach.
        expect(await screen.findByText('Renewing the certificate…')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Certificate'})).toBeNull();
        reply(answer(200, {renewed, reason, domains: ['a.example']}));
        await waitFor(() => expect(tray()[0]).toMatchObject({state: 'succeeded', label}));
        expect(global.fetch).toHaveBeenCalledWith(RENEW, expect.objectContaining({signal: expect.any(AbortSignal)}));
        expect(screen.getByRole('button', {name: 'Certificate'})).toBeInTheDocument();
    });

    test('renew refused, not issued by the sec: the force offered, understood before it goes', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(answer(409, {title: 'Conflict', detail: 'the certificate was not issued by test/sec/tls', status: 409}))
            .mockResolvedValueOnce(answer(200, {renewed: true, reason: 'forced'}));
        show({keyNames: ['certificate']});
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', {name: 'Renew'}));
        const dialog = await screen.findByRole('dialog', {name: `Force renew: ${PATH}`});
        expect(dialog).toHaveTextContent('the certificate was not issued by test/sec/tls');
        expect(tray()[0]).toMatchObject({state: 'refused', label: 'Renew'});
        const go = screen.getByRole('button', {name: 'Force renew'});
        expect(go).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', {name: 'I understand'}));
        fireEvent.click(go);
        await waitFor(() => expect(tray()[0]).toMatchObject({state: 'succeeded', label: 'Certificate renewed: forced'}));
        expect(global.fetch).toHaveBeenLastCalledWith(FORCE, expect.anything());
    });

    test('refused otherwise: the reason in the tray, no force offered', async () => {
        daemon({routes: {[`POST ${CREATE}`]: () => answer(403, {title: 'Forbidden', detail: 'not admin of system', status: 403})}});
        const onWritten = vi.fn();
        show({onWritten});
        const dialog = await askCreate();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Create'}));
        await waitFor(() => expect(tray()[0]).toMatchObject({state: 'refused', error: expect.stringContaining('not admin of system')}));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(onWritten).not.toHaveBeenCalled();
    });
});
