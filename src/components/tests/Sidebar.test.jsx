import React from 'react';
import {render, screen, act, renderHook, within, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {describe, test, expect, beforeEach, afterEach, vi} from 'vitest';
import {Sidebar, NAV_SECTIONS, COMPACT_QUERY, menuAlert, useSidebarOpen} from '../Sidebar';
import i18n from '../../i18n';

const {mockPills} = vi.hoisted(() => ({mockPills: {current: {}}}));
vi.mock('../../hooks/useSidebarAlerts', () => ({default: () => mockPills.current}));

function renderSidebar(open = true, path = '/cluster', onNavigate) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Sidebar open={open} alerts={mockPills.current} onNavigate={onNavigate}/>
        </MemoryRouter>
    );
}

/** A window short of room or not, as matchMedia says it to the menu. */
const setCompact = (compact) => {
    window.matchMedia = vi.fn((query) => ({
        matches: compact && query === COMPACT_QUERY,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
};

const CLUSTER = ['Links', 'Nodes', 'Namespaces', 'Networks', 'Pools'];
const OBJECTS = ['Services', 'Volumes', 'Configurations', 'Secrets', 'Users'];
const section = (name) => screen.getByRole('region', {name});
/** The entries of a section: the links of its list, not its title. */
const linkNames = (element) => within(within(element).getByRole('list')).getAllByRole('link').map((link) => link.textContent);

describe('Sidebar', () => {
    beforeEach(() => {
        localStorage.clear();
        mockPills.current = {};
    });

    test('two sections: the cluster, its links, nodes, namespaces, networks and pools; the objects, their title all of them, then by kind', () => {
        renderSidebar();
        expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Cluster', 'Objects']);
        expect(linkNames(section('Cluster'))).toEqual(CLUSTER);
        expect(linkNames(section('Objects'))).toEqual(OBJECTS);
        // No "All" entry: the title of the objects opens them all; the cluster's is no link.
        expect(screen.queryByRole('link', {name: 'All'})).not.toBeInTheDocument();
        expect(within(screen.getByRole('heading', {name: 'Objects'})).getByRole('link', {name: 'Objects'})).toHaveAttribute('href', '/objects?list=any');
        expect(within(screen.getByRole('heading', {name: 'Cluster'})).queryByRole('link')).not.toBeInTheDocument();
        // The entries indented under their section title.
        for (const name of ['Cluster', 'Objects']) expect(within(section(name)).getByRole('list')).toHaveClass('ml-2', 'border-l', 'pl-1');
    });

    test('each entry where it leads: the heartbeats are the links, each list of objects its tab of the Objects page', () => {
        renderSidebar();
        const hrefs = Object.fromEntries(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]));
        expect(hrefs).toEqual({
            Links: '/heartbeats', Nodes: '/nodes', Namespaces: '/namespaces', Networks: '/network', Pools: '/pools',
            Objects: '/objects?list=any', Services: '/objects', Volumes: '/objects?list=volumes',
            Configurations: '/objects?list=configs', Secrets: '/objects?list=secrets', Users: '/objects?list=users',
        });
        // The same for every entry, from the catalog.
        for (const {entries} of NAV_SECTIONS) {
            for (const {to, labelKey} of entries) {
                expect(screen.getByRole('link', {name: i18n.t(labelKey)})).toHaveAttribute('href', to);
            }
        }
    });

    test.each([...CLUSTER, ...OBJECTS])('draws the %s entry by its name alone, no icon', (name) => {
        renderSidebar();
        const link = screen.getByRole('link', {name});
        expect(link).toHaveTextContent(new RegExp(`^${name}$`));
        expect(link.querySelector('svg')).toBeNull();
    });

    test('shows the details of an entry on mouseover', () => {
        mockPills.current = {nodes: {alert: null, details: ['2 nodes', 'frozen: 1']}};
        renderSidebar();
        expect(screen.getByRole('link', {name: 'Nodes'})).toHaveAttribute('title', '2 nodes\nfrozen: 1');
    });

    test('counts nothing: no badge while all is well, the details still on mouseover', () => {
        mockPills.current = {
            'objects-any': {alert: null},
            pools: {alert: null, details: ['1 pool', 'full: 0']},
        };
        renderSidebar();
        expect(screen.queryByTestId(/^alert-/)).toBeNull();
        expect(screen.getByRole('link', {name: 'Pools'})).toHaveAttribute('title', '1 pool\nfull: 0');
    });

    test.each([
        ['objects-any', 'Objects', 'down', 'bg-state-down', '1 object down'],
        ['objects-services', 'Services', 'warn', 'bg-state-warn', '2 objects in warn'],
        ['objects-volumes', 'Volumes', 'down', 'bg-state-down', '1 object down'],
        ['links', 'Links', 'warn', 'bg-state-warn', '1 of 4 heartbeat links down'],
        ['nodes', 'Nodes', 'down', 'bg-state-down', '2 of 2 nodes overloaded'],
    ])('%s: a %s badge in %s, what it is about in its tooltip and for screen readers', (id, name, level, tint, text) => {
        mockPills.current = {[id]: {alert: {level, text}}};
        renderSidebar();
        const badge = screen.getByTestId(`alert-${id}`);
        expect(badge).toHaveAttribute('data-level', level);
        expect(badge).toHaveClass(tint, 'rounded-full');
        expect(badge).toHaveAttribute('title', text);
        expect(screen.getByRole('img', {name: text})).toBe(badge);
        // A badge, no count: its "!" is out of the accessible name.
        expect(badge).toHaveTextContent('!');
        // Beside its entry, not in its link, which holds the name only.
        const link = screen.getByRole('link', {name});
        expect(link).not.toContainElement(badge);
        expect(link.parentElement).toContainElement(badge);
    });

    test('leaves the cluster overview and the user page to the top bar', () => {
        renderSidebar();
        expect(screen.queryByRole('link', {name: /^Cluster/})).toBeNull();
        expect(screen.queryByRole('link', {name: /^Who Am I/})).toBeNull();
    });

    test('marks the view on display', () => {
        renderSidebar(true, '/nodes');
        expect(screen.getByRole('link', {name: 'Nodes'})).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', {name: 'Namespaces'})).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('link', {name: 'Services'})).not.toHaveAttribute('aria-current');
    });

    test.each([
        ['/objects', 'Services'],
        ['/objects?list=any', 'Objects'],
        ['/objects?list=volumes&namespace=prod', 'Volumes'],
        ['/objects?list=secrets', 'Secrets'],
        ['/objects?list=bogus', 'Services'],
    ])('on %s, the %s entry alone is current: the page is the same for every list', (path, name) => {
        renderSidebar(true, path);
        const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
        expect(current.map((link) => link.textContent)).toEqual([name]);
        expect(current[0]).toHaveClass('bg-accent-soft');
    });

    test('marks the parent view on a detail page', () => {
        renderSidebar(true, '/network/default');
        expect(screen.getByRole('link', {name: 'Networks'})).toHaveAttribute('aria-current', 'page');
    });

    test('an entry chosen, or the title of the objects, tells it: the menu short of room folds then', () => {
        const onNavigate = vi.fn();
        renderSidebar(true, '/cluster', onNavigate);
        fireEvent.click(screen.getByRole('link', {name: 'Nodes'}));
        fireEvent.click(screen.getByRole('link', {name: 'Volumes'}));
        fireEvent.click(screen.getByRole('link', {name: 'Objects'}));
        expect(onNavigate).toHaveBeenCalledTimes(3);
    });

    test('the alert of the folded menu: the worst of its entries, all of them said', () => {
        expect(menuAlert({})).toBeNull();
        expect(menuAlert({nodes: {alert: null}, pools: {alert: null}})).toBeNull();
        expect(menuAlert({
            links: {alert: {level: 'warn', text: '1 of 4 heartbeat links down'}},
            'objects-any': {alert: {level: 'down', text: '1 object down'}},
            pools: {alert: null},
        })).toEqual({level: 'down', text: '1 of 4 heartbeat links down\n1 object down'});
        expect(menuAlert({links: {alert: {level: 'warn', text: 'w'}}})).toEqual({level: 'warn', text: 'w'});
    });

    test('is taken out of the keyboard path when folded', () => {
        const {container} = renderSidebar(false);
        const aside = container.querySelector('#app-sidebar');
        expect(aside).toHaveAttribute('inert');
        expect(aside).toHaveClass('w-0');
    });

    test('is open and reachable when unfolded', () => {
        const {container} = renderSidebar(true);
        const aside = container.querySelector('#app-sidebar');
        expect(aside).not.toHaveAttribute('inert');
        expect(aside).toHaveClass('w-60');
    });
});

describe('useSidebarOpen', () => {
    beforeEach(() => {
        localStorage.clear();
        delete window.matchMedia;
    });

    afterEach(() => {
        delete window.matchMedia;
    });

    test('short of room: folded by default whatever is remembered, unfolded the time to choose, the choice not remembered', () => {
        localStorage.setItem('om3.sidebar', 'open');
        setCompact(true);
        const {result} = renderHook(() => useSidebarOpen());
        expect(result.current[0]).toBe(false);
        expect(result.current[2].compact).toBe(true);
        act(() => result.current[1]());
        expect(result.current[0]).toBe(true);
        // An entry chosen: folded again.
        act(() => result.current[2].fold());
        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem('om3.sidebar')).toBe('open');
    });

    test('a wide window keeps its remembered state, an entry chosen leaving it open', () => {
        setCompact(false);
        const {result} = renderHook(() => useSidebarOpen());
        expect(result.current[0]).toBe(true);
        expect(result.current[2].compact).toBe(false);
    });

    test('is open by default and remembers the folded state', () => {
        const {result} = renderHook(() => useSidebarOpen());
        expect(result.current[0]).toBe(true);
        act(() => result.current[1]());
        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem('om3.sidebar')).toBe('closed');

        const {result: reloaded} = renderHook(() => useSidebarOpen());
        expect(reloaded.current[0]).toBe(false);
    });

    test('opens when storage is refused', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        try {
            const {result} = renderHook(() => useSidebarOpen());
            expect(result.current[0]).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('Sidebar in French', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    test('names the entries in French', async () => {
        await i18n.changeLanguage('fr');
        renderSidebar();
        expect(screen.getByRole('navigation', {name: 'Principal'})).toBeInTheDocument();
        expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Cluster', 'Objets']);
        expect(screen.getByRole('link', {name: 'Liens'})).toHaveAttribute('href', '/heartbeats');
        expect(screen.getByRole('link', {name: 'Nœuds'})).toHaveAttribute('href', '/nodes');
        expect(screen.getByRole('link', {name: 'Objets'})).toHaveAttribute('href', '/objects?list=any');
    });

    test('the arrows, Home and End walk the menu entries, not their badges; Escape leaves it', () => {
        mockPills.current = {'objects-any': {alert: {level: 'warn', text: '2 objects in warn'}}};
        renderSidebar(true, '/nodes');
        const menu = screen.getByRole('navigation', {name: 'Main'});
        expect(menu).toHaveAttribute('aria-keyshortcuts', 'n');
        const links = within(menu).getAllByRole('link');
        const objects = links.find((l) => l.textContent === 'Objects');
        act(() => objects.focus());
        fireEvent.keyDown(objects, {key: 'ArrowDown'});
        expect(links[links.indexOf(objects) + 1]).toHaveFocus();
        act(() => links[0].focus());
        fireEvent.keyDown(links[0], {key: 'ArrowDown'});
        expect(links[1]).toHaveFocus();
        fireEvent.keyDown(links[1], {key: 'ArrowUp'});
        expect(links[0]).toHaveFocus();
        fireEvent.keyDown(links[0], {key: 'End'});
        expect(links[links.length - 1]).toHaveFocus();
        fireEvent.keyDown(links[links.length - 1], {key: 'Home'});
        expect(links[0]).toHaveFocus();
        fireEvent.keyDown(links[0], {key: 'Escape'});
        expect(links[0]).not.toHaveFocus();
    });
});
