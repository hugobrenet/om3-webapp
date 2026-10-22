import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {vi, beforeEach, afterEach, describe, test, expect} from 'vitest';
import {
    AuthProvider,
    Login,
    Logout,
    SetAccessToken,
    SetAuthChoice,
    SetAuthInfo,
    useAuth,
    useAuthDispatch,
} from '../AuthProvider';
import {updateEventSourceToken} from '../../eventSourceManager';
import {decodeToken, refreshToken} from '../../components/Login';
import logger from '../../utils/logger.js';

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock('../../eventSourceManager', () => ({
    updateEventSourceToken: vi.fn(),
}));
vi.mock('../../components/Login', () => ({
    decodeToken: vi.fn(),
    refreshToken: vi.fn(),
}));
vi.mock('../../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        log: vi.fn(),
    },
}));

// ── OIDC mock variables (hoisted) ──────────────────────────────────────
const {
    mockSigninSilent,
    mockAddAccessTokenExpired,
    mockRemoveAccessTokenExpired,
    tokenExpiredCallbackRef,
} = vi.hoisted(() => {
    let tokenExpiredCallback = null;
    const mockSigninSilent = vi.fn();
    const mockAddAccessTokenExpired = vi.fn(cb => {
        tokenExpiredCallback = cb;
    });
    const mockRemoveAccessTokenExpired = vi.fn(cb => {
        if (cb === tokenExpiredCallback) tokenExpiredCallback = null;
    });
    return {
        mockSigninSilent,
        mockAddAccessTokenExpired,
        mockRemoveAccessTokenExpired,
        tokenExpiredCallbackRef: {
            get current() {
                return tokenExpiredCallback;
            },
            set current(v) {
                tokenExpiredCallback = v;
            },
        },
    };
});

// ── Globals ────────────────────────────────────────────────────────────
const mockUserManager = {
    signinSilent: mockSigninSilent,
    events: {
        addAccessTokenExpired: mockAddAccessTokenExpired,
        removeAccessTokenExpired: mockRemoveAccessTokenExpired,
    },
};
Object.defineProperty(window, 'oidcUserManager', {
    value: mockUserManager,
    writable: true,
});

global.BroadcastChannel = class {
    constructor() {
        this.onmessage = null;
        this._messages = [];
    }

    postMessage(msg) {
        this._messages.push(msg);
    }

    close() {
    }
};

// ── Test components ─────────────────────────────────────────────────────
const TestAuth = () => {
    const auth = useAuth();
    return (
        <div>
            <div data-testid="user">{JSON.stringify(auth.user)}</div>
            <div data-testid="isAuthenticated">{auth.isAuthenticated.toString()}</div>
            <div data-testid="authChoice">{JSON.stringify(auth.authChoice)}</div>
            <div data-testid="authInfo">{JSON.stringify(auth.authInfo)}</div>
            <div data-testid="accessToken">{JSON.stringify(auth.accessToken)}</div>
        </div>
    );
};

const actions = [
    {testId: 'login', type: Login, data: 'testuser'},
    {testId: 'logout', type: Logout},
    {testId: 'setAccessToken', type: SetAccessToken, data: 'mock-token'},
    {testId: 'setAccessToken2', type: SetAccessToken, data: 'second-token'},
    {testId: 'setAccessTokenNull', type: SetAccessToken, data: null},
    {testId: 'setAuthInfo', type: SetAuthInfo, data: {provider: 'openid'}},
    {testId: 'setAuthChoice', type: SetAuthChoice, data: 'sso'},
    {testId: 'setAuthChoiceOpenid', type: SetAuthChoice, data: 'openid'},
    {testId: 'unknownAction', type: 'UNKNOWN_ACTION', data: 'invalid'},
];

const TestDispatch = () => {
    const dispatch = useAuthDispatch();
    return (
        <div>
            {actions.map(({testId, type, data}) => (
                <button key={testId} data-testid={testId} onClick={() => dispatch({type, data})}>
                    {testId}
                </button>
            ))}
        </div>
    );
};

const ErrorTest = ({hook}) => {
    hook();
    return null;
};

// ── Helpers ─────────────────────────────────────────────────────────────
let broadcastInstance;
beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    tokenExpiredCallbackRef.current = null;
    global.BroadcastChannel = class extends global.BroadcastChannel {
        constructor() {
            super();
            broadcastInstance = this;
        }
    };
    mockSigninSilent.mockReset();
    mockAddAccessTokenExpired.mockReset().mockImplementation(cb => {
        tokenExpiredCallbackRef.current = cb;
    });
    mockRemoveAccessTokenExpired.mockReset().mockImplementation(cb => {
        if (cb === tokenExpiredCallbackRef.current) tokenExpiredCallbackRef.current = null;
    });
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
});

const renderProvider = () =>
    render(
        <AuthProvider>
            <TestAuth/>
            <TestDispatch/>
        </AuthProvider>
    );

const click = (testId) => fireEvent.click(screen.getByTestId(testId));
const getText = (id) => screen.getByTestId(id).textContent;

function withLocalStorageDisabled(callback) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {value: undefined, configurable: true});
    try {
        return callback();
    } finally {
        if (originalDescriptor) {
            Object.defineProperty(window, 'localStorage', originalDescriptor);
        } else {
            delete window.localStorage;
        }
    }
}

// ── Tests ───────────────────────────────────────────────────────────────
describe('AuthProvider', () => {
    test('initial state', () => {
        renderProvider();
        expect(getText('user')).toBe('null');
        expect(getText('isAuthenticated')).toBe('false');
        expect(getText('authChoice')).toBe('null');
        expect(getText('authInfo')).toBe('null');
        expect(getText('accessToken')).toBe('null');
    });

    test('renders children', () => {
        render(
            <AuthProvider>
                <div data-testid="child">Child</div>
            </AuthProvider>
        );
        expect(screen.getByTestId('child').textContent).toBe('Child');
    });

    test('useAuth and useAuthDispatch throw outside provider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {
        });
        expect(() => render(<ErrorTest hook={useAuth}/>)).toThrow(
            'useAuth must be used within an AuthProvider'
        );
        expect(() => render(<ErrorTest hook={useAuthDispatch}/>)).toThrow(
            'useAuthDispatch must be used within an AuthProvider'
        );
        spy.mockRestore();
    });

    describe('reducer actions', () => {
        test('handles all defined actions except unknown', () => {
            renderProvider();

            click('login');
            expect(getText('user')).toBe('"testuser"');
            expect(getText('isAuthenticated')).toBe('true');

            click('logout');
            expect(getText('user')).toBe('null');
            expect(getText('isAuthenticated')).toBe('false');
            expect(getText('accessToken')).toBe('null');

            click('setAccessToken');
            expect(getText('accessToken')).toBe('"mock-token"');
            expect(getText('isAuthenticated')).toBe('true');
            expect(updateEventSourceToken).toHaveBeenCalledWith('mock-token');

            click('setAuthInfo');
            expect(getText('authInfo')).toBe('{"provider":"openid"}');

            click('setAuthChoice');
            expect(getText('authChoice')).toBe('"sso"');
        });

        test('unknown action does not modify state', () => {
            renderProvider();
            click('unknownAction');
            expect(getText('user')).toBe('null');
            expect(getText('isAuthenticated')).toBe('false');
            expect(getText('authChoice')).toBe('null');
            expect(getText('authInfo')).toBe('null');
            expect(getText('accessToken')).toBe('null');
        });

        test('SetAccessToken with null clears storage', () => {
            localStorage.setItem('authToken', 'old');
            localStorage.setItem('refreshToken', 'old-refresh');
            renderProvider();
            click('setAccessTokenNull');
            expect(localStorage.getItem('authToken')).toBeNull();
            expect(localStorage.getItem('refreshToken')).toBeNull();
            expect(getText('isAuthenticated')).toBe('false');
        });

        test('SetAccessToken with null when localStorage is unavailable', () => {
            withLocalStorageDisabled(() => {
                renderProvider();
                click('setAccessTokenNull');
                expect(getText('isAuthenticated')).toBe('false');
                expect(getText('accessToken')).toBe('null');
            });
        });

        test('SetAccessToken with token when localStorage is unavailable', () => {
            withLocalStorageDisabled(() => {
                renderProvider();
                click('setAccessToken');
                expect(getText('accessToken')).toBe('"mock-token"');
                expect(getText('isAuthenticated')).toBe('true');
                expect(updateEventSourceToken).toHaveBeenCalledWith('mock-token');
            });
        });

        test('Logout when localStorage is unavailable', () => {
            withLocalStorageDisabled(() => {
                renderProvider();
                click('login');
                expect(getText('isAuthenticated')).toBe('true');
                click('logout');
                expect(getText('isAuthenticated')).toBe('false');
                expect(getText('accessToken')).toBe('null');
            });
        });
    });

    describe('token refresh (non-OpenID)', () => {
        beforeEach(() => {
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 60});
            refreshToken.mockResolvedValue('new-token');
        });

        const setValidToken = () => click('setAccessToken');

        test('schedules refresh on valid token', async () => {
            renderProvider();
            setValidToken();
            expect(logger.info).toHaveBeenCalledWith('Token refresh scheduled in', expect.any(Number), 'seconds');
            expect(decodeToken).toHaveBeenCalledWith('mock-token');
            expect(updateEventSourceToken).toHaveBeenCalledWith('mock-token');

            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
            });
            expect(refreshToken).toHaveBeenCalled();
        });

        test('clears previous timeout when a new token is set', async () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
            renderProvider();
            click('setAccessToken'); // first token
            await act(async () => {
            }); // flush effect to schedule first timer
            const firstCallCount = clearTimeoutSpy.mock.calls.length; // should be 0 (no clear yet)
            click('setAccessToken2'); // second token (different value)
            await act(async () => {
            }); // flush effect to schedule second timer
            // clearTimeout should have been called once to clear the first timer
            expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(firstCallCount);
            clearTimeoutSpy.mockRestore();
        });

        test('broadcasts tokenUpdated on successful refresh', async () => {
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 10});
            renderProvider();
            setValidToken();

            await act(async () => {
                vi.advanceTimersByTime(5100);
                await Promise.resolve();
            });
            expect(refreshToken).toHaveBeenCalled();
            expect(broadcastInstance._messages).toContainEqual({type: 'tokenUpdated', data: 'new-token'});
        });

        test('handles refresh error and broadcasts logout', async () => {
            refreshToken.mockRejectedValue(new Error('fail'));
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 10});
            renderProvider();
            setValidToken();
            expect(getText('accessToken')).toBe('"mock-token"');

            await act(async () => {
                vi.advanceTimersByTime(5100);
                await Promise.resolve();
            });
            await act(async () => {
                await Promise.resolve();
            });
            expect(logger.error).toHaveBeenCalledWith('Token refresh error:', expect.any(Error));
            expect(getText('accessToken')).toBe('null');
            expect(getText('isAuthenticated')).toBe('false');
            expect(broadcastInstance._messages).toContainEqual({type: 'logout'});
        });

        test('skips refresh when token updated by another tab', async () => {
            renderProvider();
            setValidToken();
            localStorage.setItem('authToken', 'different-token');
            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
            });
            expect(logger.debug).toHaveBeenCalledWith('Refresh skipped, token already updated by another tab');
            expect(decodeToken).toHaveBeenCalledWith('different-token');
        });

        test('refresh proceeds even if localStorage token is missing during timer', async () => {
            renderProvider();
            setValidToken();
            localStorage.removeItem('authToken');
            await act(async () => {
                vi.runAllTimers();
                await Promise.resolve();
            });
            expect(refreshToken).toHaveBeenCalled();
            expect(logger.debug).not.toHaveBeenCalledWith(
                'Refresh skipped, token already updated by another tab'
            );
        });

        test('clears timeout on unmount', () => {
            const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
            const {unmount} = renderProvider();
            setValidToken();
            unmount();
            expect(clearTimeoutSpy).toHaveBeenCalled();
            clearTimeoutSpy.mockRestore();
        });

        test('does not schedule refresh for token with no exp field', () => {
            decodeToken.mockReturnValue({});
            renderProvider();
            setValidToken();
            expect(logger.info).not.toHaveBeenCalledWith('Token refresh scheduled in', expect.any(Number), 'seconds');
            expect(refreshToken).not.toHaveBeenCalled();
        });

        test('does not schedule refresh for expired token and logs out', () => {
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 10});
            renderProvider();
            setValidToken();
            expect(logger.warn).toHaveBeenCalledWith('Token already expired or too close to expiration, no refresh scheduled');
            expect(getText('isAuthenticated')).toBe('false');
            expect(refreshToken).not.toHaveBeenCalled();
        });

        test('does not schedule refresh when authChoice is openid', () => {
            renderProvider();
            click('setAuthChoiceOpenid');
            setValidToken();
            expect(logger.info).not.toHaveBeenCalledWith('Token refresh scheduled in', expect.any(Number), 'seconds');
            expect(refreshToken).not.toHaveBeenCalled();
        });

        test('does not schedule refresh for null token', () => {
            renderProvider();
            click('setAccessTokenNull');
            expect(logger.info).not.toHaveBeenCalledWith('Token refresh scheduled in', expect.any(Number), 'seconds');
        });
    });

    describe('BroadcastChannel', () => {
        test('does not initialize when undefined', () => {
            const orig = global.BroadcastChannel;
            delete global.BroadcastChannel;
            renderProvider();
            expect(logger.info).not.toHaveBeenCalled();
            global.BroadcastChannel = orig;
        });

        test('handles tokenUpdated message and schedules refresh', async () => {
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 60});
            renderProvider();
            click('setAccessToken');

            await act(async () => {
                broadcastInstance.onmessage({data: {type: 'tokenUpdated', data: 'updated-token'}});
            });
            expect(logger.info).toHaveBeenCalledWith('Token updated from another tab');
            expect(getText('accessToken')).toBe('"updated-token"');
            expect(decodeToken).toHaveBeenCalledWith('updated-token');
        });

        test('handles tokenUpdated with openid choice (no reschedule)', async () => {
            renderProvider();
            click('setAuthChoiceOpenid');
            await act(async () => {
                broadcastInstance.onmessage({data: {type: 'tokenUpdated', data: 'new-token'}});
            });
            expect(logger.info).toHaveBeenCalledWith('Token updated from another tab');
            expect(logger.info).not.toHaveBeenCalledWith('Token refresh scheduled in', expect.any(Number), 'seconds');
        });

        test('handles logout message', async () => {
            renderProvider();
            click('login');
            expect(getText('isAuthenticated')).toBe('true');
            await act(async () => {
                broadcastInstance.onmessage({data: {type: 'logout'}});
            });
            expect(logger.info).toHaveBeenCalledWith('Logout triggered from another tab');
            expect(getText('isAuthenticated')).toBe('false');
            expect(getText('accessToken')).toBe('null');
        });

        test.each([
            {data: undefined},
            {data: null},
        ])('ignores message with $data data', async ({data}) => {
            renderProvider();
            await act(async () => {
                broadcastInstance.onmessage({data});
            });
            expect(logger.info).not.toHaveBeenCalledWith('Token updated from another tab');
            expect(logger.info).not.toHaveBeenCalledWith('Logout triggered from another tab');
        });
    });

    describe('OpenID session', () => {
        test('starts with the auth choice kept in localStorage', () => {
            localStorage.setItem('authChoice', 'openid');
            renderProvider();
            expect(getText('authChoice')).toBe('"openid"');
        });

        // An OpenID token found expired on a reload is the UserManager's to renew:
        // the basic refresh took it for its own and logged out, every tab with it.
        test('keeps an expired OpenID token found on a reload', () => {
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) - 10});
            localStorage.setItem('authChoice', 'openid');
            localStorage.setItem('authToken', 'expired-oidc-token');
            renderProvider();
            expect(getText('accessToken')).toBe('"expired-oidc-token"');
            expect(localStorage.getItem('authToken')).toBe('expired-oidc-token');
            expect(logger.warn).not.toHaveBeenCalledWith('Token already expired or too close to expiration, no refresh scheduled');
            expect(broadcastInstance._messages).not.toContainEqual({type: 'logout'});
        });

        test('leaves the token expiry to the UserManager', () => {
            renderProvider();
            click('setAuthChoiceOpenid');
            expect(mockAddAccessTokenExpired).not.toHaveBeenCalled();
            expect(mockSigninSilent).not.toHaveBeenCalled();
        });
    });

    describe('localStorage not available', () => {
        test('initial state has null accessToken when localStorage is unavailable', () => {
            withLocalStorageDisabled(() => {
                renderProvider();
                expect(getText('accessToken')).toBe('null');
                expect(getText('isAuthenticated')).toBe('false');
            });
        });

        test('reschedule refresh effect does not break when localStorage is unavailable', async () => {
            withLocalStorageDisabled(() => {
                renderProvider();
                expect(logger.info).not.toHaveBeenCalledWith(
                    'Token refresh scheduled in',
                    expect.any(Number),
                    'seconds'
                );
            });
        });
    });

    describe('initial access token from localStorage', () => {
        test('loads access token from localStorage on initial render', () => {
            decodeToken.mockReturnValue({exp: Math.floor(Date.now() / 1000) + 60});
            localStorage.setItem('authToken', 'stored-token');
            renderProvider();
            expect(getText('accessToken')).toBe('"stored-token"');
            expect(logger.info).toHaveBeenCalledWith(
                'Token refresh scheduled in',
                expect.any(Number),
                'seconds'
            );
        });
    });
});
