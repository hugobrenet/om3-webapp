import React from 'react';
import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import WhoAmI from '../WhoAmI';
import {URL_AUTH_WHOAMI} from '../../config/apiPath';
import {DarkModeProvider} from '../../context/DarkModeContext';
import i18n from '../../i18n';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';

const {
    mockNavigate,
    mockAuthDispatch,
    mockUseAuth,
    mockUseOidc,
    mockUseFetchDaemonStatus,
    mockToggleDarkMode,
    mockLogger,
    mockLocalStorage,
} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockAuthDispatch: vi.fn(),
    mockUseAuth: vi.fn(),
    mockUseOidc: vi.fn(),
    mockUseFetchDaemonStatus: vi.fn(),
    mockToggleDarkMode: vi.fn(),
    mockLogger: {error: vi.fn(), info: vi.fn()},
    mockLocalStorage: {
        getItem: vi.fn(),
        removeItem: vi.fn(),
        setItem: vi.fn(),
        clear: vi.fn(),
    },
}));

let mockIsDarkMode = false;

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

vi.mock('../../context/AuthProvider.jsx', () => ({
    useAuth: mockUseAuth,
    useAuthDispatch: () => mockAuthDispatch,
    Logout: 'LOGOUT',
}));

vi.mock('../../context/OidcAuthContext.tsx', () => ({
    useOidc: mockUseOidc,
}));

vi.mock('../../hooks/useFetchDaemonStatus', () => ({
    default: mockUseFetchDaemonStatus,
}));

vi.mock('../../utils/logger.js', () => ({
    default: mockLogger,
}));

vi.mock('../../context/DarkModeContext', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useDarkMode: () => ({
            isDarkMode: mockIsDarkMode,
            toggleDarkMode: mockToggleDarkMode,
        }),
    };
});

Object.defineProperty(window, 'localStorage', {value: mockLocalStorage});

global.fetch = vi.fn();

describe('WhoAmI', () => {
    const mockToken = 'mock-token';
    const mockSignoutRedirect = vi.fn();
    const mockRemoveUser = vi.fn();
    const mockFetchNodes = vi.fn();

    const defaultUserInfo = {
        auth: 'user',
        grant: {root: null},
        namespace: 'system',
        raw_grant: 'root',
        name: 'testuser',
    };

    const defaultDaemon = {nodename: 'test-node'};

    const setupMocks = (overrides = {}) => {
        vi.clearAllMocks();

        mockIsDarkMode = overrides.isDarkMode ?? false;

        mockLocalStorage.getItem.mockImplementation((key) => {
            if (key === 'authToken') return 'authToken' in overrides ? overrides.authToken : mockToken;
            if (key === 'darkMode') return 'false';
            if (key === 'appVersion') return 'appVersion' in overrides ? overrides.appVersion : null;
            if (key === 'appVersionTime') return 'appVersionTime' in overrides ? overrides.appVersionTime : null;
            return null;
        });

        mockUseAuth.mockReturnValue(overrides.auth ?? {
            authChoice: overrides.authChoice ?? 'local',
            authToken: mockToken,
        });

        mockUseOidc.mockReturnValue({
            userManager: {
                signoutRedirect: mockSignoutRedirect,
                removeUser: mockRemoveUser,
            },
        });

        mockUseFetchDaemonStatus.mockReturnValue({
            daemon: overrides.daemon ?? defaultDaemon,
            fetchNodes: mockFetchNodes,
        });

        global.fetch.mockImplementation((url) => {
            if (url.includes('github')) {
                if (overrides.githubError) {
                    return Promise.reject(new Error('GitHub error'));
                }
                // Use override.githubData if provided, else default
                const githubData = overrides.githubData || [{tag_name: 'v1.2.3'}];
                return Promise.resolve({
                    json: () => Promise.resolve(githubData),
                });
            }
            if (url === URL_AUTH_WHOAMI) {
                if (overrides.whoamiError) {
                    return Promise.reject(new Error('Failed to load user information'));
                }
                return Promise.resolve({
                    ok: overrides.whoamiOk ?? true,
                    json: () => Promise.resolve(overrides.whoamiData ?? defaultUserInfo),
                });
            }
            return Promise.reject(new Error(`Unknown URL: ${url}`));
        });
    };

    const renderComponent = () =>
        render(
            <DarkModeProvider>
                <MemoryRouter>
                    <WhoAmI/>
                </MemoryRouter>
            </DarkModeProvider>
        );

    test('shows loading state initially', () => {
        setupMocks();
        renderComponent();
        expect(screen.getByRole('status')).toHaveTextContent('Loading user information');
    });

    test('displays error alert on fetch failure', async () => {
        setupMocks({whoamiError: true});
        renderComponent();
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Failed to load user information');
        });
    });

    test('displays error alert on non‑OK response', async () => {
        setupMocks({whoamiOk: false});
        renderComponent();
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Failed to load user information');
        });
    });

    test('renders all sections with user and server info', async () => {
        setupMocks();
        renderComponent();

        await waitFor(() => {
            expect(screen.getAllByText('My Information')[0]).toBeInTheDocument();
            expect(screen.getByText('testuser')).toBeInTheDocument();
            expect(screen.getByText('Auth Method')).toBeInTheDocument();
            expect(screen.getByText('user')).toBeInTheDocument();
            expect(screen.getByText('Permission Details')).toBeInTheDocument();
            expect(screen.getByText('root')).toBeInTheDocument();
            expect(screen.getByText('Server Information')).toBeInTheDocument();
            expect(screen.getByText('test-node')).toBeInTheDocument();
            expect(screen.getByText('v1.2.3')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: /dark mode/i})).toBeInTheDocument();
            expect(screen.getByRole('button', {name: /logout/i})).toBeInTheDocument();
        });
    });

    test('shows "None" when raw_grant is missing', async () => {
        setupMocks({whoamiData: {...defaultUserInfo, raw_grant: null}});
        renderComponent();
        await waitFor(() => {
            expect(screen.getByText('None')).toBeInTheDocument();
        });
    });

    test('shows "N/A" for missing fields', async () => {
        setupMocks({whoamiData: {auth: null, name: null, raw_grant: null}});
        renderComponent();
        await waitFor(() => {
            const naElements = screen.getAllByText('N/A');
            expect(naElements.length).toBeGreaterThanOrEqual(2);
        });
    });

    test('uses authToken from localStorage in API call', async () => {
        setupMocks();
        renderComponent();
        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith(
                URL_AUTH_WHOAMI,
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: `Bearer ${mockToken}`,
                    }),
                })
            );
        });
    });

    describe('app version', () => {
        const versionCases = [
            {
                name: 'uses cache when valid (<1h)',
                appVersion: '1.0.0',
                appVersionTime: String(Date.now()),
                expectedVersion: 'v1.0.0',
                githubCalled: false,
            },
            {
                name: 'fetches from GitHub when cache expired',
                appVersion: '1.0.0',
                appVersionTime: String(Date.now() - 4000000),
                expectedVersion: 'v1.2.3',
                githubCalled: true,
            },
            {
                name: 'falls back to cache when GitHub fails',
                appVersion: '1.0.0',
                appVersionTime: String(Date.now() - 4000000),
                githubError: true,
                expectedVersion: 'v1.0.0',
                githubCalled: true,
            },
            {
                name: 'shows Unknown when no cache and GitHub fails',
                appVersion: null,
                appVersionTime: null,
                githubError: true,
                expectedVersion: 'vUnknown',
                githubCalled: true,
            },
            {
                name: 'cacheTime missing but appVersion present',
                appVersion: '1.0.0',
                appVersionTime: null,
                githubError: false,
                expectedVersion: 'v1.2.3',
                githubCalled: true,
            },
            {
                name: 'cacheTime invalid (NaN)',
                appVersion: '1.0.0',
                appVersionTime: 'invalid',
                githubError: false,
                expectedVersion: 'v1.2.3',
                githubCalled: true,
            },
            {
                name: 'appVersion null but cacheTime present',
                appVersion: null,
                appVersionTime: String(Date.now()),
                githubError: false,
                expectedVersion: 'v1.2.3',
                githubCalled: true,
            },
            {
                name: 'appVersion null and cacheTime null but GitHub succeeds',
                appVersion: null,
                appVersionTime: null,
                githubError: false,
                expectedVersion: 'v1.2.3',
                githubCalled: true,
            },
            {
                name: 'GitHub returns empty array -> Unknown',
                appVersion: null,
                appVersionTime: null,
                githubData: [], // data[0] is undefined
                expectedVersion: 'vUnknown',
                githubCalled: true,
            },
            {
                name: 'GitHub returns object without tag_name -> Unknown',
                appVersion: null,
                appVersionTime: null,
                githubData: [{}], // data[0] exists but tag_name undefined
                expectedVersion: 'vUnknown',
                githubCalled: true,
            },
            {
                name: 'GitHub tag_name does not start with v',
                appVersion: null,
                appVersionTime: null,
                githubData: [{tag_name: '1.0.0'}], // no 'v' prefix
                expectedVersion: 'v1.0.0',
                githubCalled: true,
            },
        ];

        it.each(versionCases)(
            '$name',
            async ({appVersion, appVersionTime, githubError, githubData, expectedVersion, githubCalled}) => {
                setupMocks({appVersion, appVersionTime, githubError, githubData});
                renderComponent();
                await waitFor(() => {
                    expect(screen.getByText(expectedVersion)).toBeInTheDocument();
                });
                if (!githubCalled) {
                    expect(fetch).not.toHaveBeenCalledWith(
                        expect.stringContaining('github')
                    );
                }
            }
        );
    });

    describe('daemon fetch', () => {
        test('calls fetchNodes when authToken exists', async () => {
            setupMocks();
            renderComponent();
            await waitFor(() => {
                expect(mockFetchNodes).toHaveBeenCalledWith(mockToken);
            });
        });

        test('does not call fetchNodes when no authToken', async () => {
            setupMocks({authToken: null});
            renderComponent();
            await waitFor(() => {
                const headings = screen.getAllByText('My Information');
                expect(headings.length).toBeGreaterThan(0);
            });
            expect(mockFetchNodes).not.toHaveBeenCalled();
        });

        test('logs error when fetchNodes fails', async () => {
            mockFetchNodes.mockRejectedValue(new Error('daemon error'));
            setupMocks();
            renderComponent();
            await waitFor(() => {
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Error fetching daemon status:',
                    expect.any(Error)
                );
            });
        });

        test('displays "Loading..." when nodename is missing', async () => {
            setupMocks({daemon: {}});
            renderComponent();
            await waitFor(() => {
                expect(screen.getByText('Loading...')).toBeInTheDocument();
            });
        });
    });

    describe('dark mode toggle', () => {
        test('button toggles dark mode', async () => {
            setupMocks();
            renderComponent();
            const button = await screen.findByRole('button', {name: /dark mode/i});
            fireEvent.click(button);
            expect(mockToggleDarkMode).toHaveBeenCalled();
        });

        test('renders correctly when dark mode is enabled', async () => {
            setupMocks({isDarkMode: true});
            renderComponent();

            const button = await screen.findByRole('button', {name: /light mode/i});
            expect(button).toBeInTheDocument();
        });
    });

    describe('language', () => {
        afterEach(async () => {
            await i18n.changeLanguage('en');
        });

        test('the language chosen speaks at once, is kept, and the page says it', async () => {
            setupMocks();
            renderComponent();
            const picker = await screen.findByRole('combobox', {name: 'Language'});
            expect(picker).toHaveValue('en');
            // Each language named in itself.
            expect(screen.getByRole('option', {name: 'Français'})).toHaveAttribute('lang', 'fr');
            fireEvent.change(picker, {target: {value: 'fr'}});
            expect(await screen.findByRole('button', {name: 'Se déconnecter'})).toBeInTheDocument();
            expect(screen.getByRole('combobox', {name: 'Langue'})).toHaveValue('fr');
            expect(mockLocalStorage.setItem).toHaveBeenCalledWith('om3.language', 'fr');
            expect(document.documentElement.lang).toBe('fr');
        });
    });

    describe('logout', () => {
        test.each([
            {authChoice: 'openid', shouldCallOidc: true},
            {authChoice: 'local', shouldCallOidc: false},
        ])('handles logout for $authChoice', async ({authChoice, shouldCallOidc}) => {
            setupMocks({authChoice});
            renderComponent();
            const button = await screen.findByRole('button', {name: /logout/i});
            fireEvent.click(button);

            if (shouldCallOidc) {
                expect(mockSignoutRedirect).toHaveBeenCalled();
                expect(mockRemoveUser).toHaveBeenCalled();
            } else {
                expect(mockSignoutRedirect).not.toHaveBeenCalled();
                expect(mockRemoveUser).not.toHaveBeenCalled();
            }

            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
            expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'LOGOUT'});
            expect(mockNavigate).toHaveBeenCalledWith('/auth-choice');
        });

        test('handles logout when auth is null', async () => {
            setupMocks({auth: null});
            renderComponent();
            const button = await screen.findByRole('button', {name: /logout/i});
            fireEvent.click(button);

            expect(mockSignoutRedirect).not.toHaveBeenCalled();
            expect(mockRemoveUser).not.toHaveBeenCalled();
            expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('authToken');
            expect(mockAuthDispatch).toHaveBeenCalledWith({type: 'LOGOUT'});
            expect(mockNavigate).toHaveBeenCalledWith('/auth-choice');
        });
    });

    describe('layout', () => {
        test('renders one panel per section, named by its heading', async () => {
            setupMocks();
            renderComponent();

            await waitFor(() => {
                expect(screen.getByRole('region', {name: 'My Information'})).toHaveTextContent('testuser');
                expect(screen.getByRole('region', {name: 'Permission Details'})).toHaveTextContent('root');
                expect(screen.getByRole('region', {name: 'Server Information'})).toHaveTextContent('test-node');
                expect(screen.getByRole('button', {name: /dark mode/i})).toBeInTheDocument();
                expect(screen.getByRole('button', {name: /logout/i})).toBeInTheDocument();
            });
        });
    });
});
