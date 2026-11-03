import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {URL_AUTH_WHOAMI} from '../config/apiPath';
import {Button} from '../ui/components/Button';
import {Checkbox, Select} from '../ui/components/Field';
import {Alert} from '../ui/components/Alert';
import {Spinner} from '../ui/components/Spinner';
import {GlobeIcon, InfoIcon, KeyIcon, MoonIcon, ServerIcon, GearIcon, SignOutIcon, SunIcon, UserIcon} from '../ui/icons';
import {useOidc} from "../context/OidcAuthContext.tsx";
import {useAuth, useAuthDispatch, Logout} from "../context/AuthProvider.jsx";
import {Link, useNavigate} from "react-router-dom";
import logger from '../utils/logger.js';
import {useApiNode} from "../hooks/useApiNode";
import {useDarkMode} from "../context/DarkModeContext";
import {clearObjectCache} from "../hooks/useEventStore.js";
import {LANGUAGES, LANGUAGE_NAMES, isLanguage, setLanguage} from "../i18n";
import {useReleaseCheck} from "../app/release-check";
import {APP_VERSION, isRelease} from "../app/version";
import {setIntrosEnabled, showAllIntros, useHiddenIntros, useIntrosEnabled} from "../app/page-intro";

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
    // The node answering the API, read once a session.
    const apiNode = useApiNode();
    const {isDarkMode, toggleDarkMode} = useDarkMode();
    const {t, i18n} = useTranslation();
    const introsEnabled = useIntrosEnabled();
    const hiddenIntros = useHiddenIntros();

    // The latest release, from GitHub: asked only when the user opted in, from the About page.
    const releaseCheck = useReleaseCheck();
    useEffect(() => {
        if (!releaseCheck) {
            setAppVersion(undefined);
            return;
        }
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
    }, [releaseCheck]);

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

    // Every control in the card of what it acts on: the session in the account, the
    // language, the theme and the hints in the preferences.
    return (
        <div className="p-4">
            <div className="grid gap-3 lg:grid-cols-2">
                <section aria-labelledby="whoami-my-info" className={`${PANEL} flex flex-col`}>
                    <h2 id="whoami-my-info" className="mb-2 flex items-center gap-2 font-semibold">
                        <UserIcon className="text-accent"/>
                        {t('user.myInfo')}
                    </h2>
                    <dl className="space-y-2">
                        <Value label={t('user.username')}>{userInfo?.name || t('common.notAvailable')}</Value>
                        <Value label={t('user.authMethod')}>{userInfo?.auth || t('common.notAvailable')}</Value>
                        <Value label={t('user.grants')}>{userInfo?.raw_grant || t('common.none')}</Value>
                    </dl>
                    <div className="mt-auto flex justify-end pt-3">
                        <Button icon={<SignOutIcon/>} onClick={handleLogout}>{t('user.logout')}</Button>
                    </div>
                </section>

                <section aria-labelledby="whoami-preferences" className={PANEL}>
                    <h2 id="whoami-preferences" className="mb-2 flex items-center gap-2 font-semibold">
                        <GearIcon className="text-accent"/>
                        {t('user.preferences')}
                    </h2>
                    {/* A row each: its pictogram, its name, its control; the hints two lines, their reset under the switch. */}
                    <div className="grid grid-cols-[1rem_6rem_minmax(0,1fr)] items-center gap-x-2 gap-y-3">
                        <GlobeIcon className="h-4 w-4 text-ink-muted"/>
                        {/* Each language named in itself: found whatever the language shown. */}
                        <label htmlFor="whoami-language" className="text-ink-muted">{t('user.language')}</label>
                        <Select
                            id="whoami-language"
                            className="w-fit"
                            value={isLanguage(i18n.language) ? i18n.language : 'en'}
                            onChange={(event) => setLanguage(event.target.value)}
                        >
                            {LANGUAGES.map((language) => (
                                <option key={language} value={language} lang={language}>{LANGUAGE_NAMES[language]}</option>
                            ))}
                        </Select>

                        {isDarkMode ? <MoonIcon className="h-4 w-4 text-ink-muted"/> : <SunIcon className="h-4 w-4 text-ink-muted"/>}
                        <span id="whoami-theme" className="text-ink-muted">{t('user.theme')}</span>
                        {/* The theme, both told: the one on pressed, the other a click away. */}
                        <span role="group" aria-labelledby="whoami-theme" className="inline-flex">
                            <Button size="sm" aria-pressed={!isDarkMode} onClick={() => isDarkMode && toggleDarkMode()} className="rounded-r-none">
                                {t('user.lightMode')}
                            </Button>
                            <Button size="sm" aria-pressed={isDarkMode} onClick={() => !isDarkMode && toggleDarkMode()} className="-ml-px rounded-l-none">
                                {t('user.darkMode')}
                            </Button>
                        </span>

                        <InfoIcon className="h-4 w-4 text-ink-muted"/>
                        <span className="text-ink-muted">{t('user.hints')}</span>
                        {/* The intros of the pages: all off for whom knows OpenSVC, or those hidden one by one shown again. */}
                        <Checkbox label={t('user.showIntros')} checked={introsEnabled} onChange={(e) => setIntrosEnabled(e.target.checked)}/>
                        <span className="col-start-3">
                            {/* Its words on two lines rather than out of the panel, in a narrow window. */}
                            <Button size="sm" onClick={showAllIntros} disabled={!introsEnabled || hiddenIntros.length === 0} className="h-auto min-h-7 py-1 text-left whitespace-normal">
                                {t('user.resetIntros', {count: hiddenIntros.length})}
                            </Button>
                        </span>
                    </div>
                </section>

                {/* A token of its own for a script or a quick test, never the one of the session. */}
                <section aria-labelledby="whoami-api" className={PANEL}>
                    <h2 id="whoami-api" className="mb-2 flex items-center gap-2 font-semibold">
                        <KeyIcon className="text-accent"/>
                        {t('user.apiAccess')}
                    </h2>
                    <p className="mb-2 text-ink-muted">{t('user.apiAccessHint')}</p>
                    <div className="flex flex-wrap items-center gap-3">
                        <Link to="/token" className="inline-flex h-8 items-center rounded-(--radius-control) border border-line px-3 font-medium hover:bg-surface-sunken">
                            {t('user.createToken')}
                        </Link>
                        {/* The api of the node, documented by its own Swagger UI (om3 /api/docs/), out of the webapp. */}
                        <a href="/api/docs/" target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                            {t('user.apiDocs')}
                        </a>
                    </div>
                </section>

                <section aria-labelledby="whoami-server" className={PANEL}>
                    <h2 id="whoami-server" className="mb-2 flex items-center gap-2 font-semibold">
                        <ServerIcon className="text-accent"/>
                        {t('user.server')}
                    </h2>
                    <dl className="space-y-2">
                        <Value label={t('user.connectedNode')}>{apiNode === null ? t('user.nodeUnknown') : apiNode || t('user.nodeLoading')}</Value>
                        {/* The version built, always; the latest release, when the user lets GitHub be asked. */}
                        <Value label={t('user.webappVersion')}>{APP_VERSION || t('user.versionUnknown')}</Value>
                        <div>
                            <dt className="text-data text-ink-muted">{t('user.latestRelease')}</dt>
                            <dd className="font-mono">
                                {appVersion === undefined
                                    ? <span className="font-sans text-ink-muted">{t('user.versionNotChecked')} <Link to="/about" className="text-accent underline-offset-2 hover:underline">{t('user.versionOptIn')}</Link></span>
                                    : appVersion === null
                                        ? t('user.versionLoading')
                                        : appVersion === '' ? t('user.versionUnknown') : (
                                            <>
                                                {`v${appVersion}`}
                                                {isRelease(APP_VERSION, appVersion) && <span className="ml-2 font-sans text-data text-state-up">{t('user.thisVersion')}</span>}
                                            </>
                                        )}
                            </dd>
                        </div>
                    </dl>
                </section>
            </div>
        </div>
    );
};

export default WhoAmI;
