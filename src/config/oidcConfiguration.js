import {WebStorageStateStore} from "oidc-client-ts";
import logger from "../utils/logger.js";

const DEFAULT_SCOPES = [
    "openid",
    "profile",
    "email",
    "offline_access",
    "opensvc:om3",
    "opensvc:om3:root",
    "opensvc:om3:guest",
    "opensvc:badscope",
];

const initData = {
    client_id: "om3",
    response_type: "code",
    accessTokenExpiringNotificationTimeInSeconds: 30,
    automaticSilentRenew: true,
    // Nothing listens to the sign-out it reports, and on a session change it loads
    // the whole webapp in an iframe at silent_redirect_uri, a second UserManager
    // renewing with the same rotating refresh token.
    monitorSession: false,
};

/**
 * Filters the DEFAULT_SCOPES based on a list of allowed scopes from the well-known configuration.
 * @param {string[]} allowedScopes - Scopes allowed from well-known config
 * @returns {string} space-separated filtered scopes
 */
function filterScopes(allowedScopes) {
    if (!Array.isArray(allowedScopes) || allowedScopes.length === 0) {
        logger.warn("No allowed scopes provided, using default scopes");
        return DEFAULT_SCOPES.join(" ");
    }

    const filteredScopes = DEFAULT_SCOPES.filter(scope => allowedScopes.includes(scope));
    logger.debug("Filtered scopes:", filteredScopes);
    return filteredScopes.join(" ");
}

const isBrowser = typeof window !== 'undefined' && typeof window.location !== 'undefined';

const getBasePath = () => {
    if (!isBrowser) return "";
    const match = window.location.pathname.match(/^\/ui/);
    return match ? match[0] : "";
};

function isSafeIssuerUrl(url) {
    // Only allow HTTPS, with an exception for localhost over HTTP for development
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
        logger.warn("Issuer URL must use HTTPS (or HTTP for localhost). Got: " + url.protocol);
        return false;
    }
    // Disallow credentials in the URL
    if (url.username || url.password) {
        logger.warn("Issuer URL must not contain credentials.");
        return false;
    }
    // Block IP addresses to prevent SSRF to internal networks
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^\[?([0-9a-fA-F:]+)\]?$/;
    if (ipv4Regex.test(url.hostname)) {
        // Allow only if it's a localhost IP (already handled above, but double-check)
        // Block private, loopback, and link-local even if they passed localhost check
        const parts = url.hostname.split('.').map(Number);
        if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
            if (parts[0] === 10 ||
                (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
                (parts[0] === 192 && parts[1] === 168) ||
                parts[0] === 127 ||
                (parts[0] === 169 && parts[1] === 254)) {
                logger.warn("Issuer URL must not point to a private or loopback IP address.");
                return false;
            }
            // Still block any non-localhost IP (force domain names)
            logger.warn("Issuer URL must use a domain name, not an IP address.");
            return false;
        }
    } else if (ipv6Regex.test(url.hostname)) {
        logger.warn("Issuer URL must not be an IPv6 address.");
        return false;
    }
    return true;
}

async function oidcConfiguration(authInfo) {
    let scopesSupported = DEFAULT_SCOPES;
    if (!authInfo?.openid?.issuer) {
        logger.warn("OIDC Configuration fallback: 'authInfo.openid.issuer' is missing. Falling back to default configuration.");
        return initData;
    }

    try {
        let url = new URL(authInfo.openid.issuer);
        if (!url.protocol || !url.host) {
            logger.error("Malformed URI: missing protocol or host");
            return initData;
        }

        // SSRF prevention: validate the URL before making any request
        if (!isSafeIssuerUrl(url)) {
            logger.warn("OIDC Configuration fallback: issuer URL failed validation. Falling back to default configuration.");
            return initData;
        }

        if (!url.pathname.endsWith("/")) {
            url.pathname += "/";
        }
        url.pathname += '.well-known/openid-configuration';
        logger.info("Fetching OIDC configuration from:", url.toString());
        // Disable redirects to prevent SSRF via open redirects
        const response = await fetch(url, {redirect: 'error'});

        if (response.ok) {
            const wellKnown = await response.json();
            scopesSupported = wellKnown.scopes_supported || DEFAULT_SCOPES;
            logger.debug("OIDC well-known configuration fetched:", wellKnown);
        } else {
            logger.warn("Failed to fetch .well-known/openid-configuration:", response.status);
        }
    } catch (error) {
        logger.error("Well-formed URL required for openid.issuer", error);
        return initData;
    }

    const baseUrl = isBrowser ? window.location.origin + getBasePath() : "";
    const finalScope = filterScopes(scopesSupported);
    const userStore = isBrowser && typeof window.localStorage !== 'undefined'
        ? new WebStorageStateStore({store: window.localStorage})
        : undefined;

    const config = {
        ...initData,
        authority: authInfo.openid.issuer,
        client_id: authInfo.openid.client_id,
        scope: finalScope,
        redirect_uri: `${baseUrl}/auth-callback`,
        // Use a dedicated silent renew endpoint so the iframe can call `signinSilentCallback`
        silent_redirect_uri: `${baseUrl}/silent-renew`,
        // Explicitly control refresh token usage for SPAs. Set to true to use refresh tokens for silent renew.
        useRefreshToken: true,
        post_logout_redirect_uri: `${baseUrl}/`,
        ...(userStore ? {userStore} : {}),
    };
    logger.debug("Final OIDC configuration:", config);
    return config;
}

export default oidcConfiguration;
