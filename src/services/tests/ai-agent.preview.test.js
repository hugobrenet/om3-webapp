import {describe, expect, test} from 'vitest';
import {parseConfirmation, parsePreview} from '../ai-agent.js';

const base = {
    id: 'confirmation-1',
    turn_id: 'turn-1',
    tool: {name: 'update_object_config', title: 'Update', destructive: true},
    arguments: {path: 'web'},
    expires_at: '2026-10-26T17:45:00Z',
};
const preview = {
    summary: {text: 'Update web', key: 'config_update', params: {path: 'web'}},
    changes: [{key: 'env.a', op: '+=', value: 'b', before: 'a', after: 'a b', after_computed_by_mcp: true, extra: 'dropped'}],
    deleted: [{section: 'fs#2', keys: ['fs#2.type']}],
    read_at: '2026-10-26T09:00:00Z',
    secrets_omitted: 1,
};

describe('the preview of a confirmation', () => {
    test('keeps the fields it knows, from the conversation read', () => {
        const confirmation = parseConfirmation({...base, preview, preview_error: '', preview_arguments: {path: 'api'}});
        expect(confirmation.preview).toEqual({
            summary: {text: 'Update web', key: 'config_update', params: {path: 'web'}},
            changes: [{key: 'env.a', scope: '', op: '+=', value: 'b', before: 'a', after: 'a b', computed: true, note: '', noteKeys: []}],
            deleted: [{section: 'fs#2', keys: ['fs#2.type'], secretsOmitted: 0}],
            readAt: '2026-10-26T09:00:00Z',
            warnings: [],
            secretsOmitted: 1,
        });
        expect(confirmation.preview_arguments).toEqual({path: 'api'});
        expect(confirmation.preview_error).toBeUndefined();
    });
    test.each([
        ['an unknown operation', {...preview, changes: [{...preview.changes[0], op: 'drop'}]}],
        ['a key that is no name', {...preview, summary: {...preview.summary, key: 'Config Update'}}],
        ['a param that is no text', {...preview, summary: {...preview.summary, params: {path: 1}}}],
        ['no summary', {changes: []}],
        ['a note key that is no name', {...preview, changes: [{...preview.changes[0], note_keys: ['Not Set']}]}],
        ['a list of changes that is no list', {...preview, changes: {}}],
    ])('drops a preview with %s, the confirmation standing', (_, value) => {
        expect(parsePreview(value)).toBeNull();
        const confirmation = parseConfirmation({...base, preview: value});
        expect(confirmation.preview).toBeUndefined();
        expect(confirmation.preview_error).toBe('The preview of the agent is invalid.');
        expect(confirmation.arguments).toEqual({path: 'web'});
    });
    test('bounds the cause of a failed preview', () => {
        expect(parseConfirmation({...base, preview_error: 'x'.repeat(5000)}).preview_error).toHaveLength(2048);
    });
});
