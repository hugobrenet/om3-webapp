import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {StateRing, labelLines} from '../StateRing';

const PARTS = [
    ['up', 3, 'stroke-state-up', {word: 'up'}],
    ['down', 1, 'stroke-state-down', {word: 'down'}],
];

/** The ring drawn in a box `width` pixels wide, its observer told at once. */
const drawn = (width) => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({width});
    const {container} = render(<MemoryRouter><StateRing parts={PARTS}/></MemoryRouter>);
    return parseFloat(container.querySelector('[data-ring-labels]').style.fontSize);
};

describe('StateRing labels', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test('drawn wide, at their size in the drawing', () => {
        // 368px for a drawing 248 wide: 8 read at about 12px.
        expect(drawn(368)).toBe(8);
    });

    test('shrunk to a phone, larger in the drawing: read at 11.5px at the least', () => {
        const size = drawn(256);
        expect(size).toBeGreaterThan(8);
        expect(size * (256 / 248)).toBeCloseTo(11.5, 1);
    });

    test('no ResizeObserver: their size in the drawing', () => {
        vi.stubGlobal('ResizeObserver', undefined);
        const {container} = render(<MemoryRouter><StateRing parts={PARTS}/></MemoryRouter>);
        expect(container.querySelector('[data-ring-labels]').style.fontSize).toBe('8px');
    });
});

describe('StateRing links', () => {
    test('tapped elsewhere than a link of its own, the ring lets it through to the link under it', () => {
        const {container} = render(<MemoryRouter><StateRing parts={PARTS}/></MemoryRouter>);
        expect(container.firstElementChild).toHaveClass('pointer-events-none');
        // No page to its parts: no link in it.
        expect(container.querySelector('a')).toBeNull();
    });

    test('an arc of a page, its link as its label, for the pointer alone: the label the way of the keyboard', () => {
        const parts = [
            ['up', 3, 'stroke-state-up', {word: 'up', to: '/objects?globalState=up', title: 'Filtered: up'}],
            ['down', 1, 'stroke-state-down', {word: 'down'}],
        ];
        const {container} = render(<MemoryRouter><StateRing parts={parts}/></MemoryRouter>);
        const arc = container.querySelector('[data-arc-link="up"]').closest('a');
        expect(arc).toHaveAttribute('href', '/objects?globalState=up');
        expect(arc).toHaveAttribute('tabindex', '-1');
        expect(arc).not.toHaveAttribute('aria-label');
        expect(arc).toHaveClass('pointer-events-auto');
        expect(screen.getByRole('link', {name: 'Filtered: up'})).toHaveAttribute('href', '/objects?globalState=up');
        // An arc of no page, none.
        expect(container.querySelector('[data-arc="down"]').closest('a')).toBeNull();
    });

    test('an arc of a page pointed at, by itself or its label: thicker, its label underlined; left, as before', () => {
        const parts = [
            ['up', 3, 'stroke-state-up', {word: 'up', to: '/objects?globalState=up', title: 'Filtered: up'}],
            ['down', 1, 'stroke-state-down', {word: 'down', to: '/objects?globalState=down', title: 'Filtered: down'}],
        ];
        const {container} = render(<MemoryRouter><StateRing parts={parts}/></MemoryRouter>);
        const arc = (part) => container.querySelector(`[data-arc="${part}"]`);
        const text = (part) => container.querySelector(`[data-label="${part}"] text`);
        // On a card pointed at, the whole ring a little thicker.
        expect(arc('up')).toHaveClass('[[data-card]:hover_&]:[stroke-width:10]');
        fireEvent.mouseEnter(arc('down').closest('a'));
        expect(arc('down')).toHaveStyle({strokeWidth: '13'});
        expect(text('down')).toHaveClass('underline');
        expect(arc('up').style.strokeWidth).toBe('');
        fireEvent.mouseLeave(arc('down').closest('a'));
        expect(arc('down').style.strokeWidth).toBe('');
        expect(text('down')).not.toHaveClass('underline');
        // Its label pointed at, or focused from the keyboard: its arc so too.
        fireEvent.focus(screen.getByRole('link', {name: 'Filtered: up'}));
        expect(arc('up')).toHaveStyle({strokeWidth: '13'});
    });
});

describe('StateRing long labels', () => {
    test('one line when it fits on its side of the ring; else its words wrapped, the count on the second line', () => {
        expect(labelLines('down', 75, 8)).toEqual(['down']);
        // After its comma when both halves fit; else as many words as fit first.
        expect(labelLines('down, no issue', 92, 8)).toEqual(['down,', 'no issue']);
        expect(labelLines('down, sans problème', 92, 8)).toEqual(['down, sans', 'problème']);
        // A single word too long is left whole: nothing to wrap it at.
        expect(labelLines('unprovisioned', 3, 8, 20)).toEqual(['unprovisioned']);
    });

    test('a long label drawn on two lines, read whole, the labels under it moved down', () => {
        const parts = [
            ['down', 1, 'stroke-state-down', {word: 'down'}],
            ['quiet', 1, 'stroke-line-strong', {word: 'down, sans problème'}],
            ['warn', 1, 'stroke-state-warn', {word: 'warn'}],
            ['ok', 3, 'stroke-state-up', {word: 'ok'}],
        ];
        const {container} = render(<MemoryRouter><StateRing parts={parts}/></MemoryRouter>);
        const text = (part) => container.querySelector(`[data-label="${part}"] text`);
        const lines = [...text('quiet').children];
        expect(lines.map((line) => line.textContent)).toEqual(['down, sans', ' problème 1']);
        expect(lines[1]).toHaveAttribute('dy', '9');
        expect(text('quiet').textContent).toBe('down, sans problème 1');
        // On the right of the ring both, the one under it a line further down than one line needs.
        const lineY = (part) => Number(container.querySelector(`[data-label="${part}"] polyline`).getAttribute('points').split(' ').at(-1).split(',')[1]);
        expect(lineY('warn') - lineY('quiet')).toBeGreaterThanOrEqual(11 + 9);
    });
});
