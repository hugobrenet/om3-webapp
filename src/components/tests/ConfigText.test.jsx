import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {vi} from 'vitest';
import {ConfigText, clearKeywordsCache, findKeyword, parseConfig} from '../ConfigText';

// As the daemon describes them: by section kind, some by driver type, some of any section.
const KEYWORDS = [
    {section: 'DEFAULT', option: 'nodes', text: 'The nodes.', scopable: true},
    {section: '', option: 'comment', text: 'A free form text.'},
    {section: 'fs', option: 'mnt_opt', types: ['ext4'], text: 'ext4 options.'},
    {section: 'fs', option: 'mnt_opt', types: ['xfs'], text: 'xfs options.'},
    {section: 'fs', option: 'dev', types: [], aliases: ['device'], text: 'The device.', candidates: ['a', 'b']},
    {section: 'app', option: 'start', text: 'Old start.', deprecated: '3.0', replacedBy: 'app.run'},
];

const FILE = [
    '[DEFAULT]',
    'nodes@n1 = n1',
    '# nodes = commented out',
    '',
    '[fs#1]',
    'type = xfs',
    'mnt_opt = rw',
    'device = /dev/sda',
    'comment = data disk',
    '[data]',
    'private_key = crypt:abc',
].join('\n');

describe('parseConfig', () => {
    test('the key lines, with their section, the key without its scope, and the type of the section', () => {
        const keys = parseConfig(FILE).filter((l) => l.key);
        expect(keys.map(({section, key, type}) => [section, key, type])).toEqual([
            ['DEFAULT', 'nodes', undefined],
            ['fs#1', 'type', 'xfs'],
            ['fs#1', 'mnt_opt', 'xfs'],
            ['fs#1', 'device', 'xfs'],
            ['fs#1', 'comment', 'xfs'],
            ['data', 'private_key', undefined],
        ]);
    });
});

describe('findKeyword', () => {
    const find = (section, key, type) => findKeyword(KEYWORDS, {section, key, type})?.text ?? null;

    test('by the kind of the section, the one of its driver type', () => {
        expect(find('fs#1', 'mnt_opt', 'xfs')).toBe('xfs options.');
        expect(find('fs#2', 'mnt_opt', 'ext4')).toBe('ext4 options.');
    });

    test('by an alias, of any section, of DEFAULT', () => {
        expect(find('fs#1', 'device', 'xfs')).toBe('The device.');
        expect(find('fs#1', 'comment', 'xfs')).toBe('A free form text.');
        expect(find('DEFAULT', 'nodes')).toBe('The nodes.');
    });

    test('no keyword for the free keys of a secret or a configuration', () => {
        expect(find('data', 'private_key')).toBeNull();
        expect(find('env', 'FOO')).toBeNull();
    });
});

describe('ConfigText', () => {
    beforeEach(() => {
        clearKeywordsCache();
        localStorage.setItem('authToken', 'tok');
        global.fetch = vi.fn(async () => new Response(JSON.stringify({items: KEYWORDS}), {status: 200}));
    });

    const hover = async () => {
        const file = screen.getByRole('group', {name: 'cfg'});
        fireEvent.focus(file);
        await screen.findAllByRole('button', {name: /^What /});
    };

    test('a "?" by the keys a keyword documents only, shown on hovering its line', async () => {
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw" cacheKey="svc"/>);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        await hover();
        expect(global.fetch).toHaveBeenCalledWith('/kw', {headers: {Authorization: 'Bearer tok'}});
        expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
            'What nodes does', 'What fs#1.mnt_opt does', 'What fs#1.device does', 'What fs#1.comment does',
        ]);
        expect(screen.getByRole('button', {name: 'What nodes does'})).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus:opacity-100');
    });

    test('the help says what the keyword does, its values, and Escape closes it', async () => {
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw" cacheKey="svc"/>);
        await hover();
        fireEvent.click(screen.getByRole('button', {name: 'What fs#1.device does'}));
        const doc = screen.getByRole('dialog', {name: 'fs#1.device'});
        expect(doc).toHaveTextContent('The device.');
        expect(doc).toHaveTextContent('Valuesa, b');
        fireEvent.keyDown(doc, {key: 'Escape'});
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('the help stands out of the file, in the window, whatever the room around', async () => {
        const {container} = render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw" cacheKey="svc"/>);
        await hover();
        // The "?" by the bottom right corner of a window 800 wide, 600 high.
        const button = screen.getByRole('button', {name: 'What fs#1.device does'});
        button.getBoundingClientRect = () => ({top: 560, bottom: 576, left: 780, right: 796, width: 16, height: 16});
        Object.defineProperty(document.documentElement, 'clientWidth', {configurable: true, value: 800});
        const innerHeight = window.innerHeight;
        Object.defineProperty(window, 'innerHeight', {configurable: true, value: 600});
        const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
        try {
            fireEvent.click(button);
            const doc = screen.getByRole('dialog', {name: 'fs#1.device'});
            // Not in the file, which scrolls sideways and is cut by the panel.
            expect(container.contains(doc)).toBe(false);
            expect(doc).toHaveClass('fixed');
            expect(button).toHaveAttribute('aria-controls', doc.id);
            // Over the "?", short of room below; its right edge on the one of the "?", kept in the window.
            expect(doc.style.bottom).toBe('44px');
            expect(doc.style.top).toBe('');
            expect(doc.style.width).toBe('576px');
            expect(doc.style.left).toBe('216px');
            // A click in it keeps it open.
            fireEvent.pointerDown(doc);
            expect(screen.getByRole('dialog', {name: 'fs#1.device'})).toBeInTheDocument();
            fireEvent.pointerDown(document.body);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        } finally {
            scrollHeight.mockRestore();
            delete document.documentElement.clientWidth;
            Object.defineProperty(window, 'innerHeight', {configurable: true, value: innerHeight});
        }
    });

    test('the keywords of a kind are read once for all its objects', async () => {
        const {unmount} = render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw/a" cacheKey="svc"/>);
        await hover();
        unmount();
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw/b" cacheKey="svc"/>);
        await hover();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('keywords not read: the file still shows, and says why there is no help', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify({detail: 'forbidden'}), {status: 403}));
        render(<ConfigText text={FILE} label="cfg" keywordsUrl="/kw" cacheKey="svc"/>);
        fireEvent.focus(screen.getByRole('group', {name: 'cfg'}));
        expect(await screen.findByText(/keywords help could not be read: forbidden/)).toBeInTheDocument();
        expect(screen.getByText('mnt_opt = rw')).toBeInTheDocument();
    });
});
