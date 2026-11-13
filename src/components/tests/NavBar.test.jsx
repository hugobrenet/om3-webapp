import React from 'react';
import {render, screen, fireEvent, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import NavBar from '../NavBar';

// ── Hoisted variables ───────────────────────────────────────────────────
const {
    mockNavigate,
    mockUseNavigate,
    mockUseLocation,
    mockAuthDispatch,
    mockUseAuth,
    mockUseOidc,
    mockUseClusterConfig,
    mockUseOnlineStatus,
    mockUseEventStore,
} = vi.hoisted(() => {
    const mockNavigate = vi.fn();
    const mockUseNavigate = vi.fn(() => mockNavigate);
    const mockUseLocation = vi.fn(() => ({pathname: '/cluster'}));
    const mockAuthDispatch = vi.fn();
    const mockUseAuth = vi.fn();
    const mockUseOidc = vi.fn();
    const mockUseClusterConfig = vi.fn();
    const mockUseOnlineStatus = vi.fn();
    const mockUseEventStore = vi.fn();

    return {
        mockNavigate,
        mockUseNavigate,
        mockUseLocation,
        mockAuthDispatch,
        mockUseAuth,
        mockUseOidc,
        mockUseClusterConfig,
        mockUseOnlineStatus,
        mockUseEventStore,
    };
});

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: mockUseNavigate,
        useLocation: mockUseLocation,
    };
});

vi.mock('../../context/OidcAuthContext.tsx', () => ({
    useOidc: mockUseOidc,
}));

vi.mock('../../context/AuthProvider.jsx', () => ({
    useAuth: mockUseAuth,
    useAuthDispatch: () => mockAuthDispatch,
    Logout: 'LOGOUT',
}));

// The configuration of the cluster, as the event stream of the menu keeps it.
vi.mock('../../hooks/useClusterConfig.js', () => ({
    __esModule: true,
    default: mockUseClusterConfig,
}));

vi.mock('../../hooks/useEventStore.js', () => ({
    __esModule: true,
    default: mockUseEventStore,
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
    __esModule: true,
    default: mockUseOnlineStatus,
}));

vi.mock('../../utils/logger.js', () => ({
    default: {
        error: vi.fn(),
    },
}));

// ── Setup helpers ───────────────────────────────────────────────────────
function setupMocks(overrides = {}) {
    const {
        pathname = '/cluster',
        authChoice = 'local',
        authToken = 'test-token',
        clusterName = '',
        agentUrl = '',
        loaded = true,
        online = true,
        eventStoreData = {objectStatus: {}, objectInstanceStatus: {}, instanceMonitor: {}},
        skipAuthMock = false,
    } = overrides;

    mockUseLocation.mockReturnValue({pathname});
    if (!skipAuthMock) {
        mockUseAuth.mockReturnValue({authChoice, authToken});
    }
    mockUseOidc.mockReturnValue({
        userManager: {signoutRedirect: vi.fn(), removeUser: vi.fn()},
    });
    mockUseClusterConfig.mockReturnValue({clusterId: loaded ? 'cluster-id' : '', clusterName, agentUrl, loaded});
    mockUseOnlineStatus.mockReturnValue(online);
    mockUseEventStore.mockImplementation((selector) => selector(eventStoreData));
    localStorage.clear();
}

function renderNavBar(props = {}) {
    return render(
        <MemoryRouter>
            <NavBar {...props}/>
        </MemoryRouter>
    );
}

// ── Tests ───────────────────────────────────────────────────────────────
describe('NavBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupMocks();
    });

    afterEach(() => {
        vi.useRealTimers?.();
    });

    test('the cluster tag left out of the bar short of room, below 1200px as the menu folds; the product name in the About page, not the bar', () => {
        renderNavBar();
        const brand = screen.getByTestId('brand');
        expect(brand).toHaveClass('hidden', 'min-[1200px]:flex');
        expect(brand).toHaveTextContent(/^Cluster$/);
        expect(screen.queryByText('OpenSVC')).toBeNull();
    });

    test('folded, the menu button carries the alert of its entries; open, none', () => {
        const alert = {level: 'down', text: '1 object down'};
        const {unmount} = renderNavBar({showSidebarToggle: true, sidebarOpen: false, menuAlert: alert});
        const button = screen.getByRole('button', {name: 'Show menu'});
        const badge = within(button).getByTestId('menu-alert');
        expect(badge).toHaveAttribute('data-level', 'down');
        unmount();
        renderNavBar({showSidebarToggle: true, sidebarOpen: true, menuAlert: null});
        expect(screen.queryByTestId('menu-alert')).not.toBeInTheDocument();
    });

    test('renders cluster breadcrumb and WhoAmI link on /cluster', () => {
        renderNavBar();
        expect(screen.getByRole('link', {name: /navigate to cluster/i})).toHaveAttribute('href', '/');
        expect(screen.getByRole('link', {name: /view user information/i})).toBeInTheDocument();
    });

    test('the Cluster tag a label of this frontend, not a link: Cluster in the menu alone opens the overview', () => {
        mockUseLocation.mockReturnValue({pathname: '/objects', search: '?globalState=down'});
        renderNavBar();
        const brand = screen.getByTestId('brand');
        expect(brand).toHaveTextContent(/^Cluster$/);
        expect(within(brand).queryAllByRole('link')).toEqual([]);
    });

    test('does not show breadcrumbs on /login', () => {
        setupMocks({pathname: '/login', authToken: null});
        renderNavBar();
        expect(screen.queryByRole('link', {name: /navigate to/i})).not.toBeInTheDocument();
    });

    describe('breadcrumbs', () => {
        const cases = [
            ['/cluster/node1/pod1', ['Cluster', 'node1', 'pod1']],
            ['/network/eth0', ['Cluster', 'Networks', 'eth0']],
            ['/network', ['Cluster', 'Networks']],
            ['/objects/vol1', ['Cluster', 'Objects', 'vol1']],
            ['/objects', ['Cluster', 'Objects']],
            ['/namespaces/ns1', ['Cluster', 'Namespaces', 'ns1']],
            ['/namespaces/cluster/objects', ['Cluster', 'Namespaces', 'objects']],
            // Named as the menu names them, else by their own title, not by their address.
            ['/heartbeats', ['Cluster', 'Links']],
            ['/whoami', ['Cluster', 'Account']],
            ['/ai', ['Cluster', 'AI Assistant']],
            ['/token', ['Cluster', 'Token']],
            ['/auth/login', ['Cluster', 'Login']],
        ];
        test.each(cases)('path %s shows breadcrumbs %s', (pathname, expectedParts) => {
            setupMocks({pathname, authToken: null});
            renderNavBar();
            expectedParts.forEach((part) => {
                expect(screen.getByRole('link', {name: `Navigate to ${part}`})).toBeInTheDocument();
            });
            if (expectedParts.length > 1) {
                expect(screen.getAllByText('>')).toHaveLength(expectedParts.length - 1);
            }
        });

        test('renders node as plain text (not link) for /nodes/.../objects path', () => {
            const pathname = '/nodes/node1/objects/myobj';
            setupMocks({pathname, authToken: null});
            renderNavBar();
            expect(screen.getByRole('link', {name: /navigate to cluster/i})).toBeInTheDocument();
            expect(screen.getByRole('link', {name: /navigate to objects/i})).toBeInTheDocument();
            expect(screen.getByRole('link', {name: /navigate to myobj/i})).toBeInTheDocument();
            expect(screen.getByText('node1')).toBeInTheDocument();
            expect(screen.queryByRole('link', {name: /navigate to node1/i})).not.toBeInTheDocument();
            expect(screen.getAllByText('>')).toHaveLength(3);
        });
    });

    // ---------- name of the cluster ----------
    describe('name of the cluster', () => {
        test('reads it from the configuration of the cluster, without reading the cluster status', () => {
            setupMocks({clusterName: 'My Cluster'});
            renderNavBar();
            expect(screen.getByRole('link', {name: /navigate to my cluster/i})).toBeInTheDocument();
        });

        test('says Loading while the configuration of the cluster is not read, in a session', () => {
            setupMocks({loaded: false});
            renderNavBar();
            expect(screen.getByRole('link', {name: /navigate to loading/i})).toBeInTheDocument();
        });

        test('says Cluster out of a session', () => {
            setupMocks({authToken: null, loaded: false});
            renderNavBar();
            expect(screen.getByRole('link', {name: /navigate to cluster/i})).toBeInTheDocument();
        });
    });

    // ---------- object status counts ----------
    test('is the oc3 top bar, in the om3 band colour: a 44px header with a breadcrumb navigation', () => {
        renderNavBar();
        const header = screen.getByRole('banner');
        expect(header).toHaveClass('brand-bar', 'h-11', 'border-b', 'border-line');
        expect(header).not.toHaveClass('bg-surface-raised');
        expect(screen.getByRole('navigation', {name: 'Breadcrumb'})).toBeInTheDocument();
    });

    test('shows offline with a hint and a glyph, not colour alone', () => {
        setupMocks({online: false});
        renderNavBar();
        const badge = screen.getByText('Offline');
        expect(badge.querySelector('svg')).toHaveAttribute('data-glyph', 'down');
    });

    test('shows no object status counts: they moved to the sidebar pills', () => {
        setupMocks({
            eventStoreData: {
                objectStatus: {a: {avail: 'down'}, b: {avail: 'warn'}},
                objectInstanceStatus: {},
                instanceMonitor: {},
            },
        });
        renderNavBar();
        expect(document.querySelector('[href^="/objects?globalState="]')).toBeNull();
    });

    // ---------- logo ----------
    test('names the tab after the cluster, tagged Cluster, not to be taken for oc3', async () => {
        setupMocks({clusterName: 'dev3'});
        renderNavBar();
        await waitFor(() => expect(document.title).toBe('dev3 · OpenSVC Cluster'));
    });

    // ---------- sidebar toggle ----------
    test('shows no sidebar toggle unless asked to', () => {
        renderNavBar();
        expect(screen.queryByRole('button', {name: /menu/i})).not.toBeInTheDocument();
    });

    test('sidebar toggle announces the sidebar state and calls onToggleSidebar', () => {
        const onToggleSidebar = vi.fn();
        const {rerender} = render(
            <MemoryRouter>
                <NavBar sidebarOpen showSidebarToggle onToggleSidebar={onToggleSidebar}/>
            </MemoryRouter>
        );
        const toggle = screen.getByRole('button', {name: /hide menu/i});
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
        fireEvent.click(toggle);
        expect(onToggleSidebar).toHaveBeenCalledTimes(1);

        rerender(
            <MemoryRouter>
                <NavBar sidebarOpen={false} showSidebarToggle onToggleSidebar={onToggleSidebar}/>
            </MemoryRouter>
        );
        expect(screen.getByRole('button', {name: /show menu/i})).toHaveAttribute('aria-expanded', 'false');
    });

    // ---------- online status ----------
    test('shows offline when not online', () => {
        setupMocks({online: false});
        renderNavBar();
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    test('does not show offline when online', () => {
        renderNavBar();
        expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    });

    // ---------- WhoAmI link ----------
    test('WhoAmI button navigates to /whoami', () => {
        renderNavBar();
        expect(screen.getByRole('link', {name: /view user information/i})).toHaveAttribute('href', '/whoami');
    });

    test('no button for the shortcuts, which read as a help: the "?" key opens them', () => {
        render(<MemoryRouter><NavBar showSidebarToggle/></MemoryRouter>);
        expect(screen.queryByRole('button', {name: /shortcuts/i})).not.toBeInTheDocument();
        expect(document.querySelector('[aria-keyshortcuts="?"]')).toBeNull();
    });

    // The cluster status names the agent of the cluster: the entry shows for it,
    // to an OpenID session, the only one the agent takes.
    test.each([
        ['shows for a cluster with an agent, to an OpenID session', 'https://agent.example.com', 'openid', true],
        ['is hidden for a cluster without agent', '', 'openid', false],
        ['is hidden for a session not OpenID', 'https://agent.example.com', 'basic', false],
        ['is hidden for an agent URL not HTTPS', 'http://agent.example.com', 'openid', false],
    ])('the AI assistant entry of the top bar %s', (_name, agentUrl, authChoice, shown) => {
        setupMocks({agentUrl, authChoice});
        renderNavBar();
        const link = screen.queryByRole('link', {name: 'Open the AI assistant'});
        if (shown) expect(link).toHaveAttribute('href', '/ai');
        else expect(link).not.toBeInTheDocument();
    });
});
