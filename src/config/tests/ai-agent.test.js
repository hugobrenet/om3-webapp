import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getAiAgentConfig, parseAiAgentUrl} from '../ai-agent.js';

describe('AI agent build configuration', () => {
    beforeEach(() => vi.stubEnv('VITE_AI_AGENT_URL', ''));
    afterEach(() => vi.unstubAllEnvs());
    it.each([undefined, '', '  '])('disables AI when unset (%s)', (value) => {
        expect(getAiAgentConfig(value)).toEqual({url: '', enabled: false, error: null});
    });
    it('normalizes an HTTPS origin', () => {
        expect(parseAiAgentUrl(' https://agent.example.com:8090/ ')).toBe(
            'https://agent.example.com:8090'
        );
    });
    it.each([
        'http://agent.example.com',
        'https://agent.example.com/v1',
        'not-a-url',
        'https://user:secret@agent.example.com',
        'https://agent.example.com?token=secret',
        'https://agent.example.com#fragment',
        'https://agent.example.com:0',
    ])('rejects unsafe configuration without exposing its value (%s)', (value) => {
        const result = getAiAgentConfig(value);
        expect(result.enabled).toBe(false);
        expect(result.url).toBe('');
        expect(result.error).not.toContain(value);
        expect(result.error).not.toContain('secret');
    });
});
