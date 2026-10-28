import {describe, expect, test} from 'vitest';
import en from '../../i18n/locales/en.json';
import fr from '../../i18n/locales/fr.json';
import tools from './fixtures/om3-mcp-tools.json';

// The tools of om3-mcp, names and input properties, as its tools/list gives
// them with the actions enabled, main of 2026-10-26. Exported again from the
// MCP when its tools change: the sentences of the webapp are held to it.
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
// The tools of the agent itself, and the sentences of the previews that name
// no tool, whose params the MCP gives.
const AGENT_TOOLS = {search_tools: ['query'], read_resource: ['uri'], load_skill: ['skill']};
const PREVIEW_KEYS = ['config_update', 'node_config_update', 'object_create'];
const params = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe('the sentences of the steps and the confirmations', () => {
    test.each(Object.entries(en.ai.step))('the step of %s names arguments the tool always takes', (tool, text) => {
        const required = AGENT_TOOLS[tool] ?? byName[tool]?.required;
        expect(required, `${tool} is no tool of om3-mcp nor of the agent`).toBeDefined();
        for (const param of params(text)) expect(required).toContain(param);
    });
    test.each(Object.entries(en.ai.confirm.summary).filter(([key]) => !PREVIEW_KEYS.includes(key)))(
        'the confirmation of %s names arguments of the tool',
        (tool, text) => {
            expect(byName[tool], `${tool} is no tool of om3-mcp`).toBeDefined();
            for (const param of params(text)) expect(byName[tool].properties).toContain(param);
        }
    );
    test.each([
        ['ai.step', en.ai.step, fr.ai.step],
        ['ai.confirm.summary', en.ai.confirm.summary, fr.ai.confirm.summary],
    ])('%s says the same in English and French', (_, english, french) => {
        expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
        for (const key of Object.keys(english)) expect(params(french[key])).toEqual(params(english[key]));
    });
});
