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
    mockFetchNodes,
    mockUseAuth,
    mockUseOidc,
    mockUseFetchDaemonStatus,
    mockUseOnlineStatus,
    mockUseEventStore,
} = vi.hoisted(() => {
    const mockNavigate = vi.fn();
    const mockUseNavigate = vi.fn(() => mockNavigate);
    const mockUseLocation = vi.fn(() => ({pathname: '/cluster'}));
    const mockAuthDispatch = vi.fn();
    const mockFetchNodes = vi.fn();
    const mockUseAuth = vi.fn();
    const mockUseOidc = vi.fn();
    const mockUseFetchDaemonStatus = vi.fn();
    const mockUseOnlineStatus = vi.fn();
    const mockUseEventStore = vi.fn();

    return {
        mockNavigate,
        mockUseNavigate,
        mockUseLocation,
        mockAuthDispatch,
        mockFetchNodes,
        mockUseAuth,
        mockUseOidc,
        mockUseFetchDaemonStatus,
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

vi.mock('../../hooks/useFetchDaemonStatus', () => ({
    __esModule: true,
    default: mockUseFetchDaemonStatus,
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
        clusterName = null,
        loading = false,
        daemon = null,
        fetchNodes = mockFetchNodes,
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
    mockUseFetchDaemonStatus.mockReturnValue({
        clusterName,
        fetchNodes,
        loading,
        daemon,
    });
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
        vi.unstubAllEnvs();
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
        expect(badge).toHaveAttribute('title', '1 object down');
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
        setupMocks({pathname: '/login', authToken: null, fetchNodes: undefined});
        renderNavBar();
        expect(screen.queryByRole('link', {name: /navigate to/i})).not.toBeInTheDocument();
    });

    describe('breadcrumbs', () => {
        const cases = [
            ['/cluster/node1/pod1', ['Cluster', 'node1', 'pod1']],
            ['/network/eth0', ['Cluster', 'network', 'eth0']],
            ['/network', ['Cluster', 'network']],
            ['/objects/vol1', ['Cluster', 'objects', 'vol1']],
            ['/objects', ['Cluster', 'objects']],
            ['/namespaces/ns1', ['Cluster', 'namespaces', 'ns1']],
            ['/namespaces/cluster/objects', ['Cluster', 'namespaces', 'objects']],
        ];
        test.each(cases)('path %s shows breadcrumbs %s', (pathname, expectedParts) => {
            setupMocks({pathname, authToken: null, fetchNodes: undefined});
            renderNavBar();
            expectedParts.forEach((part) => {
                expect(screen.getByRole('link', {name: new RegExp(`navigate to ${part}`, 'i')})).toBeInTheDocument();
            });
            if (expectedParts.length > 1) {
                expect(screen.getAllByText('>')).toHaveLength(expectedParts.length - 1);
            }
        });

        test('renders node as plain text (not link) for /nodes/.../objects path', () => {
            const pathname = '/nodes/node1/objects/myobj';
            setupMocks({pathname, authToken: null, fetchNodes: undefined});
            renderNavBar();
            expect(screen.getByRole('link', {name: /navigate to cluster/i})).toBeInTheDocument();
            expect(screen.getByRole('link', {name: /navigate to objects/i})).toBeInTheDocument();
            expect(screen.getByRole('link', {name: /navigate to myobj/i})).toBeInTheDocument();
            expect(screen.getByText('node1')).toBeInTheDocument();
            expect(screen.queryByRole('link', {name: /navigate to node1/i})).not.toBeInTheDocument();
            expect(screen.getAllByText('>')).toHaveLength(3);
        });
    });

    // ---------- fetchNodes behavior ----------
    describe('fetchNodes', () => {
        test('calls fetchNodes when token is present and clusterName is null', async () => {
            setupMocks({clusterName: null, fetchNodes: mockFetchNodes});
            renderNavBar();
            await waitFor(() => expect(mockFetchNodes).toHaveBeenCalledWith('test-token'));
        });

        test('does not call fetchNodes when token is absent', async () => {
            setupMocks({authToken: null, fetchNodes: mockFetchNodes});
            renderNavBar();
            expect(screen.getByRole('link', {name: /navigate to cluster/i})).toBeInTheDocument();
            expect(mockFetchNodes).not.toHaveBeenCalled();
        });

        test('retries when token appears later', async () => {
            let calls = 0;
            mockUseAuth.mockImplementation(() => ({
                authChoice: 'local',
                get authToken() {
                    calls++;
                    return calls === 1 ? null : 'delayed-token';
                },
            }));
            setupMocks({clusterName: null, fetchNodes: mockFetchNodes, skipAuthMock: true});
            vi.useFakeTimers();
            renderNavBar();
            vi.advanceTimersByTime(1000);
            await waitFor(() => expect(mockFetchNodes).toHaveBeenCalledWith('delayed-token'));
            vi.useRealTimers();
        });

        test('stops retrying after max attempts', async () => {
            setupMocks({authToken: null, fetchNodes: mockFetchNodes});
            vi.useFakeTimers();
            renderNavBar();
            vi.advanceTimersByTime(3000);
            await waitFor(() => expect(mockFetchNodes).not.toHaveBeenCalled());
            vi.useRealTimers();
        });

        test('handles fetchNodes errors', async () => {
            const errorFn = vi.fn().mockRejectedValue(new Error('fail'));
            setupMocks({fetchNodes: errorFn});
            renderNavBar();
            await waitFor(() => expect(errorFn).toHaveBeenCalled());
        });

        test('ignores fetchNodes if it is not a function', async () => {
            setupMocks({fetchNodes: null});
            renderNavBar();
            expect(screen.getByRole('link', {name: /view user information/i})).toBeInTheDocument();
        });

        test('shows cluster name after fetchNodes resolves', async () => {
            const fetchNodesMock = vi.fn().mockResolvedValue();
            setupMocks({fetchNodes: fetchNodesMock, clusterName: 'My Cluster', loading: false});
            renderNavBar();
            await waitFor(() => {
                expect(screen.getByRole('link', {name: /navigate to my cluster/i})).toBeInTheDocument();
            });
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
        expect(badge).toHaveAttribute('title', 'You are offline — some features may be limited');
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

    test('configured AI assistant is reached from the top bar', () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        renderNavBar();
        expect(screen.getByRole('link', {name: 'Open the AI assistant'})).toHaveAttribute('href', '/ai');
    });

    test('AI assistant is hidden from the top bar when not configured', () => {
        vi.stubEnv('VITE_AI_AGENT_URL', '');
        renderNavBar();
        expect(screen.queryByRole('link', {name: 'Open the AI assistant'})).not.toBeInTheDocument();
    });
});
