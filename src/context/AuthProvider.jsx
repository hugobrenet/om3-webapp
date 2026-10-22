import React, {createContext, useCallback, useContext, useEffect, useReducer, useRef} from 'react';
import {decodeToken as decodeTokenFromLogin, refreshToken as doRefreshToken} from '../components/Login';
import {updateEventSourceToken} from '../eventSourceManager';
import logger from '../utils/logger.js';

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
            const browserStorage = getLocalStorage();
            browserStorage?.removeItem('authToken');
            browserStorage?.removeItem('tokenExpiration');
            browserStorage?.removeItem('refreshToken');
            browserStorage?.removeItem('refreshTokenExpiration');
            return {...state, user: null, isAuthenticated: false, accessToken: null};
        }
        case SetAccessToken: {
            const browserStorage = getLocalStorage();
            if (action.data) {
                browserStorage?.setItem('authToken', action.data);
                // Notify EventSource manager about token update
                updateEventSourceToken(action.data);
            } else {
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
        const refreshTime = expirationTime - Date.now() - 5000;

        if (refreshTime > 0) {
            logger.info('Token refresh scheduled in', Math.round(refreshTime / 1000), 'seconds');

            refreshTimeout.current = setTimeout(async () => {
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
                    }
                } catch (err) {
                    logger.error('Token refresh error:', err);
                    dispatch({type: Logout});
                    if (typeof BroadcastChannel !== 'undefined' && channel.current) {
                        channel.current.postMessage({type: 'logout'});
                    }
                }
            }, refreshTime);
        } else {
            logger.warn('Token already expired or too close to expiration, no refresh scheduled');
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
        channel.current = new BroadcastChannel('auth-channel');
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

export const useAuthDispatch = () => {
    const context = useContext(AuthDispatchContext);
    if (context === null) throw new Error('useAuthDispatch must be used within an AuthProvider');
    return context;
};
