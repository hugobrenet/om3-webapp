import React from 'react';
import {fireEvent, render, screen, waitFor, act, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import App from '../App';
import {vi} from 'vitest';
import logger from '../../utils/logger.js';
import oidcConfiguration from '../../config/oidcConfiguration.js';
import {decodeToken} from '../Login';
import {__setMockRecreateUserManager, __setMockIsInitialized} from '../../context/OidcAuthContext.tsx';

// --- Mocks ---
vi.mock('../../styles/main.css', () => ({}));
vi.mock('../../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
// The records the anchor would bring back: the gutter of the views follows them.
const {mockHistory} = vi.hoisted(() => ({mockHistory: {entries: []}}));
vi.mock('../../app/record-history', async (importOriginal) => ({
    ...(await importOriginal()),
    useRecordHistory: () => mockHistory,
}));
vi.mock('../NavBar', () => ({default: ({anchor}) => <div data-testid="navbar">NavBar{anchor}</div>}));
vi.mock('../../hooks/useSidebarAlerts', () => ({default: () => ({})}));
vi.mock('../ClusterView', () => ({default: () => <div data-testid="cluster">ClusterView</div>}));
vi.mock('../NodesTable', () => ({default: () => <div data-testid="nodes">NodesTable</div>}));
vi.mock('../Heartbeats', () => ({default: () => <div data-testid="heartbeats">Heartbeats</div>}));
vi.mock('../Pools', () => ({default: () => <div data-testid="pools">Pools</div>}));
// The lists show the query of their address: the panel state they were given.
vi.mock('../Objects', async () => {
    const {useLocation} = await vi.importActual('react-router-dom');
    return {default: () => <div data-testid="objects">{useLocation().search}</div>};
});
vi.mock('../Namespaces', async () => {
    const {useLocation} = await vi.importActual('react-router-dom');
    return {default: () => <div data-testid="namespaces">{useLocation().search}</div>};
});
vi.mock('../Network', async () => {
    const {useLocation} = await vi.importActual('react-router-dom');
    return {default: () => <div data-testid="network">{useLocation().search}</div>};
});
vi.mock('../PeekPanel', () => ({PeekPanel: () => <div data-testid="peek-panel"/>}));
vi.mock('../../app/PanelReopenKey', () => ({PanelReopenKey: () => <div data-testid="panel-reopen-key"/>}));
vi.mock('../../app/ShortcutsHelp', () => ({ShortcutsHelp: () => <div data-testid="shortcuts-help"/>}));
vi.mock('../WhoAmI', () => ({default: () => <div data-testid="whoami">WhoAmI</div>}));
vi.mock('../AiChat', () => ({default: () => <div data-testid="ai-chat">AI Assistant</div>}));
vi.mock('../SilentRenew.jsx', () => ({default: () => <div data-testid="silent-renew">SilentRenew</div>}));
vi.mock('../AuthChoice.jsx', () => ({default: () => <div data-testid="auth-choice">AuthChoice</div>}));
vi.mock('../OidcCallback', () => ({default: () => <div data-testid="auth-callback">OidcCallback</div>}));
vi.mock('../Login', () => ({
    __esModule: true,
    default: () => <div data-testid="login">Login</div>,
    decodeToken: vi.fn(),
    refreshToken: vi.fn(),
}));
vi.mock('../../hooks/AuthInfo.jsx', () => ({
    default: vi.fn(() => ({
        openid: {issuer: 'https://test-issuer.com', client_id: 'test-client'},
    })),
}));
vi.mock('../../config/oidcConfiguration.js', () => ({
    default: vi.fn(() => Promise.resolve({
        client_id: 'test-client',
        authority: 'https://test-issuer.com',
        scope: 'openid profile email',
    })),
}));
vi.mock('../../context/AuthProvider', () => ({
    AuthProvider: ({children}) => <div>{children}</div>,
    useAuth: () => mockAuthState,
    useAuthDispatch: () => mockAuthDispatch,
    SetAccessToken: 'SetAccessToken',
    SetAuthChoice: 'SetAuthChoice',
    Login: 'Login',
}));
vi.mock('../../context/OidcAuthContext.tsx', () => ({
    OidcProvider: ({children}) => <div>{children}</div>,
    useOidc: () => ({
        userManager: mockUserManager,
        recreateUserManager: mockRecreateUserManager,
        isInitialized: mockIsInitialized,
    }),
    __setMockRecreateUserManager: (fn) => {
        mockRecreateUserManager = fn;
    },
    __setMockIsInitialized: (v) => {
        mockIsInitialized = v;
    },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

const mockAuthDispatch = vi.fn();
const mockAuthState = {user: null, isAuthenticated: false, authChoice: null, authInfo: null, accessToken: null};
let mockUserManager = {
    getUser: vi.fn(() => Promise.resolve(null)),
    signinSilent: vi.fn(() => Promise.resolve(null)),
    events: {
        addUserLoaded: vi.fn(),
        addAccessTokenExpiring: vi.fn(),
        addAccessTokenExpired: vi.fn(),
        addSilentRenewError: vi.fn(),
        removeUserLoaded: vi.fn(),
        removeAccessTokenExpired: vi.fn(),
        removeSilentRenewError: vi.fn(),
    },
};
let mockRecreateUserManager = vi.fn();
let mockIsInitialized = true;

const mockLocalStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {value: mockLocalStorage});

const consoleSpy = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {
    }),
    error: vi.spyOn(console, 'error').mockImplementation(() => {
    }),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {
    }),
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {
    }),
};

// --- Helpers ---
const makeTokenWithExp = (expSecondsFromNow) => {
    const payload = {exp: Math.floor(Date.now() / 1000) + expSecondsFromNow};
    return 'h.' + btoa(JSON.stringify(payload)) + '.s';
};

const renderApp = (initialEntries = ['/']) => render(
    <MemoryRouter initialEntries={initialEntries}>
        <App/>
    </MemoryRouter>
);

const setupBasicAuth = (tokenExpOffset = 3600) => {
    const token = makeTokenWithExp(tokenExpOffset);
    mockLocalStorage.getItem.mockImplementation((k) =>
        k === 'authToken' ? token : k === 'authChoice' ? 'basic' : null
    );
    decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + tokenExpOffset});
    return token;
};

const setupOidcAuth = (token = 'dummy') => {
    mockLocalStorage.getItem.mockImplementation((k) =>
        k === 'authToken' ? token : k === 'authChoice' ? 'openid' : null
    );
    mockAuthState.authChoice = 'openid';
};

// --- Tests ---
describe('App Component', () => {
    beforeEach(() => {
        vi.useRealTimers();
        mockAuthDispatch.mockClear();
        mockLocalStorage.getItem.mockClear().mockReturnValue(null);
        mockLocalStorage.setItem.mockClear().mockImplementation(() => {
        });
        mockLocalStorage.removeItem.mockClear();
        decodeToken.mockClear();
        mockNavigate.mockClear();
        oidcConfiguration.mockClear();
        Object.values(consoleSpy).forEach(spy => spy.mockClear());
        Object.values(logger).forEach(fn => fn.mockClear());
        mockAuthState.authChoice = null;
        mockAuthState.accessToken = null;
        mockAuthState.isAuthenticated = false;
        mockUserManager.getUser.mockResolvedValue(null);
        mockUserManager.signinSilent.mockResolvedValue(null);
        Object.values(mockUserManager.events).forEach(fn => fn.mockClear?.());
        mockRecreateUserManager = vi.fn();
        __setMockRecreateUserManager(mockRecreateUserManager);
        __setMockIsInitialized(true);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    // --- Routing ---
    test('renders NavBar and redirects / to the cluster overview', async () => {
        setupBasicAuth();
        renderApp(['/']);
        expect(await screen.findByTestId('navbar')).toBeInTheDocument();
        expect(await screen.findByTestId('cluster')).toBeInTheDocument();
    });

    test('shows the sidebar beside the views', async () => {
        setupBasicAuth();
        renderApp(['/objects']);
        expect(await screen.findByTestId('objects')).toBeInTheDocument();
        expect(screen.getByRole('navigation', {name: 'Main'})).toBeInTheDocument();
    });

    test('shows the cluster overview at /cluster', async () => {
        setupBasicAuth();
        renderApp(['/cluster']);
        expect(await screen.findByTestId('cluster')).toBeInTheDocument();
    });

    test('shows no sidebar on the sign-in screens', async () => {
        renderApp(['/auth-choice']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(screen.queryByRole('navigation', {name: 'Main'})).not.toBeInTheDocument();
    });

    test('unknown route redirects to the cluster overview', async () => {
        setupBasicAuth();
        renderApp(['/unknown-route']);
        expect(await screen.findByTestId('cluster')).toBeInTheDocument();
    });

    test.each([
        ['/nodes', 'nodes'],
        ['/pools', 'pools'],
        ['/network', 'network'],
        ['/objects', 'objects'],
        ['/namespaces', 'namespaces'],
        ['/whoami', 'whoami'],
    ])('protected route %s renders %s', async (path, testId) => {
        setupBasicAuth();
        const {unmount} = renderApp([path]);
        expect(await screen.findByTestId(testId)).toBeInTheDocument();
        unmount();
    });

    // The records had pages of their own: their old addresses open the panel over the list.
    test.each([
        ['/objects/ns1%2Fsvc%2Fweb', 'objects', '?sel=ns1%2Fsvc%2Fweb'],
        ['/network/test-network', 'network', '?sel=test-network'],
        ['/nodes/node1/objects/ns1%2Fsvc%2Fweb', 'objects', '?sel=ns1%2Fsvc%2Fweb'],
        // The kinds page is the All tab of the Objects page, its filter kept.
        ['/kinds?kind=sec', 'objects', '?kind=sec&list=any'],
        // The former namespaces tab is the Namespaces view, the namespace open in it kept.
        ['/objects?list=namespaces&sel=prod&tab=claims', 'namespaces', '?sel=prod&tab=claims'],
    ])('old record address %s opens the panel over %s', async (path, testId, search) => {
        setupBasicAuth();
        const {unmount} = renderApp([path]);
        expect(await screen.findByTestId(testId)).toHaveTextContent(search);
        unmount();
    });

    test('n moves the focus to the menu, on the entry of the view, unfolding it first', async () => {
        const token = setupBasicAuth();
        // The menu folded: "n" unfolds it.
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'om3.sidebar' ? 'closed' : k === 'authToken' ? token : k === 'authChoice' ? 'basic' : null);
        renderApp(['/nodes']);
        await screen.findByTestId('nodes');
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            cb(0);
            return 0;
        });
        fireEvent.keyDown(document.body, {key: 'n'});
        expect(document.getElementById('app-sidebar')).not.toHaveAttribute('inert');
        expect(screen.getByRole('link', {name: 'Nodes'})).toHaveFocus();
        raf.mockRestore();
    });

    test('the record panel and the key bringing it back stand over the views, not over the sign-in', async () => {
        setupBasicAuth();
        const {unmount} = renderApp(['/objects']);
        expect(await screen.findByTestId('peek-panel')).toBeInTheDocument();
        expect(screen.getByTestId('panel-reopen-key')).toBeInTheDocument();
        expect(screen.getByTestId('shortcuts-help')).toBeInTheDocument();
        unmount();
        renderApp(['/auth/login']);
        expect(await screen.findByTestId('login')).toBeInTheDocument();
        expect(screen.queryByTestId('peek-panel')).not.toBeInTheDocument();
    });

    test.each([
        ['/silent-renew', 'silent-renew'],
        ['/auth-callback', 'auth-callback'],
        ['/auth-choice', 'auth-choice'],
        ['/auth/login', 'login'],
    ])('unprotected route %s renders %s', async (path, testId) => {
        const {unmount} = renderApp([path]);
        expect(await screen.findByTestId(testId)).toBeInTheDocument();
        unmount();
    });

    // --- ProtectedRoute ---
    test('ProtectedRoute: valid basic token shows content', async () => {
        setupBasicAuth();
        renderApp(['/objects']);
        expect(await screen.findByTestId('objects')).toBeInTheDocument();
    });

    test('ProtectedRoute: expired basic token redirects and clears storage', async () => {
        setupBasicAuth(-3600);
        renderApp(['/objects']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('tokenExpiration');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authChoice');
    });

    test('ProtectedRoute: the heartbeats shown signed in, the sign-in asked without a token', async () => {
        setupBasicAuth();
        const {unmount} = renderApp(['/heartbeats']);
        expect(await screen.findByTestId('heartbeats')).toBeInTheDocument();
        unmount();
        mockLocalStorage.getItem.mockImplementation(() => null);
        renderApp(['/heartbeats']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(screen.queryByTestId('heartbeats')).not.toBeInTheDocument();
    });

    test('ProtectedRoute: null token + null authChoice redirects', async () => {
        renderApp(['/objects']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
    });

    test('ProtectedRoute: OIDC without token redirects', async () => {
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authChoice' ? 'openid' : null
        );
        renderApp(['/objects']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
    });

    test('ProtectedRoute: OIDC with malformed token still renders', async () => {
        setupOidcAuth('not-a-valid-jwt');
        decodeToken.mockReturnValue(null);
        renderApp(['/objects']);
        expect(await screen.findByTestId('objects')).toBeInTheDocument();
    });

    test('ProtectedRoute: null token + null authChoice clears storage', async () => {
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authToken' ? makeTokenWithExp(-3600) : k === 'authChoice' ? null : null
        );
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        renderApp(['/objects']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
    });

    // --- OIDC Initialization ---
    test('initializeOidcOnStartup calls oidcConfiguration and recreateUserManager when not initialized', async () => {
        __setMockIsInitialized(false);
        setupOidcAuth(makeTokenWithExp(3600));
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 3600});
        renderApp(['/objects']);
        await waitFor(() => expect(oidcConfiguration).toHaveBeenCalled());
        await waitFor(() => expect(mockRecreateUserManager).toHaveBeenCalled());
        __setMockIsInitialized(true);
    });

    test('initializeOidcOnStartup does not run if already initialized', async () => {
        setupOidcAuth(makeTokenWithExp(3600));
        renderApp(['/']);
        await waitFor(() => {
            expect(oidcConfiguration).not.toHaveBeenCalled();
            expect(mockRecreateUserManager).not.toHaveBeenCalled();
        });
    });

    test('initializeOidcOnStartup does not run without token', async () => {
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authChoice' ? 'openid' : null
        );
        mockAuthState.authChoice = 'openid';
        renderApp(['/']);
        await waitFor(() => expect(oidcConfiguration).not.toHaveBeenCalled());
    });

    test('initializeOidcOnStartup does not run for non-openid authChoice', async () => {
        setupBasicAuth();
        renderApp(['/']);
        await waitFor(() => expect(oidcConfiguration).not.toHaveBeenCalled());
    });

    test('initializeOidcOnStartup does not run if authInfo is null', async () => {
        __setMockIsInitialized(false);
        const AuthInfoMock = (await import('../../hooks/AuthInfo.jsx')).default;
        AuthInfoMock.mockImplementation(() => null);
        setupOidcAuth(makeTokenWithExp(3600));
        renderApp(['/']);
        await new Promise(r => setTimeout(r, 200));
        expect(oidcConfiguration).not.toHaveBeenCalled();
        AuthInfoMock.mockImplementation(() => ({
            openid: {issuer: 'https://test-issuer.com', client_id: 'test-client'}
        }));
        __setMockIsInitialized(true);
    });

    test('initializeOidcOnStartup handles oidcConfiguration rejection', async () => {
        __setMockIsInitialized(false);
        oidcConfiguration.mockImplementationOnce(() => Promise.reject(new Error('config failed')));
        setupOidcAuth(makeTokenWithExp(3600));
        renderApp(['/objects']);
        await new Promise(r => setTimeout(r, 200));
        expect(oidcConfiguration).toHaveBeenCalled();
        expect(mockRecreateUserManager).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
        __setMockIsInitialized(true);
    });

    test('initializeOidcOnStartup handles recreateUserManager throwing', async () => {
        __setMockIsInitialized(false);
        oidcConfiguration.mockImplementationOnce(() => Promise.resolve({client_id: 'x'}));
        mockRecreateUserManager = vi.fn(() => {
            throw new Error('boom create');
        });
        __setMockRecreateUserManager(mockRecreateUserManager);
        setupOidcAuth(makeTokenWithExp(3600));
        renderApp(['/objects']);
        await new Promise(r => setTimeout(r, 200));
        expect(mockRecreateUserManager).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
        __setMockIsInitialized(true);
    });

    // --- OIDC User Events ---
    test('valid user from getUser triggers SetAccessToken and Login dispatch', async () => {
        const validUser = {
            profile: {preferred_username: 'test-user'},
            access_token: 'new-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expired: false,
        };
        mockUserManager.getUser.mockResolvedValue(validUser);
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'SetAccessToken', data: 'new-token'}));
        await waitFor(() => expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'Login', data: 'test-user'}));
        await waitFor(() => expect(mockLocalStorage.setItem).toHaveBeenCalledWith('authToken', 'new-token'));
        await waitFor(() => expect(mockLocalStorage.setItem).toHaveBeenCalledWith('tokenExpiration', expect.any(String)));
    });

    test('expired user whose renewal gives no user ends the session', async () => {
        mockUserManager.getUser.mockResolvedValue({profile: {preferred_username: 'x'}, expired: true});
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.getUser).toHaveBeenCalled());
        await waitFor(() => expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'SetAccessToken', data: null}));
        expect(mockAuthDispatch).not.toHaveBeenCalledWith(expect.objectContaining({type: 'Login'}));
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('expired user triggers silent renew; success dispatches tokens', async () => {
        const refreshedUser = {
            profile: {preferred_username: 'refreshed-user'},
            access_token: 'refreshed-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expired: false,
        };
        mockUserManager.getUser.mockResolvedValue({profile: {preferred_username: 'x'}, expired: true});
        mockUserManager.signinSilent.mockResolvedValue(refreshedUser);
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.signinSilent).toHaveBeenCalled());
        await waitFor(() => expect(mockAuthDispatch).toHaveBeenCalledWith({
            type: 'SetAccessToken',
            data: 'refreshed-token'
        }));
        await waitFor(() => expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'Login', data: 'refreshed-user'}));
    });

    test('expired user whose renewal is not answered keeps the session', async () => {
        mockUserManager.getUser.mockResolvedValue({profile: {preferred_username: 'x'}, expired: true});
        mockUserManager.signinSilent.mockRejectedValue(new Error('Network Error'));
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.signinSilent).toHaveBeenCalled());
        await waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Silent renew not answered (expired user on startup)'), expect.any(Error)));
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', expect.anything());
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('authToken');
    });

    test('expired user whose renewal the provider refuses ends the session', async () => {
        mockUserManager.getUser.mockResolvedValue({profile: {preferred_username: 'x'}, expired: true});
        mockUserManager.signinSilent.mockRejectedValue({error: 'invalid_grant'});
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true}));
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
    });

    test('getUser rejection logs error', async () => {
        mockUserManager.getUser.mockRejectedValue(new Error('getUser failed'));
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(logger.error).toHaveBeenCalledWith('Error getting user:', expect.any(Error)));
    });

    test('silent renew returns null user logs warning', async () => {
        mockUserManager.getUser.mockResolvedValue({profile: {preferred_username: 'x'}, expired: true});
        mockUserManager.signinSilent.mockResolvedValue(null);
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.signinSilent).toHaveBeenCalled());
        await waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('renewal gave no valid user'), ''));
    });

    test('addAccessTokenExpired handler renews, the session ended when no user comes back', async () => {
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addAccessTokenExpired).toHaveBeenCalled());
        await act(async () => {
            await mockUserManager.events.addAccessTokenExpired.mock.calls[0][0]();
        });
        await waitFor(() => expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken'));
        await waitFor(() => expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('tokenExpiration'));
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true}));
    });

    test('addAccessTokenExpired handler renews and keeps the session', async () => {
        setupOidcAuth();
        mockUserManager.signinSilent.mockResolvedValue({
            profile: {preferred_username: 'u'},
            access_token: 'renewed-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expired: false,
        });
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addAccessTokenExpired).toHaveBeenCalled());
        await act(async () => {
            await mockUserManager.events.addAccessTokenExpired.mock.calls[0][0]();
        });
        expect(mockUserManager.signinSilent).toHaveBeenCalled();
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('authToken', 'renewed-token');
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('authToken');
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', expect.anything());
    });

    test('addAccessTokenExpired handler keeps the session when the renewal is not answered', async () => {
        setupOidcAuth();
        mockUserManager.signinSilent.mockRejectedValue(new Error('Network Error'));
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addAccessTokenExpired).toHaveBeenCalled());
        await act(async () => {
            await mockUserManager.events.addAccessTokenExpired.mock.calls[0][0]();
        });
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('authToken');
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', expect.anything());
    });

    test('addAccessTokenExpired handler ends the session when the provider refuses the renewal', async () => {
        setupOidcAuth();
        mockUserManager.signinSilent.mockRejectedValue({error: 'invalid_grant'});
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addAccessTokenExpired).toHaveBeenCalled());
        await act(async () => {
            await mockUserManager.events.addAccessTokenExpired.mock.calls[0][0]();
        });
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('addSilentRenewError handler ends the session when the provider refused', async () => {
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addSilentRenewError).toHaveBeenCalled());
        act(() => mockUserManager.events.addSilentRenewError.mock.calls[0][0]({error: 'invalid_grant'}));
        await waitFor(() => expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken'));
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true}));
    });

    test('addSilentRenewError handler keeps the session when the renewal was not answered', async () => {
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addSilentRenewError).toHaveBeenCalled());
        act(() => mockUserManager.events.addSilentRenewError.mock.calls[0][0](new Error('Network Error')));
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Automatic silent renew not answered'), expect.any(Error));
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('authToken');
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', expect.anything());
    });

    test('addAccessTokenExpiring listener logs debug', async () => {
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addAccessTokenExpiring).toHaveBeenCalled());
        act(() => mockUserManager.events.addAccessTokenExpiring.mock.calls[0][0]());
        expect(logger.debug).toHaveBeenCalled();
    });

    test('removes the event listeners it added on unmount', async () => {
        setupOidcAuth();
        const {unmount} = renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addUserLoaded).toHaveBeenCalled());
        const added = mockUserManager.events.addAccessTokenExpired.mock.calls[0][0];
        unmount();
        await waitFor(() => expect(mockUserManager.events.removeUserLoaded).toHaveBeenCalled());
        expect(mockUserManager.events.removeAccessTokenExpired).toHaveBeenCalledWith(added);
        await waitFor(() => expect(mockUserManager.events.removeAccessTokenExpired).toHaveBeenCalled());
        await waitFor(() => expect(mockUserManager.events.removeSilentRenewError).toHaveBeenCalled());
    });

    test('onUserRefreshed: user without profile does not dispatch Login', async () => {
        setupOidcAuth();
        mockUserManager.getUser.mockResolvedValue({
            access_token: 'new-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
        renderApp(['/objects']);
        await waitFor(() => expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'SetAccessToken', data: 'new-token'}));
        expect(mockAuthDispatch).not.toHaveBeenCalledWith(expect.objectContaining({
            type: 'Login',
            data: expect.anything()
        }));
    });

    test('onUserRefreshed via addUserLoaded event fires correctly', async () => {
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.events.addUserLoaded).toHaveBeenCalled());
        act(() => mockUserManager.events.addUserLoaded.mock.calls[0][0]({
            profile: {preferred_username: 'event-user'},
            access_token: 'event-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
        }));
        await waitFor(() => expect(mockLocalStorage.setItem).toHaveBeenCalledWith('authToken', 'event-token'));
    });

    // --- Auth Choice Persistence ---
    test('saves auth.authChoice to localStorage', async () => {
        mockAuthState.authChoice = 'basic';
        renderApp(['/']);
        await waitFor(() => expect(mockLocalStorage.setItem).toHaveBeenCalledWith('authChoice', 'basic'));
    });

    test('does not save authChoice if null', async () => {
        renderApp(['/']);
        await waitFor(() => {
            expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith('authChoice', expect.anything());
        });
    });

    // --- Auth Resume (visibility/focus) ---
    test('focus triggers redirect when basic token is expired', async () => {
        setupBasicAuth(-3600);
        renderApp(['/objects']);
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
    });

    test('focus does not redirect when OIDC token is present', async () => {
        setupOidcAuth('dummy-token');
        renderApp(['/objects']);
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 10));
        });
        expect(await screen.findByTestId('objects')).toBeInTheDocument();
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('focus does not redirect when basic token is valid', async () => {
        setupBasicAuth();
        renderApp(['/objects']);
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 10));
        });
        expect(await screen.findByTestId('objects')).toBeInTheDocument();
    });

    test('visibilitychange triggers auth check without redirect for valid token', async () => {
        setupBasicAuth();
        renderApp(['/objects']);
        Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true});
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(await screen.findByTestId('objects')).toBeInTheDocument();
    });

    test('OIDC expired token on resume triggers silent renew and updates storage', async () => {
        setupOidcAuth(makeTokenWithExp(-3600));
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        mockUserManager.signinSilent.mockResolvedValue({
            profile: {preferred_username: 'refreshed-user'},
            access_token: 'refreshed-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expired: false,
        });
        renderApp(['/objects']);
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        await waitFor(() => expect(mockUserManager.signinSilent).toHaveBeenCalled());
        await waitFor(() => expect(mockLocalStorage.setItem).toHaveBeenCalledWith('authToken', 'refreshed-token'));
    });

    test('OIDC with no token on resume redirects', async () => {
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authChoice' ? 'openid' : null
        );
        renderApp(['/objects']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
    });

    test('handleCheckAuthOnResume: OIDC no token on focus redirects', async () => {
        setupOidcAuth();
        renderApp(['/objects']);
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authChoice' ? 'openid' : null
        );
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('handleCheckAuthOnResume: OIDC expired token without userManager waits for its startup', async () => {
        __setMockIsInitialized(false);
        const expiredToken = makeTokenWithExp(-3600);
        setupOidcAuth(expiredToken);
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        const oidcCtxModule = await import('../../context/OidcAuthContext.tsx');
        vi.spyOn(oidcCtxModule, 'useOidc').mockReturnValue({
            userManager: null,
            recreateUserManager: mockRecreateUserManager,
            isInitialized: false,
        });
        renderApp(['/objects']);
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', expect.anything());
        vi.restoreAllMocks();
        __setMockIsInitialized(true);
    });

    test('handleCheckAuthOnResume: OIDC silent renew returns expired user redirects', async () => {
        const expiredToken = makeTokenWithExp(-3600);
        setupOidcAuth(expiredToken);
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        mockUserManager.signinSilent.mockResolvedValue({expired: true});
        renderApp(['/objects']);
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        await waitFor(() => expect(mockUserManager.signinSilent).toHaveBeenCalled());
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('handleCheckAuthOnResume: OIDC silent renew not answered keeps the session', async () => {
        const expiredToken = makeTokenWithExp(-3600);
        setupOidcAuth(expiredToken);
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        mockUserManager.signinSilent.mockRejectedValue(new Error('Network Error'));
        renderApp(['/objects']);
        await screen.findByTestId('objects');
        mockNavigate.mockClear();
        logger.warn.mockClear();
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Silent renew not answered (resume)'), expect.any(Error));
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', expect.anything());
    });

    test('handleCheckAuthOnResume: OIDC silent renew refused redirects', async () => {
        const expiredToken = makeTokenWithExp(-3600);
        setupOidcAuth(expiredToken);
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        mockUserManager.signinSilent.mockRejectedValue({error: 'invalid_grant'});
        renderApp(['/objects']);
        await screen.findByTestId('objects');
        mockNavigate.mockClear();
        logger.error.mockClear();
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('resume check with expired basic token (after initial valid) clears storage and redirects', async () => {
        setupBasicAuth(3600);
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 3600});
        renderApp(['/objects']);
        await screen.findByTestId('objects');
        const expiredToken = makeTokenWithExp(-3600);
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authToken' ? expiredToken : k === 'authChoice' ? 'basic' : null
        );
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 3600});
        mockNavigate.mockClear();
        mockLocalStorage.removeItem.mockClear();
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('tokenExpiration');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authChoice');
    });

    test('cleanup clears debounce timer on unmount', async () => {
        vi.useFakeTimers();
        setupBasicAuth();
        const {unmount} = renderApp(['/objects']);
        await screen.findByTestId('objects');
        act(() => {
            window.dispatchEvent(new Event('focus'));
        });
        unmount();
        vi.advanceTimersByTime(600);
        expect(mockNavigate).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    test('debouncedCheck clears previous timer before setting new one', async () => {
        vi.useFakeTimers();
        setupBasicAuth();
        renderApp(['/objects']);
        await screen.findByTestId('objects');
        mockNavigate.mockClear();

        act(() => {
            window.dispatchEvent(new Event('focus'));
        });
        act(() => {
            window.dispatchEvent(new Event('focus'));
        });
        await act(async () => {
            vi.advanceTimersByTime(600);
        });
        expect(mockNavigate).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    test('expired user silent renew returns still-expired user logs warning', async () => {
        mockUserManager.getUser.mockResolvedValue({profile: {preferred_username: 'x'}, expired: true});
        mockUserManager.signinSilent.mockResolvedValue({expired: true, profile: {preferred_username: 'x'}});
        setupOidcAuth();
        renderApp(['/objects']);
        await waitFor(() => expect(mockUserManager.signinSilent).toHaveBeenCalled());
        await waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('renewal gave no valid user'), ''));
    });

    test('handleCheckAuthOnResume handles storage errors gracefully', async () => {
        setupBasicAuth();
        renderApp(['/objects']);
        mockLocalStorage.getItem.mockImplementation(() => {
            throw new Error('Storage error');
        });
        act(() => window.dispatchEvent(new Event('focus')));
        await waitFor(() =>
            expect(logger.error).toHaveBeenCalledWith('Error while checking auth on resume:', expect.any(Error))
        );
    });

    test('isTokenValid with payload missing exp returns false', async () => {
        const token = 'h.' + btoa(JSON.stringify({foo: 'bar'})) + '.s';
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authToken' ? token : k === 'authChoice' ? 'basic' : null
        );
        decodeToken.mockReturnValue({foo: 'bar'});
        renderApp(['/objects']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
    });

    test('resume check with valid OIDC token does not trigger any action', async () => {
        const validToken = makeTokenWithExp(3600);
        setupOidcAuth(validToken);
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 3600});
        renderApp(['/objects']);
        await screen.findByTestId('objects');
        mockLocalStorage.setItem.mockClear();
        mockLocalStorage.removeItem.mockClear();
        mockNavigate.mockClear();
        mockUserManager.signinSilent.mockClear();
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', {replace: true});
        expect(mockUserManager.signinSilent).not.toHaveBeenCalled();
        const authKeys = ['authToken', 'authChoice', 'tokenExpiration'];
        const setItemCallsForAuth = mockLocalStorage.setItem.mock.calls.filter(call => authKeys.includes(call[0]));
        expect(setItemCallsForAuth).toHaveLength(0);
        const removeItemCallsForAuth = mockLocalStorage.removeItem.mock.calls.filter(call => authKeys.includes(call[0]));
        expect(removeItemCallsForAuth).toHaveLength(0);
    });

    test('resume check with valid basic token does not trigger any action', async () => {
        const validToken = makeTokenWithExp(3600);
        mockLocalStorage.getItem.mockImplementation((k) =>
            k === 'authToken' ? validToken : k === 'authChoice' ? 'basic' : null
        );
        decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 3600});
        renderApp(['/objects']);
        await screen.findByTestId('objects');
        mockLocalStorage.setItem.mockClear();
        mockLocalStorage.removeItem.mockClear();
        mockNavigate.mockClear();
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).not.toHaveBeenCalledWith('/auth-choice', {replace: true});
        const authKeys = ['authToken', 'authChoice', 'tokenExpiration'];
        const removeItemCallsForAuth = mockLocalStorage.removeItem.mock.calls.filter(call => authKeys.includes(call[0]));
        expect(removeItemCallsForAuth).toHaveLength(0);
        const setItemCallsForAuth = mockLocalStorage.setItem.mock.calls.filter(call => authKeys.includes(call[0]));
        expect(setItemCallsForAuth).toHaveLength(0);
    });

    test('resume check on auth path does nothing', async () => {
        renderApp(['/auth-choice']);
        await screen.findByTestId('auth-choice');
        mockLocalStorage.setItem.mockClear();
        mockLocalStorage.removeItem.mockClear();
        mockNavigate.mockClear();
        act(() => window.dispatchEvent(new Event('focus')));
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });
        expect(mockNavigate).not.toHaveBeenCalled();
        const authKeys = ['authToken', 'authChoice', 'tokenExpiration'];
        const setItemCallsForAuth = mockLocalStorage.setItem.mock.calls.filter(call => authKeys.includes(call[0]));
        expect(setItemCallsForAuth).toHaveLength(0);
        const removeItemCallsForAuth = mockLocalStorage.removeItem.mock.calls.filter(call => authKeys.includes(call[0]));
        expect(removeItemCallsForAuth).toHaveLength(0);
    });


    // --- Miscellaneous ---
    test('handles om3:auth-redirect event', async () => {
        renderApp(['/']);
        act(() => window.dispatchEvent(new CustomEvent('om3:auth-redirect', {detail: '/auth-choice'})));
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice', {replace: true});
    });

    test('storage event calls getItem to check new token', async () => {
        const newToken = makeTokenWithExp(3600);
        mockLocalStorage.getItem.mockImplementation((k) => k === 'authChoice' ? 'basic' : null);
        renderApp(['/auth-choice']);
        await screen.findByTestId('auth-choice');
        mockLocalStorage.getItem.mockImplementation((k) => k === 'authToken' ? newToken : null);
        act(() => window.dispatchEvent(new StorageEvent('storage', {key: 'authToken', newValue: newToken})));
        await waitFor(() => expect(mockLocalStorage.getItem).toHaveBeenCalledWith('authToken'));
    });

    test('event listeners are cleaned up on unmount', async () => {
        const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
        const docRemoveListenerSpy = vi.spyOn(document, 'removeEventListener');
        setupBasicAuth();
        const {unmount} = renderApp(['/']);
        await screen.findByTestId('navbar');
        unmount();
        expect(removeListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));
        expect(removeListenerSpy).toHaveBeenCalledWith('om3:auth-redirect', expect.any(Function));
        expect(docRemoveListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    test('isTokenValid: null, empty, and malformed tokens fail', async () => {
        for (const token of [null, '', 'not.a.valid.jwt']) {
            mockLocalStorage.getItem.mockImplementation((k) =>
                k === 'authToken' ? token : k === 'authChoice' ? 'basic' : null
            );
            decodeToken.mockReturnValue(null);
            const {unmount} = renderApp(['/objects']);
            expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
            unmount();
        }
    });

    test('no anchor bringing the panels back, nor a gutter kept for one, whatever the history or the window', async () => {
        mockHistory.entries = [{kind: 'node', id: 'dev3n1', at: Date.now()}];
        try {
            setupBasicAuth();
            renderApp(['/nodes']);
            await screen.findByTestId('nodes');
            const main = document.getElementById('app-scroll-container');
            expect(main.style.paddingRight).toBe('');
            expect(within(screen.getByTestId('navbar')).queryByTestId('panel-reopen-key')).toBeNull();
        } finally {
            mockHistory.entries = [];
        }
    });

    // --- AI assistant ---
    test('AI page is protected and requires an authenticated session', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        renderApp(['/ai']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-chat')).not.toBeInTheDocument();
    });

    test('configured AI page is accessible with the existing OpenID session', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        setupOidcAuth();
        renderApp(['/ai']);
        expect(await screen.findByTestId('ai-chat')).toBeInTheDocument();
    });

    test('configured AI page is accessible with the existing Basic session', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        setupBasicAuth();
        renderApp(['/ai']);
        expect(await screen.findByTestId('ai-chat')).toBeInTheDocument();
    });

    test('configured AI route rejects an expired Basic session', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', 'https://agent.example.com');
        setupBasicAuth(-3600);
        renderApp(['/ai']);
        expect(await screen.findByTestId('auth-choice')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-chat')).not.toBeInTheDocument();
    });

    test('unconfigured AI route redirects to the home view', async () => {
        vi.stubEnv('VITE_AI_AGENT_URL', '');
        setupBasicAuth();
        renderApp(['/ai']);
        expect(await screen.findByTestId('cluster')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-chat')).not.toBeInTheDocument();
    });
});
