import React from 'react';
import {render, screen, within, fireEvent} from '@testing-library/react';
import '../../i18n';
import {HeartbeatSummary} from '../HeartbeatSummary';

/** A stream of a node toward its peers, each beating or not. */
const stream = (id, type, peers, state = 'running') => ({
    id, type, state,
    peers: Object.fromEntries(Object.entries(peers).map(([peer, up]) => [peer, {is_beating: up}])),
});

const STATUS = {
    n1: {streams: [stream('hb#1.tx', 'unicast', {n2: true}), stream('hb#1.rx', 'unicast', {n2: true}), stream('hb#2.tx', 'disk', {n2: true}), stream('hb#2.rx', 'disk', {n2: false})]},
    n2: {streams: [stream('hb#1.tx', 'unicast', {n1: true}), stream('hb#1.rx', 'unicast', {n1: true}), stream('hb#2.tx', 'disk', {n1: true}, 'stopped'), stream('hb#2.rx', 'disk', {n1: true})]},
};

/** The cards of a group: their name, their counts, what they are. */
const cardsOf = (group) => [...group.querySelectorAll('[data-card]')].map((card) => [
    card.querySelector('.font-medium').textContent,
    card.querySelector('[data-counts]').textContent,
    card.querySelector('.text-ink-muted').textContent,
]);

describe('HeartbeatSummary', () => {
    test('a box of heartbeat cards, a box of routines in a zone a node, its name on its border, grey cards of two lines inside, each its counts', () => {
        render(<HeartbeatSummary heartbeatStatus={STATUS}/>);
        const box = document.body;
        // Two boxes, a heading each, apart: no summary around them.
        expect(screen.getAllByRole('heading', {level: 2}).map((h) => h.textContent)).toEqual(['Heartbeats', 'Routines']);
        expect(screen.queryByRole('region', {name: 'Summary'})).toBeNull();
        expect(screen.getByRole('region', {name: 'Heartbeats'}).contains(screen.getByRole('region', {name: 'Routines'}))).toBe(false);
        expect(cardsOf(screen.getByRole('region', {name: 'Heartbeats'}))).toEqual([
            ['hb#1', '4/4', 'unicast · network'],
            ['hb#2', '2/4', 'disk · storage'],
        ]);
        const routines = screen.getByRole('region', {name: 'Routines'});
        // A zone a node, its name on its border, its routines receiving on the left, sending on
        // the right, a half each, a light line between, each half saying its side once.
        expect([...routines.querySelectorAll('fieldset')].map((zone) => [
            zone.querySelector('legend').textContent,
            [...zone.querySelectorAll('[data-dir]')].map((half) => [
                half.dataset.dir,
                half.querySelector('p').textContent,
                [...half.querySelectorAll('[data-card]')].map((card) => card.dataset.card),
            ]),
        ])).toEqual([
            ['n13/4', [['rx', '↓ rx', ['n1 hb#1.rx', 'n1 hb#2.rx']], ['tx', '↑ tx', ['n1 hb#1.tx', 'n1 hb#2.tx']]]],
            ['n23/4', [['rx', '↓ rx', ['n2 hb#1.rx', 'n2 hb#2.rx']], ['tx', '↑ tx', ['n2 hb#1.tx', 'n2 hb#2.tx']]]],
        ]);
        const halves = routines.querySelector('[data-dir]').parentElement;
        expect(halves).toHaveClass('grid', 'grid-cols-2', 'divide-x', 'divide-line');
        // A card a routine, its heartbeat only, its side said by its half, a pie of its links: no
        // counts nor bar on it, they are in its popup with its whole name, type and state.
        const pieOf = (card) => [...card.querySelectorAll('[data-slice]')].map((slice) => slice.dataset.slice).join(',');
        expect([...routines.querySelectorAll('[data-card]')].map((card) => [card.querySelector('[data-name]').textContent, pieOf(card)])).toEqual([
            ['hb#1', 'up'],
            ['hb#2', 'down'],
            ['hb#1', 'up'],
            ['hb#2', 'up'],
            ['hb#1', 'up'],
            ['hb#2', 'up'],
            ['hb#1', 'up'],
            ['hb#2', ''],
        ]);
        expect(routines.querySelector('[data-card]').textContent).not.toMatch(/[↑↓]|\b[rt]x\b|unicast|started|\d\/\d/);
        expect(routines.querySelector('[data-card] [data-gauge]')).toBeNull();
        expect(routines.querySelector('[data-card="n2 hb#2.tx"]').title).toBe('n2 hb#2 tx · disk · stopped · 0/1 beating');
        expect(routines.querySelector('[data-card="n1 hb#1.tx"]').title).toBe('n1 hb#1 tx · unicast · started · 1/1 beating');
        // The pie as big as a character, beside the name; in as many columns as a half holds.
        const card = routines.querySelector('[data-card]');
        expect(card.querySelector('[data-pie]')).toHaveClass('size-[1em]');
        expect(card.querySelector('[data-name]').nextElementSibling).toBe(card.querySelector('[data-pie]'));
        expect(routines.querySelector('[data-dir] ul')).toHaveClass('grid', 'grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))]');
        // A routine stopped: a red stop in place of its pie, its card grey as the others.
        expect([...routines.querySelectorAll('[data-stopped]')].map((one) => one.dataset.card)).toEqual(['n2 hb#2.tx']);
        const stopped = routines.querySelector('[data-card="n2 hb#2.tx"]');
        expect(stopped).toHaveClass('bg-surface-sunken');
        expect(stopped.querySelector('[data-pie]')).toBeNull();
        expect(stopped.querySelector('[data-stopped-icon]')).toHaveClass('text-state-down', 'size-[1em]');
        expect(routines.querySelectorAll('[data-stopped-icon]')).toHaveLength(1);
        // The cards of the heartbeats and of the routines alike: ground, border, corners.
        const heartbeat = box.querySelector('[data-card="hb#1"]');
        for (const one of [card, heartbeat]) {
            expect(one).toHaveClass('rounded-(--radius-control)', 'border', 'border-transparent', 'bg-surface-sunken');
        }
        expect(routines.querySelector('fieldset')).toHaveClass('border', 'border-line');
        expect(routines.querySelector('fieldset').className).not.toMatch(/bg-/);
        expect(routines.querySelector('[data-card]')).toHaveClass('bg-surface-sunken');
        // All of them shown, the box as high as they are: nothing to scroll.
        expect(routines.querySelector('[data-routines-box]').className).not.toMatch(/max-h-|overflow-/);
        // The counts in their tint.
        expect(box.querySelector('[data-card="hb#2"] [data-counts]')).toHaveClass('text-state-warn');
        // Not root: no hint, no button, the cards and the names of the nodes plain.
        expect(box.querySelector('[data-hint]')).toBeNull();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    test('a gauge a card, as wide as it: a segment a link, beating, failing, stopped in that order', () => {
        render(<HeartbeatSummary heartbeatStatus={STATUS}/>);
        const box = document.body;
        const gauge = box.querySelector('[data-card="hb#2"] [data-gauge]');
        expect([...gauge.children].map((part) => part.dataset.part)).toEqual(['up', 'up', 'down', 'stopped']);
        // A thin rounded bar, as the routines'.
        expect(gauge).toHaveClass('w-full', 'h-1', 'rounded-full');
    });

    test('more links than segments: the parts of the gauge in proportion', () => {
        const peers = Object.fromEntries(Array.from({length: 30}, (_, i) => [`p${i}`, i < 20]));
        render(<HeartbeatSummary heartbeatStatus={{n1: {streams: [stream('hb#1.rx', 'unicast', peers)]}}}/>);
        const gauge = document.querySelector('[data-card="hb#1"] [data-gauge]');
        expect([...gauge.children].map((part) => [part.dataset.part, part.style.flexGrow])).toEqual([['up', '20'], ['down', '10']]);
    });

    test('for root, a routine card clicked toggles it, a hint over the routines saying so; the card busy while it runs', () => {
        const onToggle = vi.fn();
        const {rerender} = render(<HeartbeatSummary heartbeatStatus={STATUS} onToggle={onToggle}/>);
        const routines = screen.getByRole('region', {name: 'Routines'});
        // A hint, light, on the line of the title, at its right; an icon saying it in its place
        // when the box is too narrow.
        const hint = routines.querySelector('[data-hint]');
        expect(hint).toHaveTextContent('Click a routine to stop it, or to start it.');
        expect(hint).toHaveClass('text-ink-muted', 'hidden', '@md:block');
        expect(hint.previousElementSibling).toHaveTextContent('Routines');
        expect(hint.parentElement).toHaveClass('@container', 'justify-between');
        const icon = within(routines).getByRole('img', {name: 'Click a routine to stop it, or to start it.'});
        expect(icon).toHaveClass('@md:hidden');
        expect(icon).toHaveAttribute('title', 'Click a routine to stop it, or to start it.');
        // The card itself, its action as its routine runs or not: no button of its own, no selection.
        const stop = within(routines.querySelector('[data-card="n1 hb#1.tx"]')).getByRole('button', {name: 'Stop n1 hb#1 tx'});
        const start = within(routines.querySelector('[data-card="n2 hb#2.tx"]')).getByRole('button', {name: 'Start n2 hb#2 tx'});
        expect(stop).toHaveClass('absolute', 'inset-0');
        expect(stop).not.toHaveAttribute('aria-pressed');
        expect(within(routines.querySelector('[data-card="n1 hb#1.tx"]')).getAllByRole('button')).toHaveLength(1);
        // The heartbeats and the names of the nodes act on nothing.
        expect(within(screen.getByRole('region', {name: 'Heartbeats'})).queryAllByRole('button')).toHaveLength(0);
        expect(within(routines.querySelector('[data-zone="n1"]')).queryAllByRole('button')).toHaveLength(0);
        fireEvent.click(stop);
        fireEvent.click(start);
        expect(onToggle.mock.calls.map(([routine]) => [routine.node, routine.id, routine.streamState])).toEqual([
            ['n1', 'hb#1.tx', 'running'],
            ['n2', 'hb#2.tx', 'stopped'],
        ]);
        // Its request running: the card busy, pulsing, off.
        rerender(<HeartbeatSummary heartbeatStatus={STATUS} onToggle={onToggle} busy="n2 hb#2.tx"/>);
        const busy = routines.querySelector('[data-card="n2 hb#2.tx"]');
        expect(busy).toHaveAttribute('aria-busy', 'true');
        expect(busy).toHaveClass('animate-pulse');
        expect(within(busy).getByRole('button')).toBeDisabled();
        expect(routines.querySelector('[data-card="n1 hb#1.tx"]')).not.toHaveAttribute('aria-busy');
    });

    test('a heartbeat card clicked opens its configuration; for root, a light card after them for a new one', () => {
        const onOpen = vi.fn();
        const onNew = vi.fn();
        const {rerender} = render(<HeartbeatSummary heartbeatStatus={STATUS} onOpenHeartbeat={onOpen}/>);
        const heartbeats = screen.getByRole('region', {name: 'Heartbeats'});
        fireEvent.click(within(heartbeats).getByRole('button', {name: 'Show the configuration of hb#2'}));
        expect(onOpen).toHaveBeenCalledWith('hb#2');
        expect(within(heartbeats).queryByRole('button', {name: 'New heartbeat'})).toBeNull();
        rerender(<HeartbeatSummary heartbeatStatus={STATUS} onOpenHeartbeat={onOpen} onNewHeartbeat={onNew}/>);
        const plus = within(heartbeats).getByRole('button', {name: 'New heartbeat'});
        // Light: dashed, after the heartbeats; a plus card, out of the rule of the buttons.
        expect(plus).toHaveClass('border-dashed');
        expect(plus.closest('li').previousElementSibling).toHaveAttribute('data-card', 'hb#2');
        fireEvent.click(plus);
        expect(onNew).toHaveBeenCalled();
    });

    test('no heartbeat, nothing', () => {
        const {container} = render(<HeartbeatSummary heartbeatStatus={{}}/>);
        expect(container).toBeEmptyDOMElement();
    });
});
