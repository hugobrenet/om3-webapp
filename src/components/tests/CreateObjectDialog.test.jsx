import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {vi} from 'vitest';
import CreateObjectDialog from '../CreateObjectDialog';
import {clearDesignerCache} from '../ObjectDesigner';
import useEventStore from '../../hooks/useEventStore.js';
import {useActionTracker} from '../../app/action-tracker';

const grants = vi.hoisted(() => ({current: {root: null}}));
vi.mock('../../hooks/useGrants', () => ({
    useGrants: () => grants.current,
    useIsRoot: () => Object.prototype.hasOwnProperty.call(grants.current, 'root'),
}));

const SOURCE = '[DEFAULT]\nid = 11111111-1111-4111-8111-111111111111\nnodes = *\n\n[fs#1]\ntype = flag\n';

describe('CreateObjectDialog', () => {
    /** The requests made, their method, address and body. */
    let requests;
    let answers;
    const onCreated = vi.fn();

    beforeAll(() => {
        // The list of the combobox keeps its active option in view: jsdom has no layout.
        Element.prototype.scrollIntoView ??= vi.fn();
    });

    beforeEach(() => {
        useActionTracker.setState({tracked: [], revealed: 0});
        vi.clearAllMocks();
        clearDesignerCache();
        grants.current = {root: null};
        localStorage.setItem('authToken', 'tok');
        requests = [];
        answers = {};
        global.fetch = vi.fn((url, options = {}) => {
            requests.push({method: options.method ?? 'GET', url, body: options.body});
            const answer = answers[`${options.method ?? 'GET'} ${url}`] ?? {status: options.method === 'POST' ? 204 : 404, text: ''};
            return Promise.resolve({
                ok: answer.status < 300,
                status: answer.status,
                text: () => Promise.resolve(answer.text ?? ''),
                json: () => Promise.resolve(JSON.parse(answer.text || '{}')),
            });
        });
        useEventStore.setState({objectStatus: {}, objectInstanceStatus: {}});
    });

    afterEach(() => {
        localStorage.clear();
    });

    const open = (props = {}) => render(
        <CreateObjectDialog
            open
            onClose={vi.fn()}
            namespaces={['ns1', 'root']}
            paths={['ns1/svc/web', 'ns1/cfg/settings']}
            onCreated={onCreated}
            {...props}
        />
    );
    const type = (label, value) => fireEvent.change(screen.getByLabelText(label), {target: {value}});
    const next = () => fireEvent.click(screen.getByRole('button', {name: 'Next'}));
    const create = () => fireEvent.click(screen.getByRole('button', {name: 'Create'}));
    const posts = () => requests.filter((r) => r.method === 'POST');
    const card = (selector) => document.querySelector(selector);
    const source = (name) => fireEvent.click(card(`[data-source=${name}]`));

    test('cancel closes at the first click: pressed, it leaves the name focused, no error to grow the dialog', () => {
        const onClose = vi.fn();
        open({defaultKind: 'sec', onClose});
        const name = screen.getByLabelText('Name');
        expect(name).toHaveFocus();
        const cancel = screen.getByRole('button', {name: 'Cancel'});
        // The press keeps the focus: fireEvent says false when the default is prevented.
        expect(fireEvent.mouseDown(cancel)).toBe(false);
        expect(name).toHaveFocus();
        expect(screen.queryByRole('alert')).toBeNull();
        fireEvent.click(cancel);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('untouched, closed by Escape; something typed, kept open by a stray Escape, Cancel closing it', () => {
        const onClose = vi.fn();
        open({defaultKind: 'svc', onClose});
        fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(1);
        type('Name', 'web2');
        fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    test('opens on the kind and namespace it is given, a card each picked, the name focused; no wait to choose', () => {
        open({defaultKind: 'cfg', defaultNamespace: 'ns1'});
        expect(screen.getByRole('dialog', {name: 'New object'})).toBeInTheDocument();
        expect(card('[data-kind=cfg]')).toHaveAttribute('aria-pressed', 'true');
        expect(within(screen.getByRole('group', {name: 'My namespaces'})).getByRole('button', {name: 'ns1'})).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByLabelText('Name')).toHaveFocus();
        expect(screen.queryByRole('checkbox', {name: /wait/i})).toBeNull();
    });

    test('each kind its part in an application said', () => {
        open();
        expect(card('[data-kind=vol]')).toHaveTextContent('Storage for services');
        expect(card('[data-kind=nscfg]')).toHaveTextContent('The namespace itself');
    });

    test('the namespaces of the user: those it administers; a new one proposed to who may make one', () => {
        grants.current = {admin: ['ns1']};
        const {unmount} = open({defaultNamespace: 'ns1'});
        const mine = screen.getByRole('group', {name: 'My namespaces'});
        expect(within(mine).getAllByRole('button').map((b) => b.textContent)).toEqual(['ns1']);
        unmount();
        grants.current = {admin: ['ns1'], squatter: null};
        open({defaultNamespace: 'ns1'});
        fireEvent.click(within(screen.getByRole('group', {name: 'My namespaces'})).getByRole('button', {name: 'New namespace'}));
        type('Name of the new namespace', 'team9');
        type('Name', 'web');
        expect(screen.getByText('team9/svc/web')).toBeInTheDocument();
    });

    test('a name om refuses is said as typed, and nothing goes further', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'Web');
        expect(screen.getByText('Lowercase letters only.')).toBeInTheDocument();
        type('Name', 'node');
        expect(screen.getByText('This name is reserved by om.')).toBeInTheDocument();
        next();
        expect(screen.queryByRole('group', {name: 'Start from'})).toBeNull();
        expect(posts()).toEqual([]);
    });

    test('an object that exists is said as soon as its path is typed; a free one marked', () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'web');
        expect(screen.getByText('ns1/svc/web already exists.')).toBeInTheDocument();
        type('Name', 'web2');
        expect(screen.getByLabelText('Free')).toBeInTheDocument();
    });

    test('from nothing: the object posted with a new id alone', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        next();
        expect(card('[data-source=empty]')).toHaveAttribute('aria-pressed', 'true');
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/db'));
        expect(useActionTracker.getState().tracked.map((e) => [e.label, e.subject, e.state])).toEqual([['Create', 'ns1/svc/db', 'succeeded']]);
        const [post] = posts();
        expect(post.url).toBe('/api/object/path/ns1/svc/db/config/file?wait=30s');
        expect(post.body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\n$/);
    });

    test('a service of the root namespace is written as om writes it', async () => {
        open();
        type('Name', 'db');
        expect(screen.getByText('db')).toBeInTheDocument();
        next();
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('db'));
        expect(posts()[0].url).toBe('/api/object/path/root/svc/db/config/file?wait=30s');
    });

    test('a cfg or a sec, a datastore: created at the first step, empty, its keys added next', async () => {
        open({defaultKind: 'sec', defaultNamespace: 'ns1'});
        expect(screen.queryByRole('button', {name: 'Next'})).toBeNull();
        expect(screen.getByText('Created empty: its keys are added next, in its panel.')).toBeInTheDocument();
        type('Name', 'tls');
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/sec/tls'));
        expect(posts()[0].url).toBe('/api/object/path/ns1/sec/tls/config/file?wait=30s');
        expect(posts()[0].body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]+\n$/);
    });

    test('a namespace configuration takes the name om gives it, in a namespace new', async () => {
        open({defaultNamespace: 'ns2'});
        fireEvent.click(card('[data-kind=nscfg]'));
        expect(screen.getByLabelText('Name')).toHaveValue('namespace');
        expect(screen.getByLabelText('Name')).toBeDisabled();
        expect(screen.getByLabelText('Name of the new namespace')).toHaveValue('ns2');
        next();
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns2/nscfg/namespace'));
    });

    test('a copy starts from the configuration of the object, its id replaced', async () => {
        answers['GET /api/object/path/ns1/svc/web/config/file?redact-secrets=false'] = {status: 200, text: SOURCE};
        open({defaultNamespace: 'ns1'});
        type('Name', 'web2');
        next();
        source('copy');
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/web'}));
        await waitFor(() => expect(screen.getByLabelText('Configuration')).toHaveValue(SOURCE));
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/web2'));
        const body = posts()[0].body;
        expect(body).not.toContain('11111111-1111');
        expect(body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\nnodes = \*\n\n\[fs#1\]\ntype = flag\n$/);
    });

    test('a copy loaded, then back to make it a datastore: created empty, the text kept for a service', async () => {
        answers['GET /api/object/path/ns1/svc/web/config/file?redact-secrets=false'] = {status: 200, text: SOURCE};
        open({defaultNamespace: 'ns1'});
        type('Name', 'tls');
        next();
        source('copy');
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/web'}));
        await waitFor(() => expect(screen.getByLabelText('Configuration')).toHaveValue(SOURCE));
        fireEvent.click(screen.getByRole('button', {name: 'Back'}));
        fireEvent.click(card('[data-kind=sec]'));
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/sec/tls'));
        expect(posts()[0].body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\n$/);
        // Back to a service, the text is still there, as left.
        fireEvent.click(card('[data-kind=svc]'));
        next();
        expect(screen.getByLabelText('Configuration')).toHaveValue(SOURCE);
    });

    test('two copies picked in a row: the text of the last one, whichever answers last', async () => {
        const OTHER = '[DEFAULT]\nnodes = node1\n';
        let answerFirst;
        global.fetch.mockImplementation((url, options = {}) => {
            requests.push({method: options.method ?? 'GET', url, body: options.body});
            if (url.includes('/ns1/svc/web/')) {
                return new Promise((resolve) => {
                    answerFirst = () => resolve({ok: true, status: 200, text: () => Promise.resolve(SOURCE)});
                });
            }
            return Promise.resolve({ok: true, status: 200, text: () => Promise.resolve(OTHER)});
        });
        open({defaultNamespace: 'ns1', paths: ['ns1/svc/web', 'ns1/svc/api']});
        type('Name', 'x');
        next();
        source('copy');
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/web'}));
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/api'}));
        await waitFor(() => expect(screen.getByLabelText('Configuration')).toHaveValue(OTHER));
        await act(async () => { answerFirst(); });
        expect(screen.getByLabelText('Configuration')).toHaveValue(OTHER);
        expect(screen.getByRole('button', {name: 'Create'})).toBeEnabled();
    });

    test('a copy that could not be read: not the one before created, nothing to create until one is read', async () => {
        answers['GET /api/object/path/ns1/svc/web/config/file?redact-secrets=false'] = {status: 200, text: SOURCE};
        answers['GET /api/object/path/ns1/svc/api/config/file?redact-secrets=false'] = {status: 500, text: 'boom'};
        open({defaultNamespace: 'ns1', paths: ['ns1/svc/web', 'ns1/svc/api']});
        type('Name', 'x');
        next();
        source('copy');
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/web'}));
        await waitFor(() => expect(screen.getByLabelText('Configuration')).toHaveValue(SOURCE));
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/api'}));
        await waitFor(() => expect(screen.getByText(/The configuration of ns1\/svc\/api could not be read/)).toBeInTheDocument());
        // The text of ns1/svc/web no longer under ns1/svc/api, and nothing posted.
        expect(screen.queryByLabelText('Configuration')).toBeNull();
        expect(screen.getByRole('button', {name: 'Create'})).toBeDisabled();
        fireEvent.submit(screen.getByRole('button', {name: 'Create'}).form ?? document.querySelector('form'));
        expect(posts()).toEqual([]);
        // Picked again and read: created from it.
        fireEvent.click(screen.getByRole('combobox', {name: 'Object to copy'}));
        fireEvent.click(screen.getByRole('option', {name: 'ns1/svc/web'}));
        await waitFor(() => expect(screen.getByRole('button', {name: 'Create'})).toBeEnabled());
        create();
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/x'));
        expect(posts()[0].body).toContain('[fs#1]');
    });

    test('a text written, then a copy chosen and none picked: the text written not created as a copy', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'x');
        next();
        source('edit');
        fireEvent.change(screen.getByLabelText('Configuration'), {target: {value: '[DEFAULT]\nnodes = written\n'}});
        source('copy');
        expect(screen.getByRole('button', {name: 'Create'})).toBeDisabled();
        // Back to it, the text written is still there.
        source('edit');
        expect(screen.getByLabelText('Configuration')).toHaveValue('[DEFAULT]\nnodes = written\n');
    });

    test('written: a file dropped on the text read into it, sent with a new id', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        next();
        source('edit');
        const file = new File(['[DEFAULT]\nnodes = *\n'], 'db.conf', {type: 'text/plain'});
        // jsdom's File reads no text: the browser's does.
        file.text = () => Promise.resolve('[DEFAULT]\nnodes = *\n');
        fireEvent.drop(card('[data-drop-zone]'), {dataTransfer: {files: [file]}});
        await waitFor(() => expect(screen.getByLabelText('Configuration')).toHaveValue('[DEFAULT]\nnodes = *\n'));
        expect(screen.getByText('db.conf read: edited here before it is sent.')).toBeInTheDocument();
        create();
        await waitFor(() => expect(posts()[0].body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\nnodes = \*\n$/));
    });

    describe('designed', () => {
        const KW = (driver, items) => {
            answers[`GET /api/object/path/ns1/svc/db/config/keywords?driver=${encodeURIComponent(driver)}`] = {status: 200, text: JSON.stringify({items})};
        };
        beforeEach(() => {
            KW('DEFAULT', [{section: 'DEFAULT', option: 'nodes', text: 'The nodes the object runs on.'}, {section: 'DEFAULT', option: 'orchestrate', candidates: ['no', 'ha']}]);
            KW('fs.flag', [
                {section: 'fs', option: 'type', required: true},
                {section: 'fs', option: 'mnt', types: ['flag'], required: true, text: 'The mount point.'},
                {section: 'fs', option: 'size', types: [], text: 'The size.'},
            ]);
        });

        const design = async () => {
            open({defaultNamespace: 'ns1'});
            type('Name', 'db');
            next();
            source('design');
            await screen.findByRole('navigation', {name: 'Sections'});
        };

        test('DEFAULT and env to start; a resource added by its driver, its required keywords seeded; the file it makes posted', async () => {
            await design();
            const sections = screen.getByRole('navigation', {name: 'Sections'});
            expect(within(sections).getAllByRole('button').filter((b) => b.hasAttribute('aria-current') || /^(DEFAULT|env)/.test(b.textContent)).map((b) => b.textContent)).toEqual(['DEFAULT', 'env']);
            // A keyword of DEFAULT added from the list, its doc a click away.
            fireEvent.click(screen.getByRole('button', {name: 'More'}));
            const list = screen.getByRole('list', {name: 'Keywords to add'});
            fireEvent.click(within(list).getByRole('button', {name: 'What nodes does'}));
            // Its first line in the list, its whole text opened under it.
            expect(within(list).getAllByText('The nodes the object runs on.')).toHaveLength(2);
            fireEvent.click(within(list).getByRole('button', {name: 'Add nodes'}));
            type('Value of nodes', '*');
            // No list of the drivers from the daemon: the driver typed.
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.change(await screen.findByLabelText('Driver, as group.type'), {target: {value: 'fs.flag'}});
            fireEvent.click(within(card('[data-add-resource]')).getByRole('button', {name: 'Add a resource'}));
            expect(await screen.findByRole('heading', {name: /\[fs#1\]/})).toBeInTheDocument();
            expect(screen.getByText('Required without a value: fs#1.mnt.')).toBeInTheDocument();
            type('Value of mnt', '/srv');
            fireEvent.click(screen.getByRole('button', {name: 'Show the file'}));
            expect(card('[data-preview]')).toHaveTextContent('[DEFAULT] nodes = * [fs#1] type = flag mnt = /srv');
            create();
            await waitFor(() => expect(posts()[0].body).toMatch(/^\[DEFAULT\]\nid = [0-9a-f-]{36}\nnodes = \*\n\n\[fs#1\]\ntype = flag\nmnt = \/srv\n$/));
        });

        test('a resource added in the pane of the keys; its required keywords kept; its keywords most set offered once they are set', async () => {
            await design();
            // DEFAULT, nothing required: those most set at once, a click each.
            expect(within(card('[data-popular=nodes]').parentElement).getAllByRole('button').map((b) => b.dataset.popular ?? b.textContent)).toEqual(['More', 'nodes', 'orchestrate']);
            fireEvent.click(screen.getByRole('button', {name: 'Add nodes'}));
            expect(screen.getByRole('textbox', {name: 'Value of nodes'})).toBeInTheDocument();
            expect(card('[data-popular=nodes]')).toBeNull();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            expect(screen.getByRole('heading', {name: 'Add a resource'})).toBeInTheDocument();
            fireEvent.change(await screen.findByLabelText('Driver, as group.type'), {target: {value: 'fs.flag'}});
            fireEvent.click(within(card('[data-add-resource]')).getByRole('button', {name: 'Add a resource'}));
            expect(await screen.findByRole('heading', {name: /\[fs#1\]/})).toBeInTheDocument();
            // A required keyword: there, not to remove; nothing more offered until it is set.
            expect(screen.queryByRole('button', {name: 'Remove mnt'})).toBeNull();
            expect(card('[data-popular]')).toBeNull();
            type('Value of mnt', '/srv');
            expect(card('[data-popular=size]')).toBeInTheDocument();
        });

        const netns = async () => {
            KW('ip.netns', [
                {section: 'ip', option: 'type', required: true},
                {section: 'ip', option: 'netns', types: ['netns'], required: true},
                {section: 'ip', option: 'network', types: ['netns']},
            ]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.change(await screen.findByLabelText('Driver, as group.type'), {target: {value: 'ip.netns'}});
            fireEvent.click(within(card('[data-add-resource]')).getByRole('button', {name: 'Add a resource'}));
            await screen.findByRole('heading', {name: /\[ip#1\]/});
            type('Value of netns', 'container#1');
            fireEvent.click(screen.getByRole('button', {name: 'Add network'}));
            const network = await screen.findByRole('combobox', {name: 'Value of network'});
            return () => {
                fireEvent.click(network);
                return within(screen.getByRole('listbox', {name: 'The values of network'})).getAllByRole('option').map((o) => o.textContent);
            };
        };

        test('not root: the networks its namespace claims offered for an address drawn from one, by name', async () => {
            grants.current = {admin: ['ns1']};
            answers['GET /api/network'] = {status: 200, text: JSON.stringify({items: [{name: 'backend5', type: 'routed_bridge', network: '10.0.5.0/24', free: 250}]})};
            answers['GET /api/object/path/ns1/nscfg/namespace/config/file'] = {status: 200, text: '[claim#1]\ntype = network\nname = backend5\nlimit = 10\n[claim#2]\ntype = pool\nname = default\n[claim#3]\ntype = network\nname = backend3\n'};
            const offered = await netns();
            // Told when the networks may be read; one not there by its name alone.
            await waitFor(() => expect(offered()).toEqual(['backend5routed_bridge10.0.5.0/24250 addresses free', 'backend3']));
        });

        test('an address drawn from a network: for root, the networks of the cluster offered, by name; any name still typed', async () => {
            answers['GET /api/network'] = {status: 200, text: JSON.stringify({items: [
                {name: 'default', type: 'bridge', network: '10.22.0.0/16', free: 65533},
                {name: 'backend1', type: 'routed_bridge', network: 'fd01::/64', free: 2 ** 64 - 1},
            ]})};
            const offered = await netns();
            // An ipv6 /64: its free addresses not told.
            await waitFor(() => expect(offered()).toEqual(['defaultbridge10.22.0.0/1665,533 addresses free', 'backend1routed_bridgefd01::/64']));
            // Its netns a free value: nothing offered.
            expect(screen.getByRole('textbox', {name: 'Value of netns'})).not.toHaveAttribute('list');
        });

        test('a guest on several networks: a pick adds a word, a network picked not offered again', async () => {
            answers['GET /api/network'] = {status: 200, text: JSON.stringify({items: [
                {name: 'backend3', type: 'routed_bridge', network: '10.100.0.0/22'},
                {name: 'backend5', type: 'routed_bridge', network: 'fd01::/64'},
            ]})};
            KW('container.kvm', [
                {section: 'container', option: 'type', required: true},
                {section: 'container', option: 'network', types: ['kvm'], converter: 'list'},
            ]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.change(await screen.findByLabelText('Driver, as group.type'), {target: {value: 'container.kvm'}});
            fireEvent.click(within(card('[data-add-resource]')).getByRole('button', {name: 'Add a resource'}));
            await screen.findByRole('heading', {name: /\[container#1\]/});
            fireEvent.click(screen.getByRole('button', {name: 'Add network'}));
            const network = await screen.findByRole('combobox', {name: 'Value of network'});
            const offered = () => within(screen.getByRole('listbox', {name: 'The values of network'})).getAllByRole('option');
            await waitFor(() => {
                fireEvent.click(network);
                expect(offered()).toHaveLength(2);
            });
            fireEvent.mouseDown(offered()[0]);
            expect(network).toHaveValue('backend3');
            fireEvent.change(network, {target: {value: 'backend3 '}});
            expect(offered().map((o) => o.getAttribute('data-pick'))).toEqual(['backend5']);
            fireEvent.mouseDown(offered()[0]);
            expect(network).toHaveValue('backend3 backend5');
        });

        test('an example taken as the value, by a click or the right arrow; a default left to apply', async () => {
            KW('DEFAULT', [
                {section: 'DEFAULT', option: 'nodes', example: 'n1 n2'},
                {section: 'DEFAULT', option: 'orchestrate', default: 'no', example: 'ha'},
                {section: 'DEFAULT', option: 'topology', example: 'flex'},
            ]);
            await design();
            for (const name of ['Add nodes', 'Add orchestrate', 'Add topology']) fireEvent.click(screen.getByRole('button', {name}));
            fireEvent.click(screen.getByRole('button', {name: 'Use the example n1 n2'}));
            expect(screen.getByRole('textbox', {name: 'Value of nodes'})).toHaveValue('n1 n2');
            expect(screen.queryByRole('button', {name: 'Use the example n1 n2'})).toBeNull();
            expect(screen.queryByRole('button', {name: /Use the example ha/})).toBeNull();
            fireEvent.keyDown(screen.getByRole('textbox', {name: 'Value of topology'}), {key: 'ArrowRight'});
            expect(screen.getByRole('textbox', {name: 'Value of topology'})).toHaveValue('flex');
        });

        test('the keywords to add: the arrows move over those matching, Enter adds the one picked', async () => {
            KW('DEFAULT', [{section: 'DEFAULT', option: 'nodes'}, {section: 'DEFAULT', option: 'orchestrate'}, {section: 'DEFAULT', option: 'topology'}]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'More'}));
            const find = screen.getByRole('searchbox', {name: 'Find a keyword'});
            const picked = () => document.querySelector('[data-active]')?.dataset.keyword;
            expect(picked()).toBe('nodes');
            fireEvent.keyDown(find, {key: 'ArrowDown'});
            fireEvent.keyDown(find, {key: 'ArrowDown'});
            expect(picked()).toBe('topology');
            fireEvent.keyDown(find, {key: 'ArrowDown'});
            expect(picked()).toBe('nodes');
            fireEvent.keyDown(find, {key: 'ArrowUp'});
            expect(picked()).toBe('topology');
            // The words typed: back to the first matching.
            fireEvent.change(find, {target: {value: 'o'}});
            expect(picked()).toBe('nodes');
            fireEvent.keyDown(find, {key: 'ArrowDown'});
            fireEvent.keyDown(find, {key: 'Enter'});
            expect(screen.getByRole('textbox', {name: 'Value of orchestrate'})).toBeInTheDocument();
        });

        test('the drivers of the node of the api, by group then type, for its kind', async () => {
            answers['GET /api/node/name/localhost/capabilities'] = {status: 200, text: JSON.stringify({items: [
                {data: {name: 'drivers.resource.fs.flag'}}, {data: {name: 'drivers.resource.fs.ext4'}},
                {data: {name: 'drivers.resource.app.forking'}}, {data: {name: 'drivers.resource.app.forking.x'}},
            ]})};
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            const groups = await screen.findByRole('group', {name: 'Driver groups'});
            expect(within(groups).getAllByRole('button').map((b) => b.dataset.group)).toEqual(['app', 'fs']);
            // Each its part in the app said.
            expect(card('[data-group=fs]')).toHaveTextContent('Mounts a filesystem');
            fireEvent.click(card('[data-group=fs]'));
            expect(within(screen.getByRole('list', {name: 'Types'})).getAllByRole('button').map((b) => b.textContent)).toEqual(['ext4', 'flag']);
            // A type a click: added.
            fireEvent.click(within(screen.getByRole('list', {name: 'Types'})).getByRole('button', {name: 'flag'}));
            expect(await screen.findByRole('heading', {name: /\[fs#1\]/})).toBeInTheDocument();
        });

        test('the drivers of the catalog: what each is and does; a virtual one first, the ones it picks among inside it', async () => {
            answers['GET /api/node/name/localhost/drivers'] = {status: 200, text: JSON.stringify({
                items: [
                    {data: {name: 'container.docker', group: 'container', type: 'docker', doc: 'Runs a container with docker.', features: ['start', 'stop'], available: true}},
                    {data: {name: 'container.oci', group: 'container', type: 'oci', doc: 'Runs an OCI container with the runtime the node has.', features: ['start', 'stop'], selects: ['container.docker', 'container.podman'], available: true}},
                    {data: {name: 'container.podman', group: 'container', type: 'podman', features: ['start', 'stop'], available: true}},
                    {data: {name: 'container.lxc', group: 'container', type: 'lxc', features: ['provision', 'start', 'stop'], available: true}},
                    {data: {name: 'fs.nfs', group: 'fs', type: 'nfs', doc: 'Mounts a network filesystem.', features: ['start', 'stop'], available: true}},
                    {data: {name: 'disk.lvm', group: 'disk', type: 'lvm', aliasOf: 'disk.vg', available: true}},
                ],
                features: [{name: 'start', doc: 'The start brings the resource up.'}],
            })};
            KW('container.podman', [{section: 'container', option: 'type', required: true}]);
            KW('fs.nfs', [{section: 'fs', option: 'type', required: true}]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            const groups = await screen.findByRole('group', {name: 'Driver groups'});
            // A deprecated alias not offered: no disk group of it alone.
            expect(within(groups).getAllByRole('button').map((b) => b.dataset.group)).toEqual(['container', 'fs']);
            fireEvent.click(card('[data-group=container]'));
            const types = screen.getByRole('list', {name: 'Types'});
            expect(within(types).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
                'ociRuns an OCI container with the runtime the node has.startstopor:dockerpodman',
                'lxcprovisionstartstop',
            ]);
            // A feature told on hover.
            fireEvent.click(within(types).getByRole('button', {name: 'podman'}));
            expect(await screen.findByRole('heading', {name: /\[container#1\] container\.podman/})).toBeInTheDocument();
            // Podman provisions nothing: no box to take its provision on.
            expect(screen.queryByRole('checkbox', {name: 'Unmanaged provisioning'})).toBeNull();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.click(await screen.findByRole('button', {name: /^fs/}));
            fireEvent.click(within(screen.getByRole('list', {name: 'Types'})).getByRole('button', {name: /^nfs/}));
            await screen.findByRole('heading', {name: /\[fs#1\]/});
            expect(screen.queryByRole('checkbox', {name: 'Unmanaged provisioning'})).toBeNull();
        });

        test('the drivers only root may use: hidden from a design without root, a group left empty too; tagged when root shows them', async () => {
            answers['GET /api/node/name/localhost/drivers'] = {status: 200, text: JSON.stringify({items: [
                {data: {name: 'disk.lv', group: 'disk', type: 'lv', grant: 'root', available: true}},
                {data: {name: 'fs.ext4', group: 'fs', type: 'ext4', grant: 'root', available: true}},
                {data: {name: 'fs.flag', group: 'fs', type: 'flag', grant: '', available: true}},
                {data: {name: 'fs.x', group: 'fs', type: 'x', grant: '', provisionGrant: 'root', available: true}},
            ]})};
            KW('DEFAULT', [{section: 'DEFAULT', option: 'nodes', grant: ''}]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            const groups = await screen.findByRole('group', {name: 'Driver groups'});
            // Root not asking for root's: as a user without root, no disk group, no ext4.
            expect(within(groups).getAllByRole('button').map((b) => b.dataset.group)).toEqual(['fs']);
            fireEvent.click(card('[data-group=fs]'));
            expect(within(screen.getByRole('list', {name: 'Types'})).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['flag', 'xroot, or unmanaged provisioning']);
            // Asked for: all of them, those of root tagged.
            fireEvent.click(screen.getByRole('checkbox', {name: 'Show the keywords only root may set'}));
            expect(within(await screen.findByRole('group', {name: 'Driver groups'})).getAllByRole('button').map((b) => b.dataset.group)).toEqual(['disk', 'fs']);
            fireEvent.click(card('[data-group=fs]'));
            expect(within(screen.getByRole('list', {name: 'Types'})).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['ext4root', 'flag', 'xroot, or unmanaged provisioning']);
        });

        test('a volume: added without a type, its size required, the type of pool it needs offered as a keyword', async () => {
            answers['GET /api/node/name/localhost/capabilities'] = {status: 200, text: JSON.stringify({items: [
                {data: {name: 'drivers.resource.volume'}}, {data: {name: 'drivers.resource.volume.shm'}}, {data: {name: 'drivers.resource.volume.loop'}},
            ]})};
            KW('volume', [
                {section: 'volume', option: 'type', types: ['']},
                {section: 'volume', option: 'size', types: [''], provisioning: true, provisioningRequired: true},
                {section: 'volume', option: 'shared', types: ['']},
            ]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            await screen.findByRole('group', {name: 'Driver groups'});
            // No type to pick: what it needs said later; its card adds it.
            expect(card('[data-group=volume]')).toHaveTextContent(/what it needs/);
            fireEvent.click(card('[data-group=volume]'));
            expect(await screen.findByRole('heading', {name: /\[volume#1\]/})).toBeInTheDocument();
            expect(screen.getByRole('textbox', {name: 'Value of size'})).toBeInTheDocument();
            expect(screen.queryByRole('button', {name: 'Remove size'})).toBeNull();
            type('Value of size', '1g');
            fireEvent.click(screen.getByRole('button', {name: 'More'}));
            fireEvent.click(within(screen.getByRole('list', {name: 'Keywords to add'})).getByRole('button', {name: 'Add type'}));
            const kind = await screen.findByRole('combobox', {name: 'Value of type'});
            await waitFor(() => expect([...document.getElementById(kind.getAttribute('list')).options].map((o) => o.value)).toEqual(['loop', 'shm']));
            fireEvent.change(kind, {target: {value: 'shm'}});
            fireEvent.click(screen.getByRole('button', {name: 'Show the file'}));
            expect(card('[data-preview]')).toHaveTextContent('[volume#1] size = 1g type = shm');
        });

        test('the keywords a provision fails without required, unless the user takes the provision on, warned first; the other provisioning ones at hand', async () => {
            KW('disk.lv', [
                {section: 'disk', option: 'type', required: true},
                {section: 'disk', option: 'name', types: ['lv'], required: true},
                {section: 'disk', option: 'size', types: ['lv'], provisioning: true, provisioningRequired: true},
                {section: 'disk', option: 'create_options', types: ['lv'], provisioning: true},
                {section: 'disk', option: 'vg', types: ['lv'], provisioning: true, provisioningRequired: true},
                {section: 'disk', option: 'provision', types: []},
            ]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.change(await screen.findByLabelText('Driver, as group.type'), {target: {value: 'disk.lv'}});
            fireEvent.click(within(card('[data-add-resource]')).getByRole('button', {name: 'Add a resource'}));
            await screen.findByRole('heading', {name: /\[disk#1\]/});
            // Seeded, not to remove.
            for (const name of ['name', 'size', 'vg']) expect(screen.getByRole('textbox', {name: `Value of ${name}`})).toBeInTheDocument();
            expect(screen.queryByRole('textbox', {name: 'Value of create_options'})).toBeNull();
            expect(screen.queryByRole('button', {name: 'Remove size'})).toBeNull();
            type('Value of name', 'data');
            type('Value of size', '1g');
            expect(screen.getByText('Required without a value: disk#1.vg.')).toBeInTheDocument();
            // Taken on: asked first; cancelled, nothing changes.
            fireEvent.click(screen.getByRole('checkbox', {name: 'Unmanaged provisioning'}));
            const warning = screen.getByRole('dialog', {name: 'Unmanaged provisioning of disk#1'});
            expect(warning).toHaveTextContent('You are responsible for creating the system resources');
            fireEvent.click(within(warning).getByRole('button', {name: 'Cancel'}));
            expect(screen.getByRole('checkbox', {name: 'Unmanaged provisioning'})).not.toBeChecked();
            fireEvent.click(screen.getByRole('checkbox', {name: 'Unmanaged provisioning'}));
            fireEvent.click(within(screen.getByRole('dialog', {name: 'Unmanaged provisioning of disk#1'})).getByRole('button', {name: 'I manage them'}));
            expect(screen.getByRole('checkbox', {name: 'Unmanaged provisioning'})).toBeChecked();
            // The empty one dropped, the one set kept; no row for the provision itself.
            expect(screen.queryByRole('textbox', {name: 'Value of vg'})).toBeNull();
            expect(screen.getByRole('textbox', {name: 'Value of size'})).toHaveValue('1g');
            expect(screen.queryByRole('textbox', {name: 'Value of provision'})).toBeNull();
            expect(screen.queryByText(/Required without a value/)).toBeNull();
            fireEvent.click(screen.getByRole('button', {name: 'Show the file'}));
            expect(card('[data-preview]')).toHaveTextContent('[disk#1] type = lv name = data size = 1g provision = false');
            // Given back to om: required again; the optional one at hand once they are set.
            fireEvent.click(screen.getByRole('checkbox', {name: 'Unmanaged provisioning'}));
            await screen.findByRole('textbox', {name: 'Value of vg'});
            type('Value of vg', 'datavg');
            expect(card('[data-popular=create_options]')).toBeInTheDocument();
        });

        test('the pool of a volume picked among those of the cluster for root, each its type and free size', async () => {
            answers['GET /api/node/name/localhost/capabilities'] = {status: 200, text: JSON.stringify({items: [{data: {name: 'drivers.resource.volume'}}]})};
            answers['GET /api/pool'] = {status: 200, text: JSON.stringify({items: [
                {name: 'default', type: 'directory', size: 100 * 2 ** 30, free: 22 * 2 ** 30},
                {name: 'v1', type: 'virtual', size: 0, free: 0},
            ]})};
            KW('volume', [
                {section: 'volume', option: 'size', types: [''], provisioning: true, provisioningRequired: true},
                {section: 'volume', option: 'pool', types: [''], provisioning: true},
            ]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.click(await screen.findByRole('button', {name: /^volume/}));
            await screen.findByRole('heading', {name: /\[volume#1\]/});
            type('Value of size', '1g');
            fireEvent.click(await screen.findByRole('button', {name: 'Add pool'}));
            // Opened by the field itself, no list of the browser's beside it.
            const pool = await screen.findByRole('combobox', {name: 'Value of pool'});
            expect(pool).not.toHaveAttribute('list');
            await waitFor(() => {
                fireEvent.click(pool);
                expect(screen.getByRole('listbox', {name: 'The values of pool'})).toBeInTheDocument();
            });
            const picks = () => within(screen.getByRole('listbox', {name: 'The values of pool'})).getAllByRole('option').map((o) => o.textContent);
            // Its type and free size; a virtual pool, of no size, its type alone.
            expect(picks()).toEqual(['defaultdirectory22 GiB free', 'v1virtual']);
            fireEvent.mouseDown(within(screen.getByRole('listbox', {name: 'The values of pool'})).getByRole('option', {name: /^default/}));
            expect(pool).toHaveValue('default');
            expect(screen.queryByRole('listbox', {name: 'The values of pool'})).toBeNull();
            // Typed: filtered; the arrows and Enter take one.
            fireEvent.change(pool, {target: {value: 'v'}});
            expect(picks()).toEqual(['v1virtual']);
            fireEvent.keyDown(pool, {key: 'Enter'});
            expect(pool).toHaveValue('v1');
        });

        test('not root: the pools its namespace claims picked, told when the pools may be read', async () => {
            grants.current = {admin: ['ns1']};
            answers['GET /api/node/name/localhost/capabilities'] = {status: 200, text: JSON.stringify({items: [{data: {name: 'drivers.resource.volume'}}]})};
            answers['GET /api/pool'] = {status: 200, text: JSON.stringify({items: [
                {name: 'default', type: 'directory', size: 100 * 2 ** 30, free: 22 * 2 ** 30},
                {name: 'fast', type: 'zpool', size: 10 * 2 ** 30, free: 5 * 2 ** 30},
            ]})};
            answers['GET /api/object/path/ns1/nscfg/namespace/config/file'] = {status: 200, text: '[claim#1]\ntype = pool\nname = fast\nlimit = 2g\n'};
            KW('volume', [
                {section: 'volume', option: 'size', types: [''], provisioning: true, provisioningRequired: true},
                {section: 'volume', option: 'pool', types: [''], provisioning: true},
            ]);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.click(await screen.findByRole('button', {name: /^volume/}));
            await screen.findByRole('heading', {name: /\[volume#1\]/});
            type('Value of size', '1g');
            fireEvent.click(await screen.findByRole('button', {name: 'Add pool'}));
            const pool = await screen.findByRole('combobox', {name: 'Value of pool'});
            await waitFor(() => {
                fireEvent.click(pool);
                expect(within(screen.getByRole('listbox', {name: 'The values of pool'})).getAllByRole('option').map((o) => o.textContent)).toEqual(['fastzpool5 GiB free']);
            });
        });

        test('a driver the daemon does not know: said, nothing added', async () => {
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'Add a resource'}));
            fireEvent.change(await screen.findByLabelText('Driver, as group.type'), {target: {value: 'fs.nope'}});
            fireEvent.click(within(card('[data-add-resource]')).getByRole('button', {name: 'Add a resource'}));
            expect(await screen.findByRole('alert')).toHaveTextContent('fs.nope could not be read');
        });

        test('edited as text from then on: the file of the design in the editor', async () => {
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'More'}));
            fireEvent.click(within(screen.getByRole('list', {name: 'Keywords to add'})).getByRole('button', {name: 'Add nodes'}));
            type('Value of nodes', 'n1 n2');
            fireEvent.click(screen.getByRole('button', {name: 'Edit as text'}));
            expect(card('[data-source=edit]')).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByLabelText('Configuration')).toHaveValue('[DEFAULT]\nnodes = n1 n2\n');
        });

        const ROOT_KEYWORDS = [
            {section: 'DEFAULT', option: 'nodes', grant: ''},
            {section: 'DEFAULT', option: 'priority', grant: 'root', grantAlways: true},
            {section: 'DEFAULT', option: 'monitor_action', grant: 'root', grantAlways: false},
        ];
        const offered = () => within(screen.getByRole('list', {name: 'Keywords to add'})).getAllByRole('listitem').map((li) => li.dataset.keyword);

        test('root, the keywords only root may set whatever the value hidden, those of some values offered; all shown on demand', async () => {
            KW('DEFAULT', ROOT_KEYWORDS);
            await design();
            fireEvent.click(screen.getByRole('button', {name: 'More'}));
            expect(offered()).toEqual(['monitor_action', 'nodes']);
            fireEvent.click(screen.getByRole('checkbox', {name: 'Show the keywords only root may set'}));
            expect(offered()).toEqual(['monitor_action', 'nodes', 'priority']);
        });

        test('not root: no choice; never those needing root whatever the value, those needing it for some values offered', async () => {
            grants.current = {admin: ['ns1']};
            KW('DEFAULT', ROOT_KEYWORDS);
            await design();
            expect(screen.queryByRole('checkbox', {name: 'Show the keywords only root may set'})).toBeNull();
            fireEvent.click(screen.getByRole('button', {name: 'More'}));
            expect(offered()).toEqual(['monitor_action', 'nodes']);
            // Root for some values only: said so, not as a keyword of root.
            const item = (name) => within(screen.getByRole('list', {name: 'Keywords to add'})).getAllByRole('listitem').find((li) => li.dataset.keyword === name);
            expect(item('monitor_action')).toHaveTextContent('root for some values');
        });
    });

    test('a refusal of the daemon is said in the dialog', async () => {
        answers['POST /api/object/path/ns1/svc/db/config/file?wait=30s'] = {status: 400, text: JSON.stringify({detail: 'bad keyword'})};
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        next();
        create();
        expect(await screen.findByRole('alert')).toHaveTextContent('The object could not be created: bad keyword');
        expect(onCreated).not.toHaveBeenCalled();
    });

    test('provisioned once the daemon reports the new object', async () => {
        open({defaultNamespace: 'ns1'});
        type('Name', 'db');
        next();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Provision once created'}));
        create();
        await waitFor(() => expect(posts()).toHaveLength(1));
        expect(onCreated).not.toHaveBeenCalled();
        act(() => {
            useEventStore.setState({
                objectStatus: {'ns1/svc/db': {avail: 'down'}},
                objectInstanceStatus: {'ns1/svc/db': {node1: {avail: 'down'}}},
            });
        });
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ns1/svc/db'));
        expect(posts()[1].url).toBe('/api/object/path/ns1/svc/db/action/provision');
        expect(useActionTracker.getState().tracked.map((e) => [e.action, e.subject])).toEqual(expect.arrayContaining([
            ['create', 'ns1/svc/db'],
        ]));
    });

    test('a configuration has nothing to provision', () => {
        open({defaultKind: 'cfg'});
        expect(screen.queryByRole('checkbox', {name: 'Provision once created'})).not.toBeInTheDocument();
    });
});
