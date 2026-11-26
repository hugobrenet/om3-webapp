import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {URL_AUTH_WHOAMI} from '../config/apiPath';
import {Button, buttonClass} from '../ui/components/Button';
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
import {broadcastLogout} from "../app/session";
import {LANGUAGES, LANGUAGE_NAMES, isLanguage, setLanguage} from "../i18n";
import {compareVersions, latestRelease, releaseOf, useReleaseCheck} from "../app/release-check";
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
            // The release told before, while GitHub is asked, or if it cannot be: not one
            // older than the release this build is of, the webapp upgraded since.
            const cached = localStorage.getItem('appVersion');
            const known = cached && compareVersions(cached, releaseOf(APP_VERSION)) >= 0 ? cached : '';
            if (known) setAppVersion(known);

            // Asked each time the page opens: the browser keeps GitHub's answer a minute,
            // then asks again only whether it changed (its ETag), no more.
            try {
                const response = await fetch('https://api.github.com/repos/opensvc/om3-webapp/releases?per_page=100', {
                    headers: {Accept: 'application/vnd.github+json'},
                });
                // Refused, rate limited say: nothing kept, the release told before still said.
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const latest = latestRelease(await response.json());
                setAppVersion(latest);
                if (latest) localStorage.setItem('appVersion', latest);
            } catch (error) {
                logger.error('Error fetching version:', error);
                setAppVersion(known);
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
        // What the session held forgotten here (AuthProvider), then in the other tabs.
        localStorage.removeItem("authToken");
        if (authDispatch) {
            authDispatch({type: Logout});
        }
        broadcastLogout();
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
    // The actions of a panel at its foot, on the right: the same place in each, level across a row of panels.
    const FOOTER = "mt-auto flex flex-wrap items-center justify-end gap-3 pt-3";

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
                    <div className={FOOTER}>
                        <Button icon={<SignOutIcon/>} onClick={handleLogout}>{t('user.logout')}</Button>
                    </div>
                </section>

                <section aria-labelledby="whoami-preferences" className={`${PANEL} flex flex-col`}>
                    <h2 id="whoami-preferences" className="mb-2 flex items-center gap-2 font-semibold">
                        <GearIcon className="text-accent"/>
                        {t('user.preferences')}
                    </h2>
                    {/* A row each: its pictogram, its name, its control; the reset of the hints at the foot. */}
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
                    </div>
                    <div className={FOOTER}>
                        {/* Its words on two lines rather than out of the panel, in a narrow window. */}
                        <Button onClick={showAllIntros} disabled={!introsEnabled || hiddenIntros.length === 0} className="h-auto min-h-8 py-1 text-left whitespace-normal">
                            {t('user.resetIntros', {count: hiddenIntros.length})}
                        </Button>
                    </div>
                </section>

                {/* A token of its own for a script or a quick test, never the one of the session. */}
                <section aria-labelledby="whoami-api" className={`${PANEL} flex flex-col`}>
                    <h2 id="whoami-api" className="mb-2 flex items-center gap-2 font-semibold">
                        <KeyIcon className="text-accent"/>
                        {t('user.apiAccess')}
                    </h2>
                    <p className="mb-2 text-ink-muted">{t('user.apiAccessHint')}</p>
                    <div className={FOOTER}>
                        {/* The api of the node, documented by its own Swagger UI (om3 /api/docs/), out of the webapp. */}
                        <a href="/api/docs/" target="_blank" rel="noopener noreferrer" className="mr-auto text-accent underline-offset-2 hover:underline">
                            {t('user.apiDocs')}
                        </a>
                        <Link to="/token" className={buttonClass()}>
                            {t('user.createToken')}
                        </Link>
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
