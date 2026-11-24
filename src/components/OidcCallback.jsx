import React, {useEffect, useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useAuthDispatch, SetAccessToken, SetAuthChoice, Login} from "../context/AuthProvider.jsx";
import oidcConfiguration from "../config/oidcConfiguration.js";
import useAuthInfo from "../hooks/AuthInfo.jsx";
import {useOidc} from "../context/OidcAuthContext.tsx";
import logger from '../utils/logger.js';
import {takeReturn} from '../app/after-login';

/** Whether the query string carries an authorization response: a code or an error, with its state. */
export function hasAuthorizationResponse(search) {
    const params = new URLSearchParams(search);
    return params.has('state') && (params.has('code') || params.has('error'));
}

const OidcCallback = () => {
    const {userManager, recreateUserManager} = useOidc();
    const authDispatch = useAuthDispatch();
    const authInfo = useAuthInfo();
    const navigate = useNavigate();
    const {t} = useTranslation();

    const onUserRefreshed = useCallback((user) => {
        logger.info("User refreshed:", user.profile?.preferred_username, "expires_at:", user.expires_at);
        if (authDispatch) {
            authDispatch({type: SetAccessToken, data: user.access_token});
        }
        localStorage.setItem('authToken', user.access_token);
        localStorage.setItem('tokenExpiration', user.expires_at?.toString() || '');

        if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel('auth-channel');
            channel.postMessage({type: 'tokenUpdated', data: user.access_token, expires_at: user.expires_at});
            channel.close();
        }
    }, [authDispatch]);

    // No listener on the UserManager events here: they outlived this page, the
    // UserManager being the app's, and logged out at the first expiry of the access
    // token, its renewal not waited for. OidcInitializer (App.jsx) handles them.

    const handleSigninRedirect = useCallback(() => {
        userManager.signinRedirectCallback()
            .then((user) => {
                onUserRefreshed(user);
                if (authDispatch) {
                    authDispatch({type: SetAuthChoice, data: "openid"});
                    authDispatch({type: Login, data: user.profile.preferred_username});
                }
                navigate(takeReturn());
            })
            .catch((err) => {
                logger.error("signinRedirectCallback failed:", err);
                navigate('/auth-choice');
            });
    }, [userManager, authDispatch, navigate, onUserRefreshed]);

    useEffect(() => {
        const initializeUserManager = async () => {
            if (authInfo && !userManager) {
                logger.info("Initializing UserManager with authInfo");
                try {
                    const config = await oidcConfiguration(authInfo);
                    recreateUserManager(config);
                } catch (error) {
                    logger.error("Failed to initialize OIDC config:", error);
                    navigate('/auth-choice');
                }
            }
        };
        initializeUserManager().catch(error => {
            logger.error("Unhandled error in initializeUserManager:", error);
            navigate('/auth-choice');
        });
    }, [authInfo, userManager, recreateUserManager, navigate]);

    useEffect(() => {
        if (userManager) {
            logger.debug("Handling OIDC callback or session check");

            // The provider's answer in the address: the sign-in just made, processed
            // whatever user is still stored, maybe another's, its renewal refused.
            if (hasAuthorizationResponse(window.location.search)) {
                handleSigninRedirect();
            } else if (typeof userManager.getUser === 'function') {
                userManager.getUser().then((user) => {
                    if (user && !user.expired) {
                        logger.info("Existing user session found:", user.profile?.preferred_username);
                        onUserRefreshed(user);
                        navigate(takeReturn());
                    } else {
                        handleSigninRedirect();
                    }
                }).catch((err) => {
                    logger.error("Failed to get user:", err);
                    handleSigninRedirect();
                });
            } else {
                handleSigninRedirect();
            }
        }
    }, [userManager, handleSigninRedirect, onUserRefreshed, navigate]);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel('auth-channel');
        channel.onmessage = (event) => {
            const {type, data, expires_at} = event.data || {};
            if (type === 'logout') {
                // The session forgotten by the AuthProvider, which hears it too; told
                // back to no one, or two tabs here would tell each other forever.
                logger.info('Logout triggered from another tab');
                navigate('/auth-choice');
            } else if (type === 'tokenUpdated' && data && expires_at) {
                logger.info('Token updated from another tab');
                if (authDispatch) {
                    authDispatch({type: SetAccessToken, data});
                }
                localStorage.setItem('authToken', data);
                localStorage.setItem('tokenExpiration', expires_at.toString());
            }
        };
        return () => channel.close();
    }, [authDispatch, navigate]);

    return <>{t('auth.callback.logging')}</>;
};

export default OidcCallback;
