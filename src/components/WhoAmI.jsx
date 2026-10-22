import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {URL_AUTH_WHOAMI} from '../config/apiPath';
import {Button} from '../ui/components/Button';
import {Select} from '../ui/components/Field';
import {Alert} from '../ui/components/Alert';
import {Spinner} from '../ui/components/Spinner';
import {GlobeIcon, LockIcon, MoonIcon, ServerIcon, SignOutIcon, SunIcon, UserIcon} from '../ui/icons';
import {useOidc} from "../context/OidcAuthContext.tsx";
import {useAuth, useAuthDispatch, Logout} from "../context/AuthProvider.jsx";
import {useNavigate} from "react-router-dom";
import logger from '../utils/logger.js';
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus";
import {useDarkMode} from "../context/DarkModeContext";
import {clearObjectCache} from "../hooks/useEventStore.js";
import {LANGUAGES, LANGUAGE_NAMES, isLanguage, setLanguage} from "../i18n";

/** A labelled value of a panel: the label muted above, the value in monospace. */
const Value = ({label, children}) => (
    <div>
        <dt className="text-data text-ink-muted">{label}</dt>
        <dd className="font-mono">{children}</dd>
    </div>
);

/** Error of a failed WhoAmI request, translated at render. */
const LOAD_ERROR = Symbol('loadError');

const WhoAmI = () => {
    const [userInfo, setUserInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // null while loading, '' when unknown.
    const [appVersion, setAppVersion] = useState(null);
    const {userManager} = useOidc();
    const auth = useAuth();
    const authDispatch = useAuthDispatch();
    const navigate = useNavigate();
    const {daemon, fetchNodes} = useFetchDaemonStatus();
    const {isDarkMode, toggleDarkMode} = useDarkMode();
    const {t, i18n} = useTranslation();

    // Fetch version from GitHub
    useEffect(() => {
        const fetchVersion = async () => {
            const cached = localStorage.getItem('appVersion');
            const cacheTime = localStorage.getItem('appVersionTime');
            const now = Date.now();

            if (cached && cacheTime && (now - parseInt(cacheTime)) < 3600000) {
                setAppVersion(cached);
                return;
            }

            try {
                const response = await fetch('https://api.github.com/repos/opensvc/om3-webapp/releases', {
                    headers: {'User-Agent': 'MonTestCurl'}
                });
                const data = await response.json();
                const latestVersion = data[0]?.tag_name || '';
                const cleanVersion = latestVersion.startsWith('v') ? latestVersion.slice(1) : latestVersion;

                setAppVersion(cleanVersion);
                localStorage.setItem('appVersion', cleanVersion);
                localStorage.setItem('appVersionTime', now.toString());
            } catch (error) {
                logger.error('Error fetching version:', error);
                setAppVersion(cached || '');
            }
        };

        void fetchVersion();
    }, []);

    // Fetch daemon status
    useEffect(() => {
        const fetchDaemonData = async () => {
            const token = localStorage.getItem("authToken");
            if (token) {
                try {
                    await fetchNodes(token);
                } catch (error) {
                    logger.error("Error fetching daemon status:", error);
                }
            }
        };

        void fetchDaemonData();
    }, [fetchNodes]);

    // Fetch WhoAmI
    useEffect(() => {
        const fetchUserInfo = async () => {
            try {
                const response = await fetch(URL_AUTH_WHOAMI, {
                    credentials: 'include',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                    }
                });

                if (!response.ok) {
                    setError(LOAD_ERROR);
                    return;
                }
                setUserInfo(await response.json());
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        void fetchUserInfo();
    }, []);

    const handleLogout = () => {
        if (auth?.authChoice === "openid") {
            void userManager.signoutRedirect();
            void userManager.removeUser();
        }
        localStorage.removeItem("authToken");
        clearObjectCache();
        if (authDispatch) {
            authDispatch({type: Logout});
        }
        navigate("/auth-choice");
    };

    if (loading) return (
        <div className="p-4">
            <Spinner label={t('user.loading')}/>
        </div>
    );
    if (error) return (
        <div className="p-4">
            <Alert>{error === LOAD_ERROR ? t('user.loadError') : String(error)}</Alert>
        </div>
    );

    const PANEL = "rounded-(--radius-panel) border border-line bg-surface-raised p-3";

    return (
        <div className="p-4 space-y-3">
            <div className="grid gap-3 lg:grid-cols-3">
                <section aria-labelledby="whoami-my-info" className={PANEL}>
                    <h2 id="whoami-my-info" className="mb-2 flex items-center gap-2 font-semibold">
                        <UserIcon className="text-accent"/>
                        {t('user.myInfo')}
                    </h2>
                    <dl className="space-y-2">
                        <Value label={t('user.username')}>{userInfo?.name || t('common.notAvailable')}</Value>
                        <Value label={t('user.authMethod')}>{userInfo?.auth || t('common.notAvailable')}</Value>
                    </dl>
                </section>

                <section aria-labelledby="whoami-permissions" className={PANEL}>
                    <h2 id="whoami-permissions" className="mb-2 flex items-center gap-2 font-semibold">
                        <LockIcon className="text-accent"/>
                        {t('user.permissions')}
                    </h2>
                    <dl className="rounded-(--radius-control) bg-surface-sunken p-2">
                        <Value label={t('user.rawPermissions')}>{userInfo?.raw_grant || t('common.none')}</Value>
                    </dl>
                </section>

                <section aria-labelledby="whoami-server" className={PANEL}>
                    <h2 id="whoami-server" className="mb-2 flex items-center gap-2 font-semibold">
                        <ServerIcon className="text-accent"/>
                        {t('user.server')}
                    </h2>
                    <dl className="space-y-2">
                        <Value label={t('user.connectedNode')}>{daemon?.nodename || t('user.nodeLoading')}</Value>
                        <div>
                            <dt className="text-data text-ink-muted">{t('user.webappVersion')}</dt>
                            <dd className="font-mono">
                                {appVersion === null
                                    ? t('user.versionLoading')
                                    : appVersion === '' ? t('user.versionUnknown') : `v${appVersion}`}
                            </dd>
                            <dd className="text-data text-ink-muted">{t('user.productName')}</dd>
                        </div>
                    </dl>
                </section>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {/* Each language named in itself: found whatever the language shown. */}
                <label className="flex items-center gap-2">
                    <GlobeIcon className="h-4 w-4 text-ink-muted"/>
                    <span>{t('user.language')}</span>
                    <Select
                        value={isLanguage(i18n.language) ? i18n.language : 'en'}
                        onChange={(event) => setLanguage(event.target.value)}
                    >
                        {LANGUAGES.map((language) => (
                            <option key={language} value={language} lang={language}>{LANGUAGE_NAMES[language]}</option>
                        ))}
                    </Select>
                </label>
                <Button
                    onClick={toggleDarkMode}
                    icon={isDarkMode ? <SunIcon className="h-4 w-4"/> : <MoonIcon className="h-4 w-4"/>}
                >
                    {isDarkMode ? t('user.lightMode') : t('user.darkMode')}
                </Button>
                <Button icon={<SignOutIcon/>} onClick={handleLogout}>
                    {t('user.logout')}
                </Button>
            </div>
        </div>
    );
};

export default WhoAmI;
