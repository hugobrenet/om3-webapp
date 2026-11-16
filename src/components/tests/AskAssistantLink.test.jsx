import React from 'react';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import AskAssistantLink from '../AskAssistantLink.jsx';
import {MAX_LINK_PROMPT} from '../../config/ai-agent.js';

const mocks = vi.hoisted(() => ({auth: null, config: null}));
vi.mock('../../context/AuthProvider.jsx', () => ({useAuthSession: () => mocks.auth}));
vi.mock('../../hooks/useClusterConfig.js', () => ({default: () => mocks.config}));

const renderLink = (prompt) =>
    render(
        <MemoryRouter>
            <AskAssistantLink prompt={prompt}/>
        </MemoryRouter>
    );
const link = () => screen.queryByRole('link', {name: 'Analyze with the assistant'});

describe('the link to the assistant', () => {
    beforeEach(() => {
        mocks.auth = {authChoice: 'openid', accessToken: 'token', user: 'alice'};
        mocks.config = {clusterId: 'cluster-id', agentUrl: 'https://agent.example.com', clusterName: 'lab', loaded: true};
    });
    test('opens the page of the assistant with the question', () => {
        renderLink('Why is prod/svc/web down?');
        const href = new URL(link().getAttribute('href'), 'https://webapp.example.com');
        expect(href.pathname).toBe('/ai');
        expect(href.searchParams.get('prompt')).toBe('Why is prod/svc/web down?');
    });
    test('bounds the question', () => {
        renderLink('x'.repeat(MAX_LINK_PROMPT + 100));
        const href = new URL(link().getAttribute('href'), 'https://webapp.example.com');
        expect(href.searchParams.get('prompt')).toHaveLength(MAX_LINK_PROMPT);
    });
    test.each([
        ['no agent named by the cluster', () => (mocks.config.agentUrl = '')],
        ['an agent URL refused', () => (mocks.config.agentUrl = 'http://agent.example.com')],
        ['a session other than OpenID', () => (mocks.auth.authChoice = 'basic')],
        ['no session', () => (mocks.auth = null)],
        ['the cluster not read yet', () => (mocks.config.clusterId = '')],
    ])('is not shown with %s', (_case, change) => {
        change();
        renderLink('Why?');
        expect(link()).toBeNull();
    });
    test('is not shown without a question', () => {
        renderLink('   ');
        expect(link()).toBeNull();
    });
});
