// The origin of the agent is the ai.agent_url of the cluster configuration, read
// from the cluster status: never a URL supplied by a token or prompt.
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
        throw new Error('The ai.agent_url of the cluster must be an HTTPS origin without credentials or a path.');
    }
};

export const getAiAgentConfig = (value) => {
    try {
        const url = parseAiAgentUrl(value);
        return {url, enabled: Boolean(url), error: null};
    } catch (error) {
        // A bad optional AI configuration must not prevent cluster supervision.
        return {url: '', enabled: false, error: error.message};
    }
};

/**
 * The longest question a link may open the assistant with (AskAssistantLink): one
 * the user reads whole before sending it. The question of a failed action holds
 * its error within it; a link received may carry any.
 */
export const MAX_LINK_PROMPT = 500;

/** The question of the `prompt` parameter of /ai, trimmed and bounded; '' when none. */
export const linkPrompt = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_LINK_PROMPT) : '');
