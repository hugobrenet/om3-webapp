import React from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {Glossary} from '../Glossary';
import {PageIntro} from '../PageIntro';
import {hideIntro, reloadHiddenIntros, setIntrosEnabled} from '../../app/page-intro';
import {Term} from '../../app/Term';
import {HOVER_CARD_DELAY_MS} from '../../ui/components/HoverCard';
import {NARROW_QUERY} from '../../ui/lib/media';

const renderAt = (url, ui) => render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);

beforeEach(() => {
    localStorage.clear();
    reloadHiddenIntros();
});

describe('Term', () => {
    const card = () => document.querySelector('[data-term-card]');
    const toggle = () => screen.getByRole('button', {name: 'Avail'});

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const wait = (ms) => act(() => {
        vi.advanceTimersByTime(ms);
    });

    test('a help cursor at once, no underline; its entry once the pointer has stayed, gone with it', () => {
        render(<Term term="avail">Avail</Term>);
        const word = screen.getByText('Avail');
        expect(word).toHaveAttribute('data-term', 'avail');
        expect(word).toHaveClass('cursor-help');
        expect(word.className).not.toMatch(/underline/);

        fireEvent.mouseEnter(toggle());
        wait(HOVER_CARD_DELAY_MS - 1);
        expect(card()).toBeNull();
        wait(1);
        expect(card()).toHaveTextContent(/^Avail/);
        expect(card().textContent.length).toBeGreaterThan(40);
        expect(toggle()).toHaveAccessibleDescription(/^Avail Is it running\? Only the resources it needs count\./);
        fireEvent.mouseLeave(toggle());
        expect(card()).toBeNull();
    });

    test('a pointer passing by shows nothing', () => {
        render(<Term term="avail">Avail</Term>);
        fireEvent.mouseEnter(toggle());
        wait(HOVER_CARD_DELAY_MS / 2);
        fireEvent.mouseLeave(toggle());
        wait(HOVER_CARD_DELAY_MS);
        expect(card()).toBeNull();
    });

    test('a click shows it at once and keeps it, the pointer gone; a click again closes it', () => {
        render(<Term term="avail">Avail</Term>);
        fireEvent.mouseEnter(toggle());
        fireEvent.click(toggle());
        expect(card()).not.toBeNull();
        expect(toggle()).toHaveAttribute('aria-expanded', 'true');
        fireEvent.mouseLeave(toggle());
        wait(HOVER_CARD_DELAY_MS);
        expect(card()).not.toBeNull();
        fireEvent.click(toggle());
        expect(card()).toBeNull();
    });

    test('shown by the hover, a click keeps it', () => {
        render(<Term term="avail">Avail</Term>);
        fireEvent.mouseEnter(toggle());
        wait(HOVER_CARD_DELAY_MS);
        fireEvent.click(toggle());
        fireEvent.mouseLeave(toggle());
        expect(card()).not.toBeNull();
    });

    test.each(['Enter', ' '])('from the keyboard: %j opens it, Escape closes it', (key) => {
        render(<Term term="avail">Avail</Term>);
        expect(toggle()).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(toggle(), {key});
        expect(card()).not.toBeNull();
        fireEvent.keyDown(toggle(), {key: 'Escape'});
        expect(card()).toBeNull();
    });

    test('closed when the focus leaves or the page scrolls', () => {
        render(<Term term="avail">Avail</Term>);
        fireEvent.click(toggle());
        fireEvent.blur(toggle());
        expect(card()).toBeNull();
        fireEvent.click(toggle());
        fireEvent.scroll(window);
        expect(card()).toBeNull();
    });

    test('its click does not reach the row it sits in', () => {
        const onRow = vi.fn();
        render(<div onClick={onRow}><Term term="avail">Avail</Term></div>);
        fireEvent.click(toggle());
        expect(onRow).not.toHaveBeenCalled();
    });

    test('in a button, the hover alone: the click is the button\'s, the card gone with it', () => {
        const onSort = vi.fn();
        render(<button type="button" onClick={onSort}><Term term="avail" inert>Avail</Term></button>);
        const word = screen.getByText('Avail');
        expect(word.parentElement).not.toHaveAttribute('tabindex');
        fireEvent.mouseEnter(word.parentElement);
        wait(HOVER_CARD_DELAY_MS);
        expect(card()).not.toBeNull();
        fireEvent.click(word);
        expect(onSort).toHaveBeenCalledTimes(1);
        expect(card()).toBeNull();
    });

    test('a key the glossary does not hold: the label alone', () => {
        render(<Term term="nope">Plain</Term>);
        expect(screen.getByText('Plain')).not.toHaveAttribute('data-term');
    });
});

describe('PageIntro', () => {
    test('is not shown on a narrow screen', () => {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn((query) => ({
            matches: query === NARROW_QUERY,
            addEventListener: () => {
            },
            removeEventListener: () => {
            },
        }));
        try {
            renderAt('/nodes', <PageIntro/>);
            expect(screen.queryByRole('complementary', {name: 'About this page'})).not.toBeInTheDocument();
        } finally {
            window.matchMedia = originalMatchMedia;
        }
    });

    test('what the page is about, the glossary a click away; hidden for the browser, page by page', () => {
        const {unmount} = renderAt('/objects?list=secrets', <PageIntro/>);
        const intro = screen.getByRole('complementary', {name: 'About this page'});
        expect(intro).toHaveTextContent(/^Secrets \(sec\)/);
        expect(within(intro).getByRole('link', {name: 'What the words mean'})).toHaveAttribute('href', '/glossary');
        fireEvent.click(within(intro).getByRole('button', {name: 'Hide this introduction'}));
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('om3-webapp.hiddenIntros'))).toEqual(['objects-secrets']);
        unmount();
        // Another page keeps its own.
        renderAt('/nodes', <PageIntro/>);
        expect(screen.getByRole('complementary', {name: 'About this page'})).toHaveTextContent(/^These are the servers in your cluster\./);
    });

    test('all turned off: none on any page; on again, those hidden one by one still hidden', () => {
        hideIntro('pools');
        setIntrosEnabled(false);
        const {unmount} = renderAt('/nodes', <PageIntro/>);
        expect(document.querySelector('[data-page-intro]')).toBeNull();
        unmount();
        act(() => setIntrosEnabled(true));
        renderAt('/nodes', <PageIntro/>);
        expect(document.querySelector('[data-page-intro=nodes]')).not.toBeNull();
        // Kept apart: the page hidden before, hidden still.
        expect(localStorage.getItem('om3-webapp.hiddenIntros')).toBe('["pools"]');
        expect(localStorage.getItem('om3-webapp.introsOff')).toBeNull();
    });

    test('none on a page without one', () => {
        const {container} = renderAt('/whoami', <PageIntro/>);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('Glossary', () => {
    test('every term by group, searched by name or definition', () => {
        renderAt('/glossary', <Glossary/>);
        expect(screen.getByRole('heading', {level: 1, name: 'Glossary'})).toBeInTheDocument();
        expect(screen.getAllByRole('heading', {level: 2}).map((h) => h.textContent))
            .toEqual(['Symbols', 'What a cluster is made of', 'Kinds of objects', 'States and flags', 'How objects are run', 'Actions']);
        // The symbols first, each drawn as the status board draws it, then said.
        const symbols = screen.getByRole('region', {name: 'Symbols'});
        expect(within(symbols).getAllByRole('heading', {level: 3}).map((h) => h.textContent))
            .toEqual(['Status', 'Marks on an instance', 'Flags on a resource']);
        const frozen = symbols.querySelector('[data-legend="marks-frozen"]');
        // Said beside it: no tooltip of its own, as on the board, where the card of the cell says it.
        expect(frozen.nextElementSibling).toHaveTextContent('Frozen: the cluster will not start, stop or move it automatically.');
        expect(symbols.querySelector('[data-legend="states-downQuiet"] [data-state="down"]')).toHaveClass('text-ink-muted');
        expect(symbols.querySelector('[data-legend="flags-M"]')).toHaveTextContent('M');
        fireEvent.change(screen.getByRole('searchbox', {name: 'Search the glossary'}), {target: {value: 'giveback'}});
        // Searching, the terms alone.
        expect(screen.queryByRole('region', {name: 'Symbols'})).not.toBeInTheDocument();
        expect(screen.getAllByRole('term').map((dt) => dt.textContent)).toContain('Giveback');
        expect(screen.getAllByRole('term').map((dt) => dt.textContent)).not.toContain('Namespace');
        fireEvent.change(screen.getByRole('searchbox', {name: 'Search the glossary'}), {target: {value: 'zzzz'}});
        expect(screen.getByText('No term matches.')).toBeInTheDocument();
    });

    test('a term linked to marked; the hidden intros shown again from here', () => {
        localStorage.setItem('om3-webapp.hiddenIntros', JSON.stringify(['nodes', 'pools']));
        act(() => reloadHiddenIntros());
        renderAt('/glossary#term-frozen', <Glossary/>);
        expect(document.getElementById('term-frozen')).toHaveAttribute('data-target');
        expect(document.getElementById('term-avail')).not.toHaveAttribute('data-target');
        fireEvent.click(screen.getByRole('button', {name: 'Show the 2 hidden page introductions again'}));
        expect(localStorage.getItem('om3-webapp.hiddenIntros')).toBeNull();
        expect(screen.queryByRole('button', {name: /hidden page introduction/})).not.toBeInTheDocument();
    });
});
