// This is deployment configuration, never a URL supplied by a token or prompt.
export const parseAiAgentUrl = (value) => {
    if (!value?.trim()) return '';
    try {
        const url = new URL(value.trim());
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash ||
            url.port === '0'
        ) {
            throw new Error();
        }
        return url.origin;
    } catch {
        throw new Error('VITE_AI_AGENT_URL must be an HTTPS origin without credentials or a path.');
    }
};

export const getAiAgentConfig = (value = import.meta.env.VITE_AI_AGENT_URL) => {
    try {
        const url = parseAiAgentUrl(value);
        return {url, enabled: Boolean(url), error: null};
    } catch (error) {
        // A bad optional AI configuration must not prevent cluster supervision.
        return {url: '', enabled: false, error: error.message};
    }
};
