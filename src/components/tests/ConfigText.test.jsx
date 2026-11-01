import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {vi} from 'vitest';
import {ConfigText, clearKeywordsCache, findKeyword, parseConfig} from '../ConfigText';

describe('findKeyword', () => {
    // As the daemon lists them: by section kind, some by driver type, some of any section.
    const KEYWORDS = [
        {section: 'DEFAULT', option: 'nodes', text: 'The nodes.'},
        {section: '', option: 'comment', text: 'A free form text.'},
        {section: 'fs', option: 'mnt_opt', types: ['ext4'], text: 'ext4 options.'},
        {section: 'fs', option: 'mnt_opt', types: ['xfs'], text: 'xfs options.'},
        {section: 'fs', option: 'dev', types: [], aliases: ['device'], text: 'The device.'},
    ];
    const find = (section, key, type) => findKeyword(KEYWORDS, {section, key, type})?.text ?? null;

    test('by the kind of the section, the one of its driver type', () => {
        expect(find('fs#1', 'mnt_opt', 'xfs')).toBe('xfs options.');
        expect(find('fs#2', 'mnt_opt', 'ext4')).toBe('ext4 options.');
    });

    test('by an alias, of any section, of DEFAULT; none unknown', () => {
        expect(find('fs#1', 'device', 'xfs')).toBe('The device.');
        expect(find('fs#1', 'comment', 'xfs')).toBe('A free form text.');
        expect(find('DEFAULT', 'nodes')).toBe('The nodes.');
        expect(find('env', 'FOO')).toBeNull();
    });
});

// As the daemon answers a keyword asked by section and option, the driver of the section resolved.
const DOCS = {
    'DEFAULT nodes': [{section: 'DEFAULT', option: 'nodes', text: 'The nodes.', scopable: true}],
    'fs#1 device': [{section: 'fs', option: 'dev', types: [], aliases: ['device'], text: 'The device.', candidates: ['a', 'b']}],
    'fs#1 mnt_opt': [{section: 'fs', option: 'mnt_opt', types: ['xfs'], text: 'xfs options.'}],
    'app#1 start': [
        {section: 'app', option: 'start', types: ['forking'], text: 'Forking start.'},
        {section: 'app', option: 'start', types: ['simple'], text: 'Simple start.', deprecated: '3.0', replacedBy: 'app.run'},
    ],
};

const FILE = [
    '[DEFAULT]',
    'nodes@n1 = n1',
    '# nodes = commented out',
    '',
    '[fs#1]',
    'type = xfs',
    'mnt_opt = rw',
    'device = /dev/sda',
    '[app#1]',
    'start = /bin/true',
    '[data]',
    'private_key = crypt:abc',
    '[env]',
    'FOO = bar',
].join('\n');

describe('parseConfig', () => {
    test('the key lines, with their section, the key without its scope, where it is written; none of a section of free keys', () => {
        const keys = parseConfig(FILE).filter((l) => l.key);
        expect(keys.map(({section, key, start, end}) => [section, key, start, end])).toEqual([
            ['DEFAULT', 'nodes', 0, 8],
            ['fs#1', 'type', 0, 4],
            ['fs#1', 'mnt_opt', 0, 7],
            ['fs#1', 'device', 0, 6],
            ['app#1', 'start', 0, 5],
        ]);
    });
});

describe('ConfigText', () => {
    describe('its colours, as om <path> config show', () => {
        const TEXT = `# see {not.a.reference}
[DEFAULT]
nodes@n1 = {clusternodes}

[data]
free@n2 = {a} and {b#1.c:d}
[fs#1]
mnt = /a
  {continued}`;
        const tokens = (kind) => [...document.querySelectorAll(`[data-config-token="${kind}"]`)].map((e) => e.textContent);

        test.each([['documented', '/keywords'], ['plain', undefined]])('the sections, the keys, the scopes, the references, the text kept: %s', (_, keywordsUrl) => {
            render(<ConfigText text={TEXT} keywordsUrl={keywordsUrl} label="file"/>);
            expect(tokens('section')).toEqual(['[DEFAULT]', '[data]', '[fs#1]']);
            expect(tokens('key')).toEqual(['nodes@n1', 'free@n2', 'mnt']);
            expect(tokens('scope')).toEqual(['@n1', '@n2']);
            expect(tokens('reference')).toEqual(['{clusternodes}', '{a}', '{b#1.c:d}', '{continued}']);
            // What the file says is left as it is, line by line.
            const lines = [...document.querySelectorAll('[data-line]')].map((e) => e.textContent);
            expect(lines.join('\n')).toBe(TEXT);
        });

        test('in the colours of the theme; a comment plain, even holding a reference', () => {
            render(<ConfigText text={TEXT} label="file"/>);
            expect(document.querySelector('[data-config-token="section"]')).toHaveClass('text-code-keyword');
            expect(document.querySelector('[data-config-token="key"]')).toHaveClass('text-ink-muted');
            expect(document.querySelector('[data-config-token="scope"]')).toHaveClass('text-state-down');
            expect(document.querySelector('[data-config-token="reference"]')).toHaveClass('text-state-up');
            expect(document.querySelector('[data-line="0"]').querySelector('[data-config-token]')).toBeNull();
        });
    });

    beforeEach(() => {
        clearKeywordsCache();
        localStorage.setItem('authToken', 'tok');
        global.fetch = vi.fn(async (url) => {
            const q = new URL(url, 'http://x').searchParams;
            return new Response(JSON.stringify({items: DOCS[`${q.get('section')} ${q.get('option')}`] ?? []}), {status: 200});
        });
    });

    test('the name of each key a button, as written, the rest of its line as it is; no keyword asked before one is opened', () => {
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw"/>);
        const file = screen.getByRole('group', {name: 'cfg'});
        expect(within(file).getAllByRole('button').map((b) => [b.getAttribute('aria-label'), b.textContent])).toEqual([
            ['What nodes does', 'nodes@n1'],
            ['What fs#1.type does', 'type'],
            ['What fs#1.mnt_opt does', 'mnt_opt'],
            ['What fs#1.device does', 'device'],
            ['What app#1.start does', 'start'],
        ]);
        expect(file.querySelector('[data-line="6"]')).toHaveTextContent(/^mnt_opt = rw$/);
        expect([...document.querySelectorAll('[data-line]')].map((e) => e.textContent)).toContain('private_key = crypt:abc');
        expect(screen.getByText('# nodes = commented out')).toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('opened, a dialog of what the keyword does, read for it alone, by its section and its key; closed by Escape', async () => {
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/api/object/path/ns1/svc/web/config/keywords"/>);
        fireEvent.click(screen.getByRole('button', {name: 'What fs#1.device does'}));
        const doc = await screen.findByRole('dialog', {name: 'fs#1.device'});
        expect(await within(doc).findByText('The device.')).toBeInTheDocument();
        expect(doc).toHaveTextContent('Valuesa, b');
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/object/path/ns1/svc/web/config/keywords?section=fs%231&option=device',
            {headers: {Authorization: 'Bearer tok'}},
        );
        fireEvent.keyDown(doc, {key: 'Escape'});
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('a scoped key asked without its scope, a DEFAULT one by its section; read once a session', async () => {
        const {unmount} = render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw"/>);
        fireEvent.click(screen.getByRole('button', {name: 'What nodes does'}));
        const doc = await screen.findByRole('dialog', {name: 'nodes'});
        expect(await within(doc).findByText('The nodes.')).toBeInTheDocument();
        expect(doc).toHaveTextContent('ScopableYes');
        expect(global.fetch).toHaveBeenCalledWith('/kw?section=DEFAULT&option=nodes', expect.anything());
        unmount();
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw"/>);
        fireEvent.click(screen.getByRole('button', {name: 'What nodes does'}));
        expect(await within(await screen.findByRole('dialog', {name: 'nodes'})).findByText('The nodes.')).toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('several keywords answered, each under its section and types; none, said', async () => {
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw"/>);
        fireEvent.click(screen.getByRole('button', {name: 'What app#1.start does'}));
        const doc = await screen.findByRole('dialog', {name: 'app#1.start'});
        const headings = await within(doc).findAllByRole('heading', {level: 3});
        expect(headings.map((h) => h.textContent)).toEqual(['app.start (forking)', 'app.start (simple)']);
        expect(doc).toHaveTextContent('Deprecatedreplaced by app.run');
        fireEvent.keyDown(doc, {key: 'Escape'});

        fireEvent.click(screen.getByRole('button', {name: 'What fs#1.type does'}));
        expect(await screen.findByText('No documentation for this keyword.')).toBeInTheDocument();
    });

    test('the documentation not read: why said, and tried again the next time', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403}));
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw"/>);
        fireEvent.click(screen.getByRole('button', {name: 'What nodes does'}));
        expect(await screen.findByRole('alert')).toHaveTextContent('The documentation of the keyword could not be read: forbidden');
        fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
        fireEvent.click(screen.getByRole('button', {name: 'What nodes does'}));
        await screen.findByRole('alert');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('no keywords address: the file as it is, no button', () => {
        render(<ConfigText text={FILE} label="cfg"/>);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
