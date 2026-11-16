import React, {createContext, useCallback, useContext, useEffect, useReducer, useRef} from 'react';
import {decodeToken as decodeTokenFromLogin, hasRefreshToken, refreshToken as doRefreshToken} from '../components/Login';
import {updateEventSourceToken} from '../eventSourceManager';
import logger from '../utils/logger.js';
import {AUTH_CHANNEL, forgetSession} from '../app/session';

const getLocalStorage = () => (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined' ? window.localStorage : null);

const baseInitialState = {
    user: null,
    isAuthenticated: false,
    authChoice: null,
    authInfo: null,
    accessToken: null,
};

// The token and the way it was got, both kept across reloads: an OpenID token taken
// for a basic one on the first render was logged out by the basic refresh, expired
// as it is when the page comes back, before the UserManager could renew it.
const getInitialState = () => {
    const hasStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    return {
        ...baseInitialState,
        accessToken: hasStorage ? localStorage.getItem('authToken') : null,
        authChoice: hasStorage ? localStorage.getItem('authChoice') || null : null,
    };
};

export const Login = 'Login';
export const Logout = 'Logout';
export const SetAuthInfo = 'SetAuthInfo';
export const SetAccessToken = 'SetAccessToken';
export const SetAuthChoice = 'SetAuthChoice';

const authReducer = (state, action) => {
    switch (action.type) {
        case Login:
            return {...state, user: action.data, isAuthenticated: true};
        case Logout: {
            // Nothing of the session left to the next user. Idempotent, the reducer run twice in StrictMode.
            forgetSession();
            const browserStorage = getLocalStorage();
            browserStorage?.removeItem('authToken');
            browserStorage?.removeItem('tokenExpiration');
            browserStorage?.removeItem('refreshToken');
            browserStorage?.removeItem('refreshTokenExpiration');
            // The way in goes with the session: an "openid" left would have the next
            // password session taken for an OpenID one, and never refreshed.
            browserStorage?.removeItem('authChoice');
            return {...state, user: null, isAuthenticated: false, accessToken: null, authChoice: null};
        }
        case SetAccessToken: {
            const browserStorage = getLocalStorage();
            if (action.data) {
                browserStorage?.setItem('authToken', action.data);
                // Notify EventSource manager about token update
                updateEventSourceToken(action.data);
            } else {
                // No token: the session ended (its renewal refused, the OpenID one ended).
                forgetSession();
                browserStorage?.removeItem('authToken');
                browserStorage?.removeItem('tokenExpiration');
                browserStorage?.removeItem('refreshToken');
                browserStorage?.removeItem('refreshTokenExpiration');
            }
            return {...state, accessToken: action.data, isAuthenticated: !!action.data};
        }
        case SetAuthInfo:
            return {...state, authInfo: action.data};
        case SetAuthChoice:
            return {...state, authChoice: action.data};
        default:
            return state;
    }
};

/**
 * The delays before a renewal is tried again, its refresh token kept: the network or
 * the daemon failed, not the token. The last one repeated while the token is valid.
 */
const RETRY_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];

const AuthContext = createContext(null);
const AuthDispatchContext = createContext(null);

export const AuthProvider = ({children}) => {
    const [auth, dispatch] = useReducer(authReducer, undefined, getInitialState);
    const refreshTimeout = useRef(null);
    const channel = useRef(null);

    // Refresh function for non-OpenID
    const scheduleRefresh = useCallback((token) => {
        if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
        if (!token || auth.authChoice === 'openid') return;

        const payload = decodeTokenFromLogin(token);
        if (!payload?.exp) return;

        const expirationTime = payload.exp * 1000;
        // Expired already, a tab reopened after a while: renewed at once with the refresh
        // token, if one is held and valid; ended only without one.
        const refreshTime = Math.max(expirationTime - Date.now() - 5000, hasRefreshToken() ? 0 : -1);

        if (refreshTime >= 0) {
            logger.info('Token refresh scheduled in', Math.round(refreshTime / 1000), 'seconds');

            const renew = async (attempt) => {
                const latestToken = localStorage.getItem('authToken');
                if (latestToken && latestToken !== token) {
                    logger.debug('Refresh skipped, token already updated by another tab');
                    scheduleRefresh(latestToken);
                    return;
                }
                try {
                    const newToken = await doRefreshToken(dispatch);
                    if (newToken) {
                        if (typeof BroadcastChannel !== 'undefined' && channel.current) {
                            channel.current.postMessage({type: 'tokenUpdated', data: newToken});
                        }
                        scheduleRefresh(newToken);
                        return;
                    }
                    // Refused, the tokens are cleared: the session ended. Failed otherwise (the
                    // network, the daemon restarting), the refresh token kept: tried again.
                    if (hasRefreshToken()) {
                        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
                        logger.info('Token refresh tried again in', Math.round(delay / 1000), 'seconds');
                        refreshTimeout.current = setTimeout(() => void renew(attempt + 1), delay);
                    } else if (Date.now() >= expirationTime) {
                        // The refresh token expired meanwhile, the access token too: nothing to renew it with.
                        dispatch({type: Logout});
                        if (typeof BroadcastChannel !== 'undefined' && channel.current) {
                            channel.current.postMessage({type: 'logout'});
                        }
                    }
                } catch (err) {
                    logger.error('Token refresh error:', err);
                    dispatch({type: Logout});
                    if (typeof BroadcastChannel !== 'undefined' && channel.current) {
                        channel.current.postMessage({type: 'logout'});
                    }
                }
            };
            refreshTimeout.current = setTimeout(() => void renew(0), refreshTime);
        } else {
            logger.warn('Token expired and no refresh token to renew it: session ended');
            dispatch({type: Logout});
            if (typeof BroadcastChannel !== 'undefined' && channel.current) {
                channel.current.postMessage({type: 'logout'});
            }
        }
    }, [auth.authChoice, dispatch]);

    // The OpenID renewal is the UserManager's, its events handled by OidcInitializer
    // (App.jsx): a second handler here logged out on a renewal it did not wait for.

    // Multi-tab synchronization (only in browser)
    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        channel.current = new BroadcastChannel(AUTH_CHANNEL);
        channel.current.onmessage = (event) => {
            const {type, data} = event.data || {};
            if (type === 'tokenUpdated') {
                logger.info('Token updated from another tab');
                dispatch({type: SetAccessToken, data});
                if (auth.authChoice !== 'openid') {
                    scheduleRefresh(data);
                }
            } else if (type === 'logout') {
                logger.info('Logout triggered from another tab');
                dispatch({type: Logout});
            }
        };
        return () => channel.current?.close();
    }, [auth.authChoice, scheduleRefresh]);

    // Reschedule refresh when token changes
    useEffect(() => {
        const token = auth.accessToken ?? (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
            ? localStorage.getItem('authToken')
            : null);
        if (auth.authChoice !== 'openid') {
            scheduleRefresh(token);
        }
        return () => {
            if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
        };
    }, [auth.accessToken, auth.authChoice, scheduleRefresh]);

    return (
        <AuthContext.Provider value={auth}>
            <AuthDispatchContext.Provider value={dispatch}>
                {children}
            </AuthDispatchContext.Provider>
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === null) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};

/** The user signed in, null when none or outside an AuthProvider: for a default, never required. */
export const useAuthUser = () => useContext(AuthContext)?.user ?? null;

/** The session, null outside an AuthProvider: for what shows to a signed-in user only, never required. */
export const useAuthSession = () => useContext(AuthContext);

export const useAuthDispatch = () => {
    const context = useContext(AuthDispatchContext);
    if (context === null) throw new Error('useAuthDispatch must be used within an AuthProvider');
    return context;
};
