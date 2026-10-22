import oidcConfiguration from '../oidcConfiguration';

// Mock window.location
const mockLocation = {
    origin: 'https://example.com',
    pathname: '/app/subpath/index.html',
};
const originalWindow = global.window;

jest.mock("oidc-client-ts", () => ({
    WebStorageStateStore: jest.fn().mockImplementation(() => ({})),
}));

describe('oidcConfiguration (browser environment)', () => {
    beforeAll(() => {
        Object.defineProperty(window, 'location', {
            value: mockLocation,
            writable: true,
            configurable: true,
        });
    });

    afterAll(() => {
        Object.defineProperty(window, 'location', {
            value: originalWindow.location,
            writable: true,
            configurable: true,
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();
        console.debug = jest.fn();
        console.info = jest.fn();
    });

    test('returns default configuration when authInfo is missing', async () => {
        const result = await oidcConfiguration(null);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: 'authInfo.openid.issuer' is missing. Falling back to default configuration."
        );
    });

    test('returns default configuration when authInfo.openid.issuer is missing', async () => {
        const authInfo = {openid: {}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: 'authInfo.openid.issuer' is missing. Falling back to default configuration."
        );
    });

    test('handles malformed URI and returns default configuration', async () => {
        const authInfo = {openid: {issuer: 'invalid-url', client_id: 'om3'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.error).toHaveBeenCalledWith(
            'Well-formed URL required for openid.issuer',
            expect.objectContaining({message: 'Invalid URL: invalid-url'})
        );
    });

    test('fetches well-known configuration and builds config with filtered scopes', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: ['openid', 'profile']}),
        });

        const result = await oidcConfiguration(authInfo);
        expect(fetch.mock.calls[0][0].toString()).toBe('https://auth.example.com/.well-known/openid-configuration');
        expect(result).toEqual({
            client_id: 'test-client',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
            authority: 'https://auth.example.com',
            scope: 'openid profile',
            redirect_uri: 'https://example.com/auth-callback',
            silent_redirect_uri: 'https://example.com/silent-renew',
            useRefreshToken: true,
            post_logout_redirect_uri: 'https://example.com/',
            userStore: expect.any(Object),
        });
    });

    test('handles non-OK fetch response and uses default scopes (no warning from filterScopes because DEFAULT_SCOPES is non-empty)', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: false,
            status: 404,
        });

        const result = await oidcConfiguration(authInfo);
        expect(fetch.mock.calls[0][0].toString()).toBe('https://auth.example.com/.well-known/openid-configuration');
        expect(console.warn).toHaveBeenCalledWith('Failed to fetch .well-known/openid-configuration:', 404);
        expect(result).toEqual({
            client_id: 'test-client',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
            authority: 'https://auth.example.com',
            scope: 'openid profile email offline_access opensvc:om3 opensvc:om3:root opensvc:om3:guest opensvc:badscope',
            redirect_uri: 'https://example.com/auth-callback',
            silent_redirect_uri: 'https://example.com/silent-renew',
            useRefreshToken: true,
            post_logout_redirect_uri: 'https://example.com/',
            userStore: expect.any(Object),
        });
    });

    test('appends trailing slash to issuer URL if missing', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com/oidc', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: ['openid']}),
        });

        await oidcConfiguration(authInfo);
        expect(fetch.mock.calls[0][0].toString()).toBe('https://auth.example.com/oidc/.well-known/openid-configuration');
    });

    test('handles fetch error and returns default configuration', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'om3'}};
        fetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await oidcConfiguration(authInfo);
        expect(console.error).toHaveBeenCalledWith(
            'Well-formed URL required for openid.issuer',
            expect.objectContaining({message: 'Network error'})
        );
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
    });

    test('uses default scopes and triggers filterScopes warning when well-known returns empty scopes_supported array', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: []}),
        });

        const result = await oidcConfiguration(authInfo);
        expect(result.scope).toBe('openid profile email offline_access opensvc:om3 opensvc:om3:root opensvc:om3:guest opensvc:badscope');
        expect(console.warn).toHaveBeenCalledWith('No allowed scopes provided, using default scopes');
    });

    test('uses default scopes and triggers filterScopes warning when well-known returns non-array scopes_supported', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: {invalid: 'object'}}),
        });

        const result = await oidcConfiguration(authInfo);
        expect(result.scope).toBe('openid profile email offline_access opensvc:om3 opensvc:om3:root opensvc:om3:guest opensvc:badscope');
        expect(console.warn).toHaveBeenCalledWith('No allowed scopes provided, using default scopes');
    });

    test('returns empty scope when well-known scopes do not include any default scope', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: ['foo', 'bar']}),
        });

        const result = await oidcConfiguration(authInfo);
        expect(result.scope).toBe('');
        expect(console.warn).not.toHaveBeenCalledWith('No allowed scopes provided, using default scopes');
    });

    test('falls back to default config when issuer uses HTTP (non-localhost)', async () => {
        const authInfo = {openid: {issuer: 'http://example.com', client_id: 'test-client'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: issuer URL failed validation. Falling back to default configuration."
        );
        // The inner warning from isSafeIssuerUrl is also logged
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining("Issuer URL must use HTTPS (or HTTP for localhost). Got: http:")
        );
    });

    test('falls back to default config when issuer URL contains credentials', async () => {
        const authInfo = {openid: {issuer: 'https://user:pass@auth.example.com', client_id: 'test-client'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: issuer URL failed validation. Falling back to default configuration."
        );
        expect(console.warn).toHaveBeenCalledWith("Issuer URL must not contain credentials.");
    });

    test('falls back to default config when issuer is a public IPv4 address', async () => {
        const authInfo = {openid: {issuer: 'https://8.8.8.8', client_id: 'test-client'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: issuer URL failed validation. Falling back to default configuration."
        );
        expect(console.warn).toHaveBeenCalledWith(
            "Issuer URL must use a domain name, not an IP address."
        );
    });

    test('falls back to default config when issuer is a private IPv4 address', async () => {
        const authInfo = {openid: {issuer: 'https://192.168.1.1', client_id: 'test-client'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: issuer URL failed validation. Falling back to default configuration."
        );
        expect(console.warn).toHaveBeenCalledWith(
            "Issuer URL must not point to a private or loopback IP address."
        );
    });

    test('falls back to default config when issuer is an IPv6 address', async () => {
        const authInfo = {openid: {issuer: 'https://[::1]', client_id: 'test-client'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.warn).toHaveBeenCalledWith(
            "OIDC Configuration fallback: issuer URL failed validation. Falling back to default configuration."
        );
        expect(console.warn).toHaveBeenCalledWith("Issuer URL must not be an IPv6 address.");
    });

    test('falls back to default config when URL has protocol but no host (e.g., mailto:)', async () => {
        const authInfo = {openid: {issuer: 'mailto:test@example.com', client_id: 'test-client'}};
        const result = await oidcConfiguration(authInfo);
        expect(result).toEqual({
            client_id: 'om3',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
        });
        expect(console.error).toHaveBeenCalledWith("Malformed URI: missing protocol or host");
    });

    test('uses "/ui" base path when pathname starts with /ui', async () => {
        // Override pathname for this test
        window.location.pathname = '/ui/dashboard';
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: ['openid']}),
        });

        const result = await oidcConfiguration(authInfo);
        expect(result.redirect_uri).toBe('https://example.com/ui/auth-callback');
        expect(result.silent_redirect_uri).toBe('https://example.com/ui/silent-renew');
        expect(result.post_logout_redirect_uri).toBe('https://example.com/ui/');
        // Restore pathname to avoid affecting other tests
        window.location.pathname = mockLocation.pathname;
    });
});

describe('oidcConfiguration (non-browser environment)', () => {
    let originalWindow;

    beforeAll(() => {
        originalWindow = global.window;
        delete global.window;
    });

    afterAll(() => {
        global.window = originalWindow;
    });

    beforeEach(() => {
        jest.resetModules();
        global.fetch = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();
        console.debug = jest.fn();
        console.info = jest.fn();
    });

    test('builds config with empty baseUrl and no userStore when window is undefined', async () => {
        const oidcConfigurationNonBrowser = (await import('../oidcConfiguration')).default;
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: ['openid', 'profile']}),
        });

        const result = await oidcConfigurationNonBrowser(authInfo);
        expect(result).toEqual({
            client_id: 'test-client',
            response_type: 'code',
            accessTokenExpiringNotificationTimeInSeconds: 30,
            automaticSilentRenew: true,
            monitorSession: false,
            authority: 'https://auth.example.com',
            scope: 'openid profile',
            redirect_uri: '/auth-callback',
            silent_redirect_uri: '/silent-renew',
            useRefreshToken: true,
            post_logout_redirect_uri: '/',
        });
        expect(result.userStore).toBeUndefined();
    });
});

describe('oidcConfiguration (browser without localStorage)', () => {
    let originalLocalStorage;

    beforeAll(() => {
        originalLocalStorage = global.window.localStorage;
        delete global.window.localStorage;
        Object.defineProperty(window, 'location', {
            value: {origin: 'https://example.com', pathname: '/app/'},
            writable: true,
            configurable: true,
        });
    });

    afterAll(() => {
        global.window.localStorage = originalLocalStorage;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn();
        console.warn = jest.fn();
        console.error = jest.fn();
    });

    test('does not create userStore when localStorage is undefined', async () => {
        const authInfo = {openid: {issuer: 'https://auth.example.com', client_id: 'test-client'}};
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({scopes_supported: ['openid']}),
        });

        const result = await oidcConfiguration(authInfo);
        expect(result.userStore).toBeUndefined();
    });
});
