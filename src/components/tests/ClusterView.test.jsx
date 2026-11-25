import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import {MemoryRouter, useLocation} from 'react-router-dom';
import ClusterView from '../ClusterView';
import useEventStore from '../../hooks/useEventStore.js';
import {useMenuState} from '../../hooks/useSidebarAlerts';
import {resetPgUsage} from '../../hooks/usePgUsage';

const clusterNodes = vi.hoisted(() => ({current: ['n1', 'n2', 'n3']}));
vi.mock('../../hooks/useClusterNodeOrder', () => ({useClusterNodeOrder: () => clusterNodes.current}));

const beating =(peers) => ({streams: [{id: 'hb#1.rx', type: 'unicast', state: 'running', peers}]});

/** A reading of the cgroups of a node, its opensvc slice told or not. */
const pgPage = (memory, usec, told = true) => [
    `opensvc_pg_cgroup_memory_current_bytes{namespace="ns1",path="ns1/svc/web",scope="object"} 100`,
    ...(told ? [
        `opensvc_pg_cgroup_exists{namespace="",path="",scope="opensvc"} 1`,
        `opensvc_pg_cgroup_cpu_usage_usec{namespace="",path="",scope="opensvc"} ${usec}`,
        `opensvc_pg_cgroup_memory_current_bytes{namespace="",path="",scope="opensvc"} ${memory}`,
    ] : []),
].join('\n');

/** The labels beside the arcs of a ring, each its word and count. */
const labels = (ring) => [...ring.querySelectorAll('[data-label] text')].map((text) => text.textContent);

let relaySlots = [];

describe('ClusterView', () => {
    let resourcesFail;
    let storesFail;
    let pgTold;

    beforeEach(() => {
        resourcesFail = false;
        storesFail = false;
        relaySlots = [];
        pgTold = true;
        resetPgUsage();
        clusterNodes.current = ['n1', 'n2', 'n3'];
        useMenuState.setState({
            ready: true,
            objects: {
                'ns1/svc/web': {avail: 'up', overall: 'up'},
                'ns1/svc/db': {avail: 'down', overall: 'down'},
                'ns1/vol/data': {avail: 'warn'},
                'ns2/svc/api': {avail: 'n/a'},
                'svc1': {avail: 'up'},
                'cfg/shared': {},
                'cluster': {},
            },
            nodeStatus: {
                n1: {frozen_at: '2026-10-24T08:00:00Z'},
                n2: {frozen_at: '0001-01-01T00:00:00Z', is_overloaded: true},
            },
            heartbeatStatus: {
                n1: beating({n2: {is_beating: true}}),
                n2: beating({n1: {is_beating: false}}),
            },
            pools: [{name: 'default', size: 100, used: 30}, {name: 'tank', size: 100, used: 100}],
            networks: [{name: 'lo', size: 1, used: 0}, {name: 'backend', size: 256, used: 200}],
            usageReads: {pools: {read: true, error: null}, networks: {read: true, error: null}},
        });
        vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
            const u = String(url);
            const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
            if (u.startsWith('/api/store')) {
                if (storesFail) return json({detail: 'boom'}, 500);
                return json({items: [
                    {ref: 'tar1', type: 'tar', url: '/srv', share: ['*'], stats: {runs: 6, last_created_at: '2026-10-20T10:00:00Z'}},
                    {ref: 'from test/sec/stores store#tar2', type: 'tar', url: 'sftp://x', share: ['test'], stats: {runs: 11, check_error: 'refused'}},
                ]});
            }
            if (u === '/api/relay/status') return json({items: relaySlots});
            if (u.startsWith('/api/cluster/status')) {
                return json({cluster: {
                    config: {id: '82e47bfb-182f', ca_sec_paths: [`system/sec/ca-former-${new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10).replaceAll('-', '')}`]},
                    status: {is_compat: true},
                    node: {
                        n1: {status: {agent: 'v3.0.1', is_leader: true, booted_at: new Date(Date.now() - 5 * 86400000).toISOString()}, config: {env: 'DEV'},
                            daemon: {collector: {state: 'speaker', url: 'http://oc3:8080'}, daemondata: {created_at: new Date(Date.now() - 2 * 3600000).toISOString()}}},
                        n2: {status: {agent: 'v3.0.1', booted_at: new Date(Date.now() - 10 * 86400000).toISOString()}, config: {env: 'DEV'},
                            daemon: {collector: {state: 'warning', url: 'unknown'}, daemondata: {created_at: new Date(Date.now() - 3 * 3600000).toISOString()}}},
                    },
                }});
            }
            if (u.startsWith('/api/resource')) {
                if (resourcesFail) return json({detail: 'boom'}, 500);
                const r = (object, node, status) => ({meta: {object, node, rid: 'fs#1'}, data: status ? {status: {status}} : {}});
                // Down on dev n2 of ns1/svc/web, up on n1: passive, no problem; down of ns1/svc/db, down: one.
                return json({items: [r('ns1/svc/web', 'n1', 'up'), r('svc1', 'n1', 'up'), r('ns1/svc/web', 'n2', 'down'), r('ns1/svc/db', 'n1', 'down'), r('ns1/vol/data', 'n1', 'warn'), r('ns2/svc/api', 'n1')]});
            }
            const pg = u.match(/^\/api\/node\/name\/([^/]+)\/metrics\/pg$/);
            if (pg) {
                // n1 1 GiB, n2 2 GiB.
                const gib = pg[1] === 'n1' ? 1 : 2;
                return new Response(pgPage(gib * 1024 ** 3, 1000000, pgTold), {status: 200});
            }
            return json({}, 404);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const card = (id) => document.querySelector(`[data-card=${id}]`);

    test('a card a menu entry, each its name a link to its page, its count', async () => {
        render(<ClusterView/>, {wrapper: MemoryRouter});
        const cards = screen.getByRole('group', {name: 'Summary of the cluster'});
        expect([...cards.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card')))
            .toEqual(['config', 'links', 'nodes', 'opensvc', 'relay', 'arbitrators', 'objects', 'namespaces', 'networks', 'pools', 'stores', 'resources']);
        expect(within(card('pools')).getByRole('link', {name: 'Open Pools'})).toHaveAttribute('href', '/pools');
        expect(within(card('links')).getByRole('link', {name: 'Open Links'})).toHaveAttribute('href', '/heartbeats');
        expect(card('objects')).toHaveTextContent(/Objects\s*7/);
        // The whole card its link, what it holds clickable on its own above it.
        expect(within(card('nodes')).getByRole('link', {name: 'Open Nodes'})).toHaveClass('after:absolute', 'after:inset-0');
        expect(card('nodes')).toHaveClass('relative');
        expect(card('nodes').querySelector('[data-card-body]')).toHaveClass('[&_a]:relative', '[&_button]:relative');
    });

    test('what opensvc uses over the nodes reporting, then node by node; the cpu from a second reading', async () => {
        render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('opensvc').querySelector('[data-opensvc-total]')).toBeInTheDocument());
        // n1 and n2 report, n3 not: the two of them read.
        expect(global.fetch).toHaveBeenCalledWith('/api/node/name/n1/metrics/pg', expect.anything());
        expect(global.fetch).not.toHaveBeenCalledWith('/api/node/name/n3/metrics/pg', expect.anything());
        await waitFor(() => expect(card('opensvc').querySelector('[data-opensvc-total]')).toHaveTextContent(/^CPU…Memory3(\.0)? GiB$/));
        expect(card('opensvc')).toHaveTextContent('over 2 of 2 nodes');
        // Node by node, a heatmap: a cell the darker the more of the busiest node's; its figure on hover.
        const byNode = within(card('opensvc')).getByRole('table', {name: 'By node'});
        const cell = (node, metric) => byNode.querySelector(`[data-node=${node}] [data-metric=${metric}]`);
        expect(cell('n1', 'memory')).toHaveAttribute('data-level', '0.50');
        expect(cell('n2', 'memory')).toHaveAttribute('data-level', '1.00');
        // The cpu waiting for a second reading: no shade, said so.
        expect(cell('n1', 'cpu')).not.toHaveAttribute('data-level');
        // Its tree: the usage tab of the panel of the cluster.
        expect(within(card('opensvc')).getByRole('link', {name: 'Open OpenSVC usage'})).toHaveAttribute('href', '/?peek=object:cluster&peektab=usage');
    });

    test('the tasks and the io where told: in the card, the rates waiting for a second reading', async () => {
        const io = [
            'opensvc_pg_cgroup_exists{namespace="",path="",scope="opensvc"} 1',
            'opensvc_pg_cgroup_memory_current_bytes{namespace="",path="",scope="opensvc"} 1024',
            'opensvc_pg_cgroup_tasks{namespace="",path="",scope="opensvc"} 21',
            'opensvc_pg_cgroup_io_read_bytes{namespace="",path="",scope="opensvc"} 100',
        ].join('\n');
        const answer = global.fetch.getMockImplementation();
        global.fetch.mockImplementation(async (url) => (/\/metrics\/pg$/.test(String(url)) ? new Response(io, {status: 200}) : answer(url)));
        render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('opensvc').querySelector('[data-figure=tasks]')).toHaveTextContent('Tasks42'));
        expect(card('opensvc').querySelector('[data-figure=read]')).toHaveTextContent('Read/s…');
        expect(card('opensvc').querySelector('[data-figure=write]')).toBeNull();
    });

    test('the hosts told: what opensvc uses of what they use, and of what they have', async () => {
        const host = [
            'opensvc_pg_cgroup_memory_current_bytes{namespace="",path="",scope="opensvc"} 1073741824',
            'opensvc_pg_cgroup_cpu_cpus{namespace="",path="",scope="host"} 4',
            'opensvc_pg_cgroup_memory_current_bytes{namespace="",path="",scope="host"} 4294967296',
            'opensvc_pg_cgroup_memory_max_bytes{namespace="",path="",scope="host"} 8589934592',
        ].join('\n');
        const answer = global.fetch.getMockImplementation();
        global.fetch.mockImplementation(async (url) => (/\/metrics\/pg$/.test(String(url)) ? new Response(host, {status: 200}) : answer(url)));
        render(<ClusterView/>, {wrapper: MemoryRouter});
        // Two nodes: 2 GiB of the 8 GiB they use, of 16 GiB.
        await waitFor(() => expect(card('opensvc').querySelector('[data-share=memory]')).toHaveTextContent('25% of the 8 GiB the hosts use, of 16 GiB'));
        // The cpu from a second reading on.
        expect(card('opensvc').querySelector('[data-share=cpu]')).toBeNull();
    });

    test('the whole of the nodes not shown to the grants: said', async () => {
        pgTold = false;
        render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('opensvc')).toHaveTextContent('The usage of the whole nodes is not shown to your grants.'));
    });

    test('the relay: the slots held, active and stale; not a relay, said plainly, nothing in warn', async () => {
        relaySlots = [
            {relay: '', cluster_name: 'prod', nodename: 'p1', updated_at: new Date(Date.now() - 2000).toISOString()},
            {relay: '', cluster_name: 'prod', nodename: 'p2', updated_at: new Date(Date.now() - 90000).toISOString()},
        ];
        const {unmount} = render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('relay').querySelector('[data-relay-slots]')).toHaveTextContent('Active slots1Stale slots1'));
        expect(within(card('relay')).getByRole('link', {name: 'Open Relay'})).toHaveAttribute('href', '/relay');
        unmount();
        relaySlots = [];
        render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('relay')).toHaveTextContent('Not a relay: the usual case.'));
        expect(card('relay').querySelector('.text-state-warn, .text-state-down')).toBeNull();
    });

    test('the cluster configuration, a card as the others, first: the cluster object opened over the overview; frozen, said', () => {
        function Search() {
            return <output data-testid="search">{decodeURIComponent(useLocation().search)}</output>;
        }
        render(<MemoryRouter initialEntries={['/cluster']}><ClusterView/><Search/></MemoryRouter>);
        // No button acting on the page: its card, named for what it opens.
        expect(screen.queryByRole('button', {name: /configuration/i})).toBeNull();
        expect(within(card('config')).getByRole('heading')).toHaveTextContent(/^Cluster$/);
        fireEvent.click(within(card('config')).getByRole('link', {name: 'Open Cluster'}));
        expect(screen.getByTestId('search')).toHaveTextContent('peek=object:cluster');
        expect(card('config')).not.toHaveTextContent(/frozen/);
    });

    test('the cluster in a few lines: the collector fed and the nodes not linked, the agent, the uptimes, the env and id, a recent ca rotation; the words selectable, the room around them the link', async () => {
        render(<ClusterView/>, {wrapper: MemoryRouter});
        const fact = async (name) => (await waitFor(() => {
            const el = card('config').querySelector(`[data-fact=${name}]`);
            expect(el).not.toBeNull();
            return el;
        })).textContent;
        expect(await fact('collector')).toBe('Collectorhttp://oc3:8080 fed by n1.No link on n2.');
        expect(await fact('agent')).toBe('Agentv3.0.1');
        expect(await fact('daemons')).toBe('Daemonsup 2h');
        expect(await fact('nodes')).toBe('Nodesup 5d – 10d');
        expect(await fact('identity')).toBe('EnvDEV');
        expect(await fact('id')).toMatch(/^Id82e47bfb-182f/);
        expect(await fact('ca')).toMatch(/former authority still trusted$/);
        // No leader said.
        expect(card('config')).not.toHaveTextContent(/Leader/);
        // The words above the link of the card, selectable; their list lets the clicks around them through.
        expect(card('config').querySelector('dl')).toHaveClass('pointer-events-none');
    });

    test('the links, the ring of the heartbeats page; the nodes, a ring of the dropped, overloaded and optimal, the frozen said', async () => {
        render(<ClusterView/>, {wrapper: MemoryRouter});
        expect(card('links').querySelector('[data-overall]')).toHaveAttribute('data-overall', 'warn');
        expect(card('links')).toHaveTextContent('1/2');
        // n3 of the cluster configuration, not reporting: dropped.
        await waitFor(() => expect(card('nodes')).toHaveTextContent(/^Nodes3/));
        const ring = card('nodes').querySelector('[data-ring=nodes]');
        expect(ring).toHaveAttribute('data-state', 'warn');
        expect(ring).toHaveTextContent('1/3nodes optimaldegraded');
        expect([...ring.querySelectorAll('[data-arc]')].map((a) => a.getAttribute('data-arc'))).toEqual(['dropped', 'overloaded', 'optimal']);
        // Beside each arc, its word and count.
        expect(labels(ring)).toEqual(['dropped 1', 'overloaded 1', 'optimal 1']);
        expect(card('nodes')).toHaveTextContent('1 frozen');
        expect(card('nodes').querySelector('[data-node=n2]')).toHaveClass('text-state-warn');
        expect(card('nodes').querySelector('[data-node=n3]')).toHaveAttribute('data-state', 'dropped');
        expect(card('nodes').querySelector('[data-node=n3]')).toHaveClass('text-state-down');
        expect(within(card('nodes').querySelector('[data-node=n1]')).getByText(/frozen/i)).toBeInTheDocument();
    });

    test('the links, each heartbeat listed: red when none of its links beats, orange when some do not, plain when all do', () => {
        const streams = (beats) => Object.entries(beats).map(([hb, peers]) => ({id: `${hb}.rx`, type: 'unicast', state: 'running', peers}));
        useMenuState.setState({
            heartbeatStatus: {
                n1: {streams: streams({'hb#1': {n2: {is_beating: true}}, 'hb#2': {n2: {is_beating: false}}, 'hb#10': {n2: {is_beating: true}}})},
                n2: {streams: streams({'hb#1': {n1: {is_beating: false}}, 'hb#2': {n1: {is_beating: false}}, 'hb#10': {n1: {is_beating: true}}})},
            },
        });
        render(<ClusterView/>, {wrapper: MemoryRouter});
        const list = within(card('links')).getByRole('list', {name: 'Heartbeats'});
        const items = within(list).getAllByRole('listitem');
        expect(items.map((li) => [li.getAttribute('data-hb'), li.getAttribute('data-state')]))
            .toEqual([['hb#1', 'warn'], ['hb#2', 'down'], ['hb#10', 'up']]);
        // Each a badge opening its streams on the heartbeats page.
        const badge = (i) => within(items[i]).getByRole('link');
        expect(badge(0)).toHaveClass('text-state-warn');
        expect(badge(0)).toHaveTextContent(/^hb#1degraded$/);
        expect(badge(0)).toHaveAttribute('href', '/heartbeats?view=data&id=hb%231');
        expect(badge(1)).toHaveClass('text-state-down');
        expect(badge(1)).toHaveTextContent(/^hb#2critical$/);
        expect(badge(2)).not.toHaveClass('text-state-warn', 'text-state-down');
        expect(items[2]).toHaveTextContent(/^hb#10$/);
    });

    test('the arbitrators, a ring of the nodes reaching them, each named in the tint of how many do; a card of no page', () => {
        const arb = (status) => ({arb1: {url: 'https://arb1:1215', status, weight: 1}});
        useMenuState.setState((state) => ({
            nodeStatus: {
                n1: {...state.nodeStatus.n1, arbitrators: arb('up')},
                n2: {...state.nodeStatus.n2, arbitrators: arb('down')},
            },
        }));
        render(<ClusterView/>, {wrapper: MemoryRouter});
        expect(card('arbitrators')).toHaveTextContent(/^Arbitrators1/);
        expect(within(card('arbitrators')).queryByRole('link', {name: /Arbitrators/})).toBeNull();
        // n3 dropped: it reaches none.
        const ring = card('arbitrators').querySelector('[data-ring=arbitrators]');
        expect(ring).toHaveAttribute('data-state', 'warn');
        expect(ring).toHaveTextContent('1/3nodes reach itdegraded');
        expect(labels(ring)).toEqual(['not reached 2', 'up 1']);
        const item = card('arbitrators').querySelector('[data-arbitrator=arb1]');
        expect(item).toHaveClass('text-state-warn');
        expect(within(card('arbitrators')).queryByRole('alert')).toBeNull();
    });

    test.each([
        [['n1', 'n2'], true],
        [['n1', 'n2', 'n3'], false],
    ])('no arbitrator, the nodes %j: the risk of a tied quorum vote said when they are even', (names, risk) => {
        clusterNodes.current = names;
        render(<ClusterView/>, {wrapper: MemoryRouter});
        expect(card('arbitrators').querySelector('[data-ring]')).toBeNull();
        if (risk) {
            expect(within(card('arbitrators')).getByRole('alert')).toHaveTextContent('No arbitrator, and an even number of nodes (2)');
        } else {
            expect(within(card('arbitrators')).queryByRole('alert')).toBeNull();
            expect(card('arbitrators')).toHaveTextContent('No arbitrator.');
        }
    });

    test('the objects: a ring of the services and volumes by availability, no object named; the kinds counted', () => {
        render(<ClusterView/>, {wrapper: MemoryRouter});
        const ring = card('objects').querySelector('[data-ring=objects]');
        expect(ring).toHaveAttribute('data-state', 'warn');
        expect(ring).toHaveTextContent('2/5services and volumes updegraded');
        expect([...ring.querySelectorAll('[data-arc]')].map((a) => a.getAttribute('data-arc'))).toEqual(['down', 'warn', 'up', 'na']);
        expect(labels(ring)).toEqual(['down 1', 'warn 1', 'up 2', 'n/a 1']);
        expect(within(card('objects')).queryByRole('link', {name: 'ns1/svc/db'})).toBeNull();
        expect(within(card('objects')).queryByRole('button', {name: 'ns1/svc/db'})).toBeNull();
        expect(card('objects')).toHaveTextContent(/cfg1/);
        // A tile of each kind, those that run first, the configurations after.
        const kinds = [...card('objects').querySelectorAll('[data-kind]')].map((k) => k.dataset.kind);
        expect(kinds.indexOf('svc')).toBe(0);
        expect(kinds.indexOf('cfg')).toBeGreaterThan(kinds.indexOf('svc'));
        // Each count a badge opening the objects filtered on it: the services and volumes by state, the objects by kind.
        const href = (name) => within(card('objects')).getByRole('link', {name}).getAttribute('href');
        expect(href('Open the page filtered on down: 1')).toBe('/objects?list=any&kind=svc%2Cvol&globalState=down');
        expect(href('Open the page filtered on n/a: 1')).toBe('/objects?list=any&kind=svc%2Cvol&globalState=n%2Fa');
        expect(href('Open the objects of kind cfg: 1')).toBe('/objects?list=any&kind=cfg');
    });

    test('the namespaces, the busiest; the pools and networks, the fullest, the full ones counted', () => {
        render(<ClusterView/>, {wrapper: MemoryRouter});
        // ns1 its three, root its bare service, its configuration and the cluster object, as the objects list counts them.
        const busiest = within(card('namespaces')).getByRole('list', {name: 'The busiest'});
        expect(busiest).toHaveTextContent(/^ns13 objectsroot3 objectsns21 object$/);
        // The count of a namespace, its objects on the objects page.
        expect(within(busiest).getAllByRole('link', {name: '3 objects'})[0]).toHaveAttribute('href', '/objects?list=any&namespace=ns1');
        expect(card('pools')).toHaveTextContent('1 full');
        const fullest = within(card('pools')).getByRole('list', {name: 'The fullest'});
        expect(within(fullest).getAllByRole('listitem').map((li) => li.textContent.slice(0, 7))).toEqual(['tank100', 'default']);
        expect(within(card('networks')).getByRole('list', {name: 'The fullest'})).toHaveTextContent(/^backend/);
    });

    test('a namespace configuration, "ns/", of the namespace it names, no object of it, the cluster one of root, as the objects list counts them; one holding only it counted', () => {
        useMenuState.setState({
            objects: {
                'ns1/svc/web': {avail: 'up'},
                'ns1/': {},
                'ns3/': {},
                'svc1': {avail: 'up'},
                '/': {},
                'cluster': {},
            },
        });
        render(<ClusterView/>, {wrapper: MemoryRouter});
        expect(within(card('namespaces')).getByRole('list', {name: 'The busiest'}))
            .toHaveTextContent(/^root2 objectsns11 objectns30 objects$/);
        expect(within(card('namespaces')).getByRole('heading', {level: 2})).toHaveTextContent(/3$/);
    });

    test('the stores, their snapshots, the unreached said; the resources, a ring of the problems, down or in warn, and the others; a list unread said so', async () => {
        const {unmount} = render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('stores')).toHaveTextContent('17 snapshots · 1 not reached'));
        expect(within(card('stores')).getByRole('button', {name: 'tar2'})).toBeInTheDocument();
        await waitFor(() => expect(card('resources').querySelector('[data-ring=resources]')).toHaveTextContent('4/6resources without a problemdegraded'));
        // The services and volumes alone, as the Resources page reads them: a data object breaks the read.
        expect(global.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/resource'))[0])
            .toBe('/api/resource?path=*%2Fsvc%2F*%2C*%2Fvol%2F*');
        const ring = card('resources').querySelector('[data-ring=resources]');
        expect([...ring.querySelectorAll('[data-arc]')].map((a) => a.getAttribute('data-arc'))).toEqual(['down', 'warn', 'quiet', 'ok']);
        // The resource down on a passive node apart, gray, as Problems only leaves it out: every one down counted.
        expect(labels(ring)).toEqual(['down 1', 'warn 1', 'down, no issue 1', 'ok 3']);
        // The problems on the resources page filtered so; every one down, of no issue among them; the others by their statuses.
        expect(within(ring).getByRole('link', {name: 'Open the page filtered on down: 1'})).toHaveAttribute('href', '/resources?status=down&problems=1');
        expect(within(ring).getByRole('link', {name: 'Open the page filtered on warn: 1'})).toHaveAttribute('href', '/resources?status=warn&problems=1');
        expect(within(ring).getByRole('link', {name: 'Open the page filtered on down, no issue: 1'})).toHaveAttribute('href', '/resources?status=down&reason=optional%2Cdisabled%2Cstopped%2Cpassive%2Cunused');
        expect(within(ring).getByRole('link', {name: 'Open the page filtered on ok: 3'})).toHaveAttribute('href', '/resources?status=up');
        expect(within(ring).getAllByRole('link')).toHaveLength(4);
        unmount();

        resourcesFail = true;
        render(<ClusterView/>, {wrapper: MemoryRouter});
        await waitFor(() => expect(card('resources')).toHaveTextContent('Could not read the resources'));
    });

    test('the networks, the pools and the stores: no count while read, nor when not read, but why; the list last read kept', async () => {
        const count = (id) => within(card(id)).getByRole('heading', {level: 2}).textContent;
        useMenuState.setState({pools: [], networks: [], usageReads: {pools: {read: false, error: null}, networks: {read: false, error: null}}});
        let answerStores;
        global.fetch.mockImplementation(async (url) => (String(url).startsWith('/api/store')
            ? new Promise((resolve) => {
                answerStores = () => resolve(new Response(JSON.stringify({detail: 'boom'}), {status: 500}));
            })
            : new Response('{}', {status: 404})));
        render(<ClusterView/>, {wrapper: MemoryRouter});
        // Read: "Reading…", no 0.
        for (const id of ['networks', 'pools', 'stores']) {
            expect(card(id)).toHaveTextContent('Reading…');
            expect(count(id)).not.toMatch(/\d/);
        }
        expect(card('stores')).not.toHaveTextContent('0 snapshots');
        // Not read: why, no count, no "None." nor "0 snapshots".
        act(() => useMenuState.setState({usageReads: {pools: {read: false, error: 'Request failed with status code 403'}, networks: {read: false, error: 'Network Error'}}}));
        await act(async () => answerStores());
        await waitFor(() => expect(card('stores')).toHaveTextContent('Could not read the stores'));
        expect(card('networks')).toHaveTextContent('Could not read the networks: Network Error');
        expect(card('pools')).toHaveTextContent('Could not read the pools: Request failed with status code 403');
        for (const id of ['networks', 'pools', 'stores']) {
            expect(card(id)).not.toHaveTextContent('Reading…');
            expect(count(id)).not.toMatch(/\d/);
        }
        expect(card('pools')).not.toHaveTextContent('None.');
        expect(card('stores')).not.toHaveTextContent('0 snapshots');
        // Read once, then not: the list last read kept, counted, why the last read failed said over it.
        act(() => useMenuState.setState({
            pools: [{name: 'tank', size: 100, used: 100}],
            usageReads: {pools: {read: true, error: 'Network Error'}, networks: {read: false, error: 'Network Error'}},
        }));
        expect(count('pools')).toMatch(/1$/);
        expect(card('pools')).toHaveTextContent('Could not read the pools: Network Error');
        expect(card('pools')).toHaveTextContent('1 full');
    });

    test('a resource down of an instance stopped on purpose: no problem, as the status board tells it', async () => {
        useEventStore.setState({objectInstanceStatus: {'ns1/svc/db': {n1: {avail: 'down', stopped_at: '2026-11-10T10:00:00Z'}}}});
        try {
            render(<ClusterView/>, {wrapper: MemoryRouter});
            await waitFor(() => expect(labels(card('resources').querySelector('[data-ring=resources]'))).toEqual(['warn 1', 'down, no issue 2', 'ok 3']));
        } finally {
            useEventStore.setState({objectInstanceStatus: {}});
        }
    });

    test('a resource down on a node whose instance reports up: a problem, as the Resources page tells it', async () => {
        useEventStore.setState({objectInstanceStatus: {'ns1/svc/web': {n2: {avail: 'up'}}}});
        try {
            render(<ClusterView/>, {wrapper: MemoryRouter});
            await waitFor(() => expect(labels(card('resources').querySelector('[data-ring=resources]'))).toEqual(['down 2', 'warn 1', 'ok 3']));
        } finally {
            useEventStore.setState({objectInstanceStatus: {}});
        }
    });
});
