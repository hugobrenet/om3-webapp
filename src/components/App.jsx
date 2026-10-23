import React, {useEffect, useCallback, lazy, Suspense, useRef} from "react";
import {Routes, Route, Navigate, useNavigate, useLocation, useParams} from "react-router-dom";
import {useTranslation} from "react-i18next";
import OidcCallback from "./OidcCallback";
import SilentRenew from "./SilentRenew.jsx";
import AuthChoice from "./AuthChoice.jsx";
import Login from "./Login.jsx";
import '../styles/main.css';
import NavBar from './NavBar';
import {Sidebar, menuAlert, useSidebarOpen} from './Sidebar';
import {useSidebarAlertsOf, useSidebarState} from '../hooks/useSidebarAlerts';
import {OidcProvider, useOidc} from "../context/OidcAuthContext.tsx";
import {
    AuthProvider,
    useAuth,
    useAuthDispatch,
    SetAccessToken,
    SetAuthChoice,
    Login as LoginAction
} from "../context/AuthProvider";
import oidcConfiguration from "../config/oidcConfiguration.js";
import useAuthInfo from "../hooks/AuthInfo.jsx";
import {getAiAgentConfig} from "../config/ai-agent.js";
import logger from "../utils/logger.js";
import {prepareForNavigation} from "../eventSourceManager";
import {isRenewalRefused} from "../context/serialRenewal";
import {PeekPanel} from "./PeekPanel";
import {PanelReopenKey} from "../app/PanelReopenKey";
import {ActionTray} from "../app/ActionTray";
import {ShortcutsHelp} from "../app/ShortcutsHelp";
import {PageIntro} from "./PageIntro";
import {InstantTitles} from "../app/InstantTitles";
import {useShortcut} from "../ui/lib/shortcuts";

import {decodeToken as decodeTokenFromLogin} from "./Login.jsx";
import {rememberReturn} from "../app/after-login";

// Lazy load components for code splitting
const NodesTable = lazy(() => import("./NodesTable"));
const Objects = lazy(() => import("./Objects"));
const Namespaces = lazy(() => import("./Namespaces"));
const Heartbeats = lazy(() => import("./Heartbeats"));
const Pools = lazy(() => import("./Pools"));
const Stores = lazy(() => import("./Stores"));
const ClusterView = lazy(() => import("./ClusterView"));
const Resources = lazy(() => import("./Resources"));
const Network = lazy(() => import("./Network"));
const WhoAmI = lazy(() => import("./WhoAmI"));
const Glossary = lazy(() => import("./Glossary"));
const About = lazy(() => import("./About"));
const TokenPage = lazy(() => import("./TokenPage"));

/*
 * The records had pages of their own; they open in a panel over their list now, as
 * in oc3 (`panel-search.ts`). The old addresses, bookmarked or shared, lead there.
 */
const ObjectRedirect = () => {
    const {objectName} = useParams();
    return <Navigate to={`/objects?${new URLSearchParams({sel: decodeURIComponent(objectName)})}`} replace/>;
};

const NetworkRedirect = () => {
    const {networkName} = useParams();
    return <Navigate to={`/network?${new URLSearchParams({sel: networkName})}`} replace/>;
};

/** An old page become a tab of the Objects page: there, its filter kept. */
const ObjectsTab = ({list}) => {
    const {search} = useLocation();
    const params = new URLSearchParams(search);
    params.set("list", list);
    return <Navigate to={`/objects?${params}`} replace/>;
};

/**
 * The Objects page; its former namespaces tab is the Namespaces view now: a link
 * to it lands there, the namespace open in it kept.
 */
const ObjectsRoute = () => {
    const {search} = useLocation();
    const params = new URLSearchParams(search);
    if (params.get("list") !== "namespaces") return <Objects/>;
    params.delete("list");
    const query = params.toString();
    return <Navigate to={`/namespaces${query ? `?${query}` : ""}`} replace/>;
};

// An instance is a column of the status board of its object.
const InstanceRedirect = () => {
    const {objectName} = useParams();
    return <Navigate to={`/objects?${new URLSearchParams({sel: decodeURIComponent(objectName)})}`} replace/>;
};
const AiChat = lazy(() => import("./AiChat"));

// Loading component for Suspense fallback
const Loading = () => {
    const {t} = useTranslation();
    return (
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>
            <div style={{fontSize: '1.125rem'}}>{t("nav.loading")}</div>
        </div>
    );
};

const isTokenValid = (token) => {
    if (!token) {
        logger.debug("No token found in localStorage");
        return false;
    }

    const payload = decodeTokenFromLogin(token);
    if (!payload || !payload.exp) {
        return false
    }

    const now = Date.now() / 1000;
    const expiration = payload.exp;
    const isValid = expiration > now;
    logger.debug(`Token validation: expires_at=${expiration}, now=${now}, valid=${isValid}`);
    return isValid;
};

// Component to handle OIDC initialization
const OidcInitializer = ({children, authInfo}) => {
    const location = useLocation();
    const {userManager, recreateUserManager, isInitialized} = useOidc();
    const authDispatch = useAuthDispatch();
    const auth = useAuth();
    const navigate = useNavigate();
    const resumeCheckTimer = useRef(null); // debounce timer

    // The navigate of the router changes with the location: kept in a ref, the
    // handlers stay the same functions, the ones registered on the UserManager.
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;

    const onUserRefreshed = useCallback((user) => {
        logger.info("User refreshed:", user.profile?.preferred_username, "expires_at:", user.expires_at);
        authDispatch?.({type: SetAccessToken, data: user.access_token});
        localStorage.setItem('authToken', user.access_token);
        localStorage.setItem('tokenExpiration', user.expires_at.toString());
    }, [authDispatch]);

    const endSession = useCallback((reason, error) => {
        logger.warn(`OpenID session ended (${reason}), redirecting to /auth-choice`, error ?? '');
        authDispatch?.({type: SetAccessToken, data: null});
        localStorage.removeItem('authToken');
        localStorage.removeItem('tokenExpiration');
        navigateRef.current('/auth-choice', {replace: true});
    }, [authDispatch]);

    /*
     * Renews the access token with the refresh token. Only the provider refusing it
     * ends the session: a renewal not answered, the network down or the provider
     * slow, leaves it to the next attempt, the expiry, a 401 of the event streams,
     * the page coming back to the front. The renewals are one at a time
     * (serialRenewal): asked while another runs, this one shares its outcome.
     */
    const renewSession = useCallback((reason) => {
        if (!userManager) return Promise.resolve(null);
        return userManager.signinSilent().then((user) => {
            if (user && !user.expired) {
                logger.info(`Silent renew succeeded (${reason})`);
                onUserRefreshed(user);
                return user;
            }
            endSession(`${reason}, renewal gave no valid user`);
            return null;
        }).catch((error) => {
            if (isRenewalRefused(error)) {
                endSession(`${reason}, renewal refused`, error);
            } else {
                logger.warn(`Silent renew not answered (${reason}), session kept for the next attempt:`, error);
            }
            return null;
        });
    }, [userManager, onUserRefreshed, endSession]);

    // The library raises it on the expiry, and as soon as it loads a user already
    // expired, while the renewal of the startup runs: renewing shares that renewal.
    const handleTokenExpired = useCallback(() => {
        logger.warn('Access token expired, attempting silent renew');
        return renewSession('access token expired');
    }, [renewSession]);

    const handleSilentRenewError = useCallback((error) => {
        if (isRenewalRefused(error)) {
            endSession('automatic renewal refused', error);
        } else {
            logger.warn('Automatic silent renew not answered, session kept for the next attempt:', error);
        }
    }, [endSession]);

    const handleTokenExpiring = useCallback(() => {
        logger.debug('Access token is about to expire, attempting silent renew...');
    }, []);

    useEffect(() => {
        const init = async () => {
            const savedToken = localStorage.getItem('authToken');
            const savedAuthChoice = auth.authChoice || localStorage.getItem('authChoice');
            if (savedToken && savedAuthChoice === 'openid' && authInfo && !isInitialized) {
                logger.info("Initializing OIDC UserManager on app startup");
                try {
                    const config = await oidcConfiguration(authInfo);
                    recreateUserManager(config);
                    authDispatch?.({type: SetAuthChoice, data: 'openid'});
                    authDispatch?.({type: SetAccessToken, data: savedToken});
                } catch (error) {
                    logger.error("Failed to initialize OIDC on startup:", error);
                }
            }
        };
        init().catch((err) => logger.error("OIDC init error:", err));
    }, [authInfo, isInitialized, auth.authChoice, authDispatch, recreateUserManager]);

    useEffect(() => {
        if (!userManager || auth.authChoice !== 'openid') return undefined;
        logger.info("Setting up OIDC event listeners");
        const {events} = userManager;
        events.addUserLoaded(onUserRefreshed);
        events.addAccessTokenExpiring(handleTokenExpiring);
        events.addAccessTokenExpired(handleTokenExpired);
        events.addSilentRenewError(handleSilentRenewError);
        return () => {
            events.removeUserLoaded(onUserRefreshed);
            events.removeAccessTokenExpiring?.(handleTokenExpiring);
            events.removeAccessTokenExpired(handleTokenExpired);
            events.removeSilentRenewError(handleSilentRenewError);
        };
    }, [userManager, auth.authChoice, onUserRefreshed, handleTokenExpiring, handleTokenExpired, handleSilentRenewError]);

    // The user kept by the UserManager, once it is built: valid, the session goes on;
    // expired, it is renewed.
    useEffect(() => {
        if (!userManager || auth.authChoice !== 'openid') return;
        userManager.getUser().then(user => {
            if (user && !user.expired) {
                logger.info("Found existing valid user:", user.profile?.preferred_username);
                onUserRefreshed(user);
                authDispatch?.({type: LoginAction, data: user.profile.preferred_username});
            } else if (user && user.expired) {
                logger.debug("Found expired user, will attempt silent renew");
                renewSession('expired user on startup').then((renewed) => {
                    if (renewed?.profile) authDispatch?.({type: LoginAction, data: renewed.profile.preferred_username});
                });
            }
        }).catch(err => {
            logger.error("Error getting user:", err);
        });
        // On a new UserManager or a new choice only: not on every navigation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userManager, auth.authChoice]);

    useEffect(() => {
        if (auth.authChoice) {
            localStorage.setItem('authChoice', auth.authChoice);
        }
    }, [auth.authChoice]);

    useEffect(() => {
        const handler = (e) => {
            const path = e?.detail || '/auth-choice';
            navigate(path, {replace: true});
        };
        window.addEventListener('om3:auth-redirect', handler);
        return () => window.removeEventListener('om3:auth-redirect', handler);
    }, [navigate]);

    useEffect(() => {
        const handleCheckAuthOnResume = () => {
            const authPaths = ['/auth-choice', '/auth/login', '/auth-callback', '/silent-renew'];
            if (authPaths.includes(location.pathname)) {
                return;
            }
            try {
                const authChoice = localStorage.getItem('authChoice');
                const token = localStorage.getItem('authToken');
                if (authChoice === 'openid') {
                    if (!token) {
                        logger.warn('No OIDC token found on resume, redirecting to /auth-choice');
                        navigate('/auth-choice', {replace: true});
                    } else if (!isTokenValid(token)) {
                        if (userManager) {
                            logger.warn('OIDC token expired on resume, attempting silent renew');
                            void renewSession('resume');
                        } else {
                            // Still being built, the auth info and the provider
                            // configuration on their way: its startup renews.
                            logger.debug('OIDC token expired on resume, UserManager not ready yet, its startup renews');
                        }
                    }
                    return;
                }
                if (!isTokenValid(token)) {
                    logger.warn('Token invalid or expired on resume, redirecting to /auth-choice');
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('tokenExpiration');
                    localStorage.removeItem('authChoice');
                    navigate('/auth-choice', {replace: true});
                }
            } catch (err) {
                logger.error('Error while checking auth on resume:', err);
            }
        };

        const debouncedCheck = () => {
            if (resumeCheckTimer.current) {
                clearTimeout(resumeCheckTimer.current);
            }
            resumeCheckTimer.current = setTimeout(handleCheckAuthOnResume, 500);
        };

        const visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                debouncedCheck();
            }
        };
        const focusHandler = () => {
            debouncedCheck();
        };

        document.addEventListener('visibilitychange', visibilityHandler);
        window.addEventListener('focus', focusHandler);

        return () => {
            document.removeEventListener('visibilitychange', visibilityHandler);
            window.removeEventListener('focus', focusHandler);
            if (resumeCheckTimer.current) {
                clearTimeout(resumeCheckTimer.current);
            }
        };
    }, [navigate, userManager, renewSession, location.pathname]);

    return children;
};

const ProtectedRoute = ({children}) => {
    const location = useLocation();
    const token = localStorage.getItem("authToken");
    const authChoice = localStorage.getItem('authChoice');

    const authPaths = ['/auth-choice', '/auth/login', '/auth-callback', '/silent-renew'];
    if (authPaths.includes(location.pathname)) {
        return children;
    }

    if (authChoice === 'openid') {
        if (!token) {
            logger.warn("No OIDC token found, redirecting to /auth-choice");
            rememberReturn(location.pathname + location.search);
            return <Navigate to="/auth-choice" replace/>;
        }
        return children;
    }

    if (!isTokenValid(token)) {
        logger.warn("Invalid or expired token, redirecting to /auth-choice");
        localStorage.removeItem("authToken");
        localStorage.removeItem("tokenExpiration");
        localStorage.removeItem("authChoice");
        rememberReturn(location.pathname + location.search);
        return <Navigate to="/auth-choice" replace/>;
    }

    return children;
};

// The token page stands alone too: it is opened on a node to enroll, maybe with no session.
const AUTH_PATHS = ['/auth', '/login', '/silent-renew', '/token'];

const App = () => {
    logger.info("App init");
    const location = useLocation();
    const mainRef = useRef(null);

    const authInfo = useAuthInfo();
    const aiEnabled = getAiAgentConfig().enabled;
    const [sidebarOpen, toggleSidebar, {compact: compactMenu, fold: foldSidebar}] = useSidebarOpen();
    // The sign-in screens have no view to navigate to: no menu there.
    const showSidebar = !AUTH_PATHS.some((path) => location.pathname.startsWith(path));
    // The alerts of the menu, read once: on its entries, and on its button while folded.
    // The assistant asks its first questions from the same state.
    const sidebarState = useSidebarState({enabled: showSidebar});
    const sidebarAlerts = useSidebarAlertsOf(sidebarState);

    // "n", for navigation, moves the focus to the menu, on the entry of the view on
    // display, unfolding the menu first when it is folded: the focus waits for it to
    // leave `inert`.
    useShortcut("n", () => {
        if (!showSidebar) return false;
        if (!sidebarOpen) toggleSidebar();
        window.requestAnimationFrame(() => {
            const menu = document.getElementById("app-sidebar");
            const entry = menu?.querySelector('a[aria-current="page"]') ?? menu?.querySelector("a, button");
            entry?.focus();
        });
        return true;
    });

    // Another view starts at its top. Not a panel opening over the view, nor its
    // filters changing: those keep the place in the list.
    useEffect(() => {
        if (mainRef.current) {
            mainRef.current.scrollTop = 0;
        }
        prepareForNavigation();
    }, [location.pathname]);

    const appContainerStyle = {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--surface)',
        color: 'var(--ink)',
    };

    const mainStyle = {
        flex: 1,
        minWidth: 0,
        // No -webkit-overflow-scrolling: touch, the default since iOS 13: Safari clips
        // the fixed panels opened in the page to the scroller, under the top bar.
        overflowY: 'auto',
        width: '100%',
    };

    return (
        <AuthProvider>
            <OidcProvider>
                <OidcInitializer authInfo={authInfo}>
                    <div id="app-root-container" style={appContainerStyle}>
                        {/* The tooltips of every page, shown at once rather than after the browser's delay. */}
                        <InstantTitles/>
                        <NavBar
                            sidebarOpen={sidebarOpen}
                            onToggleSidebar={toggleSidebar}
                            menuAlert={sidebarOpen ? null : menuAlert(sidebarAlerts)}
                            showSidebarToggle={showSidebar}
                        />
                        <div style={{display: 'flex', flex: 1, minHeight: 0}}>
                            {/* Short of room, the menu folds once an entry is chosen. */}
                            {showSidebar && <Sidebar open={sidebarOpen} alerts={sidebarAlerts} onNavigate={compactMenu ? foldSidebar : undefined}/>}
                            <main id="app-scroll-container" ref={mainRef} style={mainStyle}>
                                {/* What the page is about, for someone new to OpenSVC. */}
                                <PageIntro/>
                                <Suspense fallback={<Loading/>}>
                                    <Routes>
                                        <Route path="/" element={<Navigate to="/cluster" replace/>}/>
                                        <Route path="/cluster" element={<ProtectedRoute><ClusterView/></ProtectedRoute>}/>
                                        {/* Tabs of the Objects page now: an old link lands there. */}
                                        <Route path="/namespaces" element={<ProtectedRoute><Namespaces/></ProtectedRoute>}/>
                                        <Route path="/kinds" element={<ObjectsTab list="any"/>}/>
                                        <Route path="/heartbeats" element={<ProtectedRoute><Heartbeats/></ProtectedRoute>}/>
                                        <Route path="/nodes" element={<ProtectedRoute><NodesTable/></ProtectedRoute>}/>
                                        <Route path="/pools" element={<ProtectedRoute><Pools/></ProtectedRoute>}/>
                                        <Route path="/stores" element={<ProtectedRoute><Stores/></ProtectedRoute>}/>
                                        <Route path="/resources" element={<ProtectedRoute><Resources/></ProtectedRoute>}/>
                                        <Route path="/network" element={<ProtectedRoute><Network/></ProtectedRoute>}/>
                                        <Route path="/network/:networkName" element={<NetworkRedirect/>}/>
                                        <Route path="/objects" element={<ProtectedRoute><ObjectsRoute/></ProtectedRoute>}/>
                                        <Route path="/objects/:objectName" element={<ObjectRedirect/>}/>
                                        <Route path="/nodes/:node/objects/:objectName" element={<InstanceRedirect/>}/>
                                        <Route path="/whoami" element={<ProtectedRoute><WhoAmI/></ProtectedRoute>}/>
                                        <Route path="/glossary" element={<ProtectedRoute><Glossary/></ProtectedRoute>}/>
                                        {/* The legal information read by all, signed in or not. */}
                                        <Route path="/about" element={<About/>}/>
                                        <Route path="/token" element={<TokenPage/>}/>
                                        <Route path="/ai" element={<ProtectedRoute>{aiEnabled ? <AiChat status={sidebarState}/> : <Navigate to="/" replace/>}</ProtectedRoute>}/>
                                        <Route path="/silent-renew" element={<SilentRenew/>}/>
                                        <Route path="/auth-callback" element={<OidcCallback/>}/>
                                        <Route path="/auth-choice" element={<AuthChoice authInfo={authInfo}/>}/>
                                        <Route path="/auth/login" element={<Login/>}/>
                                        <Route path="*" element={<Navigate to="/"/>}/>
                                    </Routes>
                                    {/* The record opened from a badge or the search palette, whatever
                                        the view, and the key that brings it back once closed. */}
                                    {showSidebar && localStorage.getItem("authToken") && (
                                        <>
                                            <PeekPanel/>
                                            <PanelReopenKey/>
                                            <ShortcutsHelp/>
                                            {/* The actions asked, followed to their end, whatever the view. */}
                                            <ActionTray/>
                                        </>
                                    )}
                                </Suspense>
                            </main>
                        </div>
                    </div>
                </OidcInitializer>
            </OidcProvider>
        </AuthProvider>
    );
};

export default App;
