import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {vi, describe, test, expect, beforeEach, afterEach} from 'vitest';
import i18n from '../../i18n';
import Authenticating from '../Authenticating';

const {mockReload} = vi.hoisted(() => ({
    mockReload: vi.fn(),
}));

describe('Authenticating Component', () => {
    let originalLocation;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock window.location.reload
        originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: {reload: mockReload},
        });
    });

    afterEach(async () => {
        // Restore window.location
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: originalLocation,
        });
        await i18n.changeLanguage('en');
    });

    test('renders panel with title, content, spinner and button', () => {
        render(<Authenticating/>);

        // Check that the panel is rendered and named by its title
        const panel = screen.getByRole('region', {name: 'Authentication'});
        expect(panel).toBeInTheDocument();
        expect(panel).toHaveAttribute('aria-labelledby', 'dialog-title');

        expect(screen.getByRole('heading', {name: 'Authentication'})).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Loading...');
        expect(screen.getByText('You are being redirected to the openid provider.')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Reload'})).toBeInTheDocument();
    });

    test('panel is always shown', () => {
        render(<Authenticating/>);
        const panel = screen.getByRole('region', {name: 'Authentication'});
        expect(panel).toBeInTheDocument();
        expect(panel).toBeVisible();
    });

    test('clicking reload button calls window.location.reload', () => {
        render(<Authenticating/>);
        const reloadButton = screen.getByRole('button', {name: 'Reload'});
        fireEvent.click(reloadButton);
        expect(mockReload).toHaveBeenCalled();
    });

    test('renders correctly with unused props', () => {
        render(<Authenticating someUnusedProp="value"/>);
        expect(screen.getByText('Authentication')).toBeInTheDocument();
        expect(screen.getByText('You are being redirected to the openid provider.')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Reload'})).toBeInTheDocument();
    });

    test('speaks French in a French browser', async () => {
        await i18n.changeLanguage('fr');
        render(<Authenticating/>);

        expect(screen.getByText('Authentification')).toBeInTheDocument();
        expect(screen.getByText('Vous êtes redirigé vers le fournisseur OpenID.')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Recharger'})).toBeInTheDocument();
    });
});
