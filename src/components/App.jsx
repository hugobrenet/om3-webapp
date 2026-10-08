import React, {useEffect, useCallback, lazy, Suspense, useRef} from "react";
import {Routes, Route, Navigate, useNavigate, useLocation} from "react-router-dom";
import OidcCallback from "./OidcCallback";
import SilentRenew from "./SilentRenew.jsx";
import AuthChoice from "./AuthChoice.jsx";
import Login from "./Login.jsx";
import '../styles/main.css';
import NavBar from './NavBar';
import {Sidebar, useSidebarOpen} from './Sidebar';
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

import {decodeToken as decodeTokenFromLogin} from "./Login.jsx";

// Lazy load components for code splitting
const NodesTable = lazy(() => import("./NodesTable"));
const Objects = lazy(() => import("./Objects"));
const ObjectDetails = lazy(() => import("./ObjectDetails"));
const ObjectInstanceView = lazy(() => import("./ObjectInstanceView"));
const Namespaces = lazy(() => import("./Namespaces"));
const Kinds = lazy(() => import("./Kinds"));
const Heartbeats = lazy(() => import("./Heartbeats"));
const Pools = lazy(() => import("./Pools"));
const Network = lazy(() => import("./Network"));
const NetworkDetails = lazy(() => import("./NetworkDetails"));
const WhoAmI = lazy(() => import("./WhoAmI"));
const AiChat = lazy(() => import("./AiChat"));

// Loading component for Suspense fallback
const Loading = () => (
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>
        <div style={{fontSize: '1.125rem'}}>Loading...</div>
    </div>
);

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

    const handleTokenExpired = useCallback(() => {
        logger.warn('Access token expired, redirecting to /ui/auth-choice');
        authDispatch?.({type: SetAccessToken, data: null});
        localStorage.removeItem('authToken');
        localStorage.removeItem('tokenExpiration');
        navigate('/auth-choice', {replace: true});
    }, [authDispatch, navigate]);

    const handleSilentRenewError = useCallback((error) => {
        logger.error('Silent renew failed:', error);
        authDispatch?.({type: SetAccessToken, data: null});
        localStorage.removeItem('authToken');
        localStorage.removeItem('tokenExpiration');
        navigate('/auth-choice', {replace: true});
    }, [authDispatch, navigate]);

    const onUserRefreshed = useCallback((user) => {
        logger.info("User refreshed:", user.profile?.preferred_username, "expires_at:", user.expires_at);
        authDispatch?.({type: SetAccessToken, data: user.access_token});
        localStorage.setItem('authToken', user.access_token);
        localStorage.setItem('tokenExpiration', user.expires_at.toString());
    }, [authDispatch]);

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
        if (userManager && auth.authChoice === 'openid') {
            logger.info("Setting up OIDC event listeners");
            userManager.events.removeUserLoaded(onUserRefreshed);
            userManager.events.removeAccessTokenExpired(handleTokenExpired);
            userManager.events.removeSilentRenewError(handleSilentRenewError);
            userManager.events.addUserLoaded(onUserRefreshed);
            userManager.events.addAccessTokenExpiring(() => {
                logger.debug('Access token is about to expire, attempting silent renew...');
            });
            userManager.events.addAccessTokenExpired(handleTokenExpired);
            userManager.events.addSilentRenewError(handleSilentRenewError);
            userManager.getUser().then(user => {
                if (user && !user.expired) {
                    logger.info("Found existing valid user:", user.profile?.preferred_username);
                    onUserRefreshed(user);
                    authDispatch?.({type: LoginAction, data: user.profile.preferred_username});
                } else if (user && user.expired) {
                    logger.debug("Found expired user, will attempt silent renew");
                    userManager.signinSilent().then(refreshedUser => {
                        if (refreshedUser && !refreshedUser.expired) {
                            logger.info("Silent renew succeeded for:", refreshedUser.profile?.preferred_username);
                            onUserRefreshed(refreshedUser);
                            authDispatch?.({type: LoginAction, data: refreshedUser.profile.preferred_username});
                        } else {
                            logger.warn("Silent renew failed or user still expired, will trigger logout via error handler");
                        }
                    }).catch(error => {
                        logger.error("Silent renew failed:", error);
                    });
                }
            }).catch(err => {
                logger.error("Error getting user:", err);
            });
        }
    }, [userManager, auth.authChoice, authDispatch, handleTokenExpired, handleSilentRenewError, onUserRefreshed]);

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
                        logger.warn('OIDC token expired on resume, attempting silent renew');
                        if (userManager) {
                            userManager.signinSilent().then((user) => {
                                if (user && !user.expired) {
                                    logger.info('Silent renew succeeded on resume');
                                    onUserRefreshed(user);
                                } else {
                                    logger.warn('Silent renew failed on resume, redirecting to /auth-choice');
                                    navigate('/auth-choice', {replace: true});
                                }
                            }).catch((error) => {
                                logger.error('Silent renew error on resume:', error);
                                navigate('/auth-choice', {replace: true});
                            });
                        } else {
                            navigate('/auth-choice', {replace: true});
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
    }, [navigate, userManager, onUserRefreshed, location.pathname]);

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
            return <Navigate to="/auth-choice" replace/>;
        }
        return children;
    }

    if (!isTokenValid(token)) {
        logger.warn("Invalid or expired token, redirecting to /auth-choice");
        localStorage.removeItem("authToken");
        localStorage.removeItem("tokenExpiration");
        localStorage.removeItem("authChoice");
        return <Navigate to="/auth-choice" replace/>;
    }

    return children;
};

const AUTH_PATHS = ['/auth', '/login', '/silent-renew'];

const App = () => {
    logger.info("App init");
    const location = useLocation();
    const mainRef = useRef(null);

    const authInfo = useAuthInfo();
    const aiEnabled = getAiAgentConfig().enabled;
    const [sidebarOpen, toggleSidebar] = useSidebarOpen();
    // The sign-in screens have no view to navigate to: no menu there.
    const showSidebar = !AUTH_PATHS.some((path) => location.pathname.startsWith(path));

    useEffect(() => {
        if (mainRef.current) {
            mainRef.current.scrollTop = 0;
        }
        prepareForNavigation();
    }, [location]);

    useEffect(() => {
        const checkTokenChange = () => {
            const newToken = localStorage.getItem("authToken");
            logger.debug("Storage event: newToken=", newToken);
        };
        window.addEventListener("storage", checkTokenChange);
        return () => window.removeEventListener("storage", checkTokenChange);
    }, []);

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
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        width: '100%',
    };

    return (
        <AuthProvider>
            <OidcProvider>
                <OidcInitializer authInfo={authInfo}>
                    <div id="app-root-container" style={appContainerStyle}>
                        <NavBar
                            sidebarOpen={sidebarOpen}
                            onToggleSidebar={toggleSidebar}
                            showSidebarToggle={showSidebar}
                        />
                        <div style={{display: 'flex', flex: 1, minHeight: 0}}>
                            {showSidebar && <Sidebar open={sidebarOpen}/>}
                            <main id="app-scroll-container" ref={mainRef} style={mainStyle}>
                                <Suspense fallback={<Loading/>}>
                                    <Routes>
                                        <Route path="/" element={<Navigate to="/objects" replace/>}/>
                                        <Route path="/namespaces"
                                               element={<ProtectedRoute><Namespaces/></ProtectedRoute>}/>
                                        <Route path="/kinds" element={<ProtectedRoute><Kinds/></ProtectedRoute>}/>
                                        <Route path="/heartbeats" element={<Heartbeats/>}/>
                                        <Route path="/nodes" element={<ProtectedRoute><NodesTable/></ProtectedRoute>}/>
                                        <Route path="/pools" element={<ProtectedRoute><Pools/></ProtectedRoute>}/>
                                        <Route path="/network" element={<ProtectedRoute><Network/></ProtectedRoute>}/>
                                        <Route path="/network/:networkName"
                                               element={<ProtectedRoute><NetworkDetails/></ProtectedRoute>}/>
                                        <Route path="/objects" element={<ProtectedRoute><Objects/></ProtectedRoute>}/>
                                        <Route path="/objects/:objectName"
                                               element={<ProtectedRoute><ObjectDetails/></ProtectedRoute>}/>
                                        <Route path="/nodes/:node/objects/:objectName"
                                               element={<ProtectedRoute><ObjectInstanceView/></ProtectedRoute>}/>
                                        <Route path="/whoami" element={<ProtectedRoute><WhoAmI/></ProtectedRoute>}/>
                                        <Route path="/ai" element={<ProtectedRoute>{aiEnabled ? <AiChat/> : <Navigate to="/" replace/>}</ProtectedRoute>}/>
                                        <Route path="/silent-renew" element={<SilentRenew/>}/>
                                        <Route path="/auth-callback" element={<OidcCallback/>}/>
                                        <Route path="/auth-choice" element={<AuthChoice authInfo={authInfo}/>}/>
                                        <Route path="/auth/login" element={<Login/>}/>
                                        <Route path="*" element={<Navigate to="/"/>}/>
                                    </Routes>
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
