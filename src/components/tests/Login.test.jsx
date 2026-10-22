import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {vi, describe, test, expect, beforeEach} from 'vitest';
import Login, {decodeToken, refreshToken} from '../Login';
import {SetAccessToken, SetAuthChoice, useAuthDispatch} from '../../context/AuthProvider.jsx';
import {URL_TOKEN} from '../../config/apiPath';

// ── Hoisted mock functions ──────────────────────────────────────────────
const {
    mockNavigate,
    mockUseNavigate,
    mockUseAuthDispatch,
} = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    mockUseNavigate: vi.fn(() => mockNavigate),
    mockUseAuthDispatch: vi.fn(() => vi.fn()),
}));

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useNavigate: mockUseNavigate,
    };
});

vi.mock('../../context/AuthProvider.jsx', () => ({
    SetAccessToken: 'SET_ACCESS_TOKEN',
    SetAuthChoice: 'SET_AUTH_CHOICE',
    useAuthDispatch: mockUseAuthDispatch,
}));

vi.mock('../../config/apiPath.js', () => ({
    URL_TOKEN: 'http://mock-api/token',
    URL_REFRESH: 'http://mock-api/refresh',
}));

global.fetch = vi.fn();

// --- Helpers ---
const createMockToken = (payload) => {
    const header = {alg: 'HS256', typ: 'JWT'};
    const encode = (obj) =>
        Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '');
    return `${encode(header)}.${encode(payload)}.mock-signature`;
};

const makeTokenWithPayloadString = (payloadString) => {
    const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64').replace(/=/g, '');
    const payload = Buffer.from(payloadString).toString('base64').replace(/=/g, '');
    return `${header}.${payload}.mock-signature`;
};

const setupLogin = () => {
    const utils = render(<Login/>);
    const getUsernameInput = () => screen.getByLabelText('Username');
    const getPasswordInput = () => screen.getByLabelText('Password');
    const getSubmitButton = () => screen.getByRole('button', {name: 'Submit'});
    const getChangeMethodButton = () => screen.getByRole('button', {name: 'Change Method'});

    const fillForm = (username, password) => {
        fireEvent.change(getUsernameInput(), {target: {value: username}});
        fireEvent.change(getPasswordInput(), {target: {value: password}});
    };

    return {...utils, getUsernameInput, getPasswordInput, getSubmitButton, getChangeMethodButton, fillForm};
};

// --- Tests ---
describe('Login Component', () => {
    const mockDispatch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseNavigate.mockReturnValue(mockNavigate);
        mockUseAuthDispatch.mockReturnValue(mockDispatch);
        localStorage.clear();
        vi.spyOn(console, 'error').mockImplementation(() => {
        });
    });

    test('renders login form correctly', () => {
        setupLogin();
        expect(screen.getByRole('heading', {name: 'Login'})).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Login'})).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
        expect(screen.getByLabelText('Username')).toHaveFocus();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Username')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Submit'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Change Method'})).toBeInTheDocument();
    });

    test('handles form input changes and disables submit when empty', () => {
        const {getUsernameInput, getPasswordInput, getSubmitButton} = setupLogin();

        expect(getSubmitButton()).toBeDisabled();

        fireEvent.change(getUsernameInput(), {target: {value: 'user'}});
        expect(getSubmitButton()).toBeDisabled();

        fireEvent.change(getPasswordInput(), {target: {value: 'pass'}});
        expect(getSubmitButton()).not.toBeDisabled();

        expect(getUsernameInput().value).toBe('user');
        expect(getPasswordInput().value).toBe('pass');
    });

    test('submits form with Enter key', async () => {
        const {getPasswordInput, fillForm} = setupLogin();
        fillForm('testuser', 'testpass');
        fireEvent.keyDown(getPasswordInput(), {key: 'Enter'});
        await waitFor(() => expect(fetch).toHaveBeenCalled());
    });

    test('shows error when submitting empty form via Enter key', async () => {
        const {getPasswordInput} = setupLogin();
        fireEvent.keyDown(getPasswordInput(), {key: 'Enter'});
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Please enter both username and password');
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    test('handles successful login', async () => {
        const payload = {sub: '123', name: 'John Doe', iat: 1516239022, exp: Math.floor(Date.now() / 1000) + 3600};
        const accessToken = createMockToken(payload);
        const refreshTokenValue = createMockToken({...payload, token_use: 'refresh'});

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                access_token: accessToken,
                refresh_token: refreshTokenValue,
                access_expired_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                refresh_expired_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            }),
        });

        const {fillForm, getSubmitButton} = setupLogin();
        fillForm('testuser', 'testpass');
        fireEvent.click(getSubmitButton());

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith(`${URL_TOKEN}?refresh=true`, {
                method: 'POST',
                headers: {Authorization: 'Basic ' + btoa('testuser:testpass')},
            });
        });

        expect(localStorage.getItem('authToken')).toBe(accessToken);
        expect(localStorage.getItem('refreshToken')).toBe(refreshTokenValue);
        expect(localStorage.getItem('tokenExpiration')).toBeDefined();
        expect(localStorage.getItem('refreshTokenExpiration')).toBeDefined();
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: accessToken});
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    test('handles login error (invalid credentials)', async () => {
        fetch.mockResolvedValueOnce({ok: false});

        const {fillForm, getSubmitButton} = setupLogin();
        fillForm('wronguser', 'wrongpass');
        fireEvent.click(getSubmitButton());

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Incorrect username or password');
        });
    });

    test('handles login network error', async () => {
        fetch.mockRejectedValueOnce(new Error('Network error'));

        const {fillForm, getSubmitButton} = setupLogin();
        fillForm('testuser', 'testpass');
        fireEvent.click(getSubmitButton());

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Network error');
        });

        expect(console.error).toHaveBeenCalledWith('Authentication error:', expect.any(Error));
    });

    test('disables the form and shows Loading... while the login is pending', async () => {
        let resolveFetch;
        fetch.mockReturnValueOnce(new Promise((resolve) => {
            resolveFetch = resolve;
        }));

        const {fillForm, getUsernameInput, getPasswordInput} = setupLogin();
        fillForm('testuser', 'testpass');
        fireEvent.click(screen.getByRole('button', {name: 'Submit'}));

        const loadingButton = await screen.findByRole('button', {name: 'Loading...'});
        expect(loadingButton).toBeDisabled();
        expect(getUsernameInput()).toBeDisabled();
        expect(getPasswordInput()).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Change Method'})).toBeDisabled();

        resolveFetch({ok: false});
        await waitFor(() => {
            expect(screen.getByRole('button', {name: 'Submit'})).not.toBeDisabled();
        });
    });

    test('handles change method button click', () => {
        const {getChangeMethodButton} = setupLogin();
        fireEvent.click(getChangeMethodButton());

        expect(mockDispatch).toHaveBeenCalledWith({type: SetAuthChoice, data: ''});
        expect(mockNavigate).toHaveBeenCalledWith('/auth-choice');
    });

    // --- decodeToken tests ---
    test('decodes token correctly', () => {
        const payload = {sub: '123', name: 'John', iat: 1516239022};
        const token = createMockToken(payload);
        expect(decodeToken(token)).toEqual(payload);
    });

    test('decodeToken returns null for missing/invalid token', () => {
        expect(decodeToken(null)).toBeNull();
        expect(decodeToken(undefined)).toBeNull();
        expect(decodeToken('')).toBeNull();
        expect(decodeToken('invalid.token')).toBeNull();
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    test('decodeToken returns null for token with invalid base64 payload', () => {
        const token = 'header.!!!.signature';
        expect(decodeToken(token)).toBeNull();
        expect(console.error).toHaveBeenCalledWith('Error decoding token:', expect.any(Error));
    });

    test('decodeToken returns null for token with valid base64 but non-JSON payload', () => {
        const token = makeTokenWithPayloadString('not a json');
        expect(decodeToken(token)).toBeNull();
        expect(console.error).toHaveBeenCalledWith('Error decoding token:', expect.any(Error));
    });

    // --- refreshToken tests ---
    test('refreshToken returns null when no refresh token is stored', async () => {
        localStorage.removeItem('refreshToken');
        const result = await refreshToken(mockDispatch);
        expect(result).toBeNull();
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    test('refreshToken returns null when refresh token is expired', async () => {
        localStorage.setItem('refreshToken', 'mock.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() - 1000).toString());

        const result = await refreshToken(mockDispatch);
        expect(result).toBeNull();
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: null});
        expect(console.error).toHaveBeenCalledWith('Refresh token expired');
    });

    test('refreshToken handles failed server response', async () => {
        localStorage.setItem('refreshToken', 'mock.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());
        fetch.mockResolvedValueOnce({ok: false});

        const result = await refreshToken(mockDispatch);
        expect(result).toBeNull();
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: null});
    });

    test('refreshToken handles network error', async () => {
        localStorage.setItem('refreshToken', 'mock.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());
        fetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await refreshToken(mockDispatch);
        expect(result).toBeNull();
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: null});
        expect(console.error).toHaveBeenCalledWith('Error refreshing token:', expect.any(Error));
    });

    test('handles successful token refresh', async () => {
        const payload = {sub: '123', name: 'John', iat: 1516239022, exp: Math.floor(Date.now() / 1000) + 3600};
        const accessToken = createMockToken(payload);
        localStorage.setItem('refreshToken', 'mock.refresh.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({access_token: accessToken}),
        });

        const result = await refreshToken(mockDispatch);
        expect(result).toBe(accessToken);
        expect(localStorage.getItem('authToken')).toBe(accessToken);
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: accessToken});
    });

    test('handles login and refresh when tokens have no expiration', async () => {
        const payload = {sub: '123', name: 'John Doe', iat: 1516239022};
        const accessToken = createMockToken(payload);
        const refreshTokenValue = createMockToken({...payload, token_use: 'refresh'});

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({access_token: accessToken, refresh_token: refreshTokenValue}),
        });

        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

        const {fillForm, getSubmitButton} = setupLogin();
        fillForm('testuser', 'testpass');
        fireEvent.click(getSubmitButton());

        await waitFor(() => {
            expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: accessToken});
        });

        expect(localStorage.getItem('authToken')).toBe(accessToken);
        expect(localStorage.getItem('refreshToken')).toBe(refreshTokenValue);
        expect(localStorage.getItem('tokenExpiration')).toBeNull();
        expect(localStorage.getItem('refreshTokenExpiration')).toBeNull();
        expect(removeItemSpy).toHaveBeenCalledWith('tokenExpiration');
        expect(removeItemSpy).toHaveBeenCalledWith('refreshTokenExpiration');
        expect(mockNavigate).toHaveBeenCalledWith('/');

        removeItemSpy.mockRestore();
    });

    test('refreshToken stores no expiration when access token has no exp', async () => {
        const payload = {sub: '123', name: 'John', iat: 1516239022};
        const accessToken = createMockToken(payload);
        localStorage.setItem('refreshToken', 'mock.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({access_token: accessToken}),
        });

        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
        await refreshToken(mockDispatch);
        expect(localStorage.getItem('authToken')).toBe(accessToken);
        expect(localStorage.getItem('tokenExpiration')).toBeNull();
        expect(removeItemSpy).toHaveBeenCalledWith('tokenExpiration');
        removeItemSpy.mockRestore();
    });

    test('concurrent refreshToken calls are queued and return the same promise', async () => {
        const payload = {sub: '123', iat: 1, exp: Math.floor(Date.now() / 1000) + 3600};
        const accessToken = createMockToken(payload);
        localStorage.setItem('refreshToken', 'mock.refresh.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());

        let resolveFetch;
        const fetchPromise = new Promise((resolve) => {
            resolveFetch = resolve;
        });
        fetch.mockReturnValueOnce(fetchPromise);

        const firstCall = refreshToken(mockDispatch);
        const secondCall = refreshToken(mockDispatch);

        expect(secondCall).toBeInstanceOf(Promise);

        resolveFetch({
            ok: true,
            json: () => Promise.resolve({access_token: accessToken}),
        });

        const [token1, token2] = await Promise.all([firstCall, secondCall]);
        expect(token1).toBe(accessToken);
        expect(token2).toBe(accessToken);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('refreshToken succeeds when no refresh expiration is set', async () => {
        const payload = {sub: '123', exp: Math.floor(Date.now() / 1000) + 3600};
        const accessToken = createMockToken(payload);
        localStorage.setItem('refreshToken', 'no-expiration.token');

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({access_token: accessToken}),
        });

        const result = await refreshToken(mockDispatch);
        expect(result).toBe(accessToken);
        expect(localStorage.getItem('authToken')).toBe(accessToken);
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: accessToken});
    });

    test('refreshToken stores new refresh token when provided', async () => {
        const accessPayload = {sub: '123', exp: Math.floor(Date.now() / 1000) + 3600};
        const refreshPayload = {sub: '123', exp: Math.floor(Date.now() / 1000) + 7200, token_use: 'refresh'};
        const accessToken = createMockToken(accessPayload);
        const newRefreshToken = createMockToken(refreshPayload);
        localStorage.setItem('refreshToken', 'old-refresh.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                access_token: accessToken,
                refresh_token: newRefreshToken,
            }),
        });

        const result = await refreshToken(mockDispatch);
        expect(result).toBe(accessToken);
        expect(localStorage.getItem('authToken')).toBe(accessToken);
        expect(localStorage.getItem('refreshToken')).toBe(newRefreshToken);
        expect(localStorage.getItem('tokenExpiration')).toBe(String(accessPayload.exp * 1000));
        expect(localStorage.getItem('refreshTokenExpiration')).toBe(String(refreshPayload.exp * 1000));
        expect(mockDispatch).toHaveBeenCalledWith({type: SetAccessToken, data: accessToken});
    });

    test('refreshToken handles new refresh token without expiration', async () => {
        const accessPayload = {sub: '123', exp: Math.floor(Date.now() / 1000) + 3600};
        const refreshPayload = {sub: '123', token_use: 'refresh'}; // no exp
        const accessToken = createMockToken(accessPayload);
        const newRefreshToken = createMockToken(refreshPayload);
        localStorage.setItem('refreshToken', 'old-refresh.token');
        localStorage.setItem('refreshTokenExpiration', (Date.now() + 3600000).toString());

        fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                access_token: accessToken,
                refresh_token: newRefreshToken,
            }),
        });

        const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

        const result = await refreshToken(mockDispatch);
        expect(result).toBe(accessToken);
        expect(localStorage.getItem('refreshToken')).toBe(newRefreshToken);
        expect(removeItemSpy).toHaveBeenCalledWith('refreshTokenExpiration');
        expect(localStorage.getItem('refreshTokenExpiration')).toBeNull();

        removeItemSpy.mockRestore();
    });
});
