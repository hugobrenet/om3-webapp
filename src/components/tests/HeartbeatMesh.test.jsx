import React from 'react';
import {render, screen, fireEvent, within} from '@testing-library/react';
import {HeartbeatMesh} from '../HeartbeatMesh';

const STATUS = {
    dev3n1: {streams: [
        {id: 'hb#1.tx', type: 'unicast', state: 'running', peers: {dev3n2: {is_beating: true, desc: '→ dev3n2:10011', last_beating_at: '2026-10-16T10:00:00Z'}}},
        {id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {dev3n2: {is_beating: true, desc: ':10011 ← dev3n2'}}},
    ]},
    dev3n2: {streams: [
        {id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {dev3n1: {is_beating: false, desc: ':10011 ← dev3n1'}}},
        {id: 'hb#1.tx', type: 'unicast', state: 'running', peers: {dev3n1: {is_beating: true}}},
    ]},
};

const lines = (container) => [...container.querySelectorAll('[data-group]')];

/** The room under the mesh showing the details of what is hovered or kept. */
const details = () => screen.getByRole('region', {name: 'Streams'});
/** Nothing hovered nor kept: the room says how to fill it. */
const empty = () => details().dataset.details === '';

/** The cards of the details: the fields of each, by their names. */
const cardsOf = (box, fields) => [...box.querySelectorAll('[data-link], [data-stream]')].map((card) =>
    fields.map((field) => card.querySelector(`[data-field="${field}"]`)?.textContent ?? null));

describe('HeartbeatMesh', () => {
    test('a line each way between two nodes, no fan-out, no text: the color of its links', () => {
        const {container} = render(<HeartbeatMesh heartbeatStatus={STATUS}/>);
        expect(screen.getByRole('heading', {name: 'Mesh'})).toBeInTheDocument();
        // Always shown: no fold.
        expect(document.querySelector('details')).toBeNull();
        // A key to its lines; the ring no wider than its column.
        expect([...document.querySelectorAll('[data-legend-state]')].map((key) => key.textContent)).toEqual(['all beating', 'some beating', 'none beating']);
        // In the box of the drawing, under it, not under the box.
        const legend = document.querySelector('[data-legend]');
        expect(legend.parentElement).toHaveClass('border', 'border-line');
        expect(legend.previousElementSibling).toHaveClass('aspect-square');
        // A square as wide as its box, the drawing fitted to it.
        const svg = document.querySelector('svg[role="group"]');
        expect(svg).toHaveClass('h-full', 'w-full');
        expect(svg.parentElement).toHaveClass('aspect-square');
        expect(svg.getAttribute('width')).toBe(svg.getAttribute('height'));
        expect([...container.querySelectorAll('[data-node]')].map((n) => n.dataset.node)).toEqual(['dev3n1', 'dev3n2']);
        expect(lines(container).map((g) => [g.dataset.group, g.dataset.state, g.textContent])).toEqual([
            // One end beating, the other not: a mix, orange.
            ['dev3n1 dev3n2', 'warn', ''],
            // Both ends beating: green.
            ['dev3n2 dev3n1', 'up', ''],
        ]);
        // Each line in two halves: the tx of the sender, beating; the rx of the receiver, not.
        const halves = (g) => [...g.querySelectorAll('[data-half]')].map((h) => [h.dataset.half, h.dataset.state, h.getAttribute('class')]);
        expect(halves(lines(container)[0])).toEqual([['tx', 'up', 'stroke-state-up'], ['rx', 'down', 'stroke-state-down']]);
        expect(halves(lines(container)[1])).toEqual([['tx', 'up', 'stroke-state-up'], ['rx', 'up', 'stroke-state-up']]);
        expect(lines(container)[0]).toHaveAccessibleName('dev3n1 to dev3n2: 1 of 2 links beating');
    });

    test('a half hovered lists its own links in the details; the gap reacts to nothing', () => {
        const {container} = render(<HeartbeatMesh heartbeatStatus={STATUS}/>);
        const [forward] = lines(container);
        // A half: its side and node in the title, not on its cards; the cards by their heartbeat, type and description.
        const rowsOf = (card) => cardsOf(card, ['hb', 'type', 'desc']).map((fields) => fields.join(' '));
        fireEvent.mouseEnter(forward.querySelector('[data-hover="tx"]'));
        let card = details();
        // A half as its end sees it, in place of the arrow of the line.
        expect(card).toHaveTextContent('Seen from dev3n1, outgoing to dev3n2');
        expect(card.querySelector('[data-card-side]').parentElement).not.toHaveTextContent('→');
        expect(card).toHaveTextContent('1 of 1 beating');
        expect(rowsOf(card)).toEqual(['hb#1 unicast → dev3n2:10011']);
        expect(card.querySelector('[data-field="side"]')).toBeNull();
        // The description, cut short in a narrow card, whole in a popup hovered.
        expect(card.querySelector('[data-field="desc"]').parentElement).toHaveAttribute('title', 'unicast · → dev3n2:10011');
        expect(card.querySelector('table')).toBeNull();
        // That half drawn bolder, the other not.
        expect(forward.querySelector('[data-half="tx"]')).toHaveAttribute('stroke-width', '3.5');
        expect(forward.querySelector('[data-half="rx"]')).toHaveAttribute('stroke-width', '2');
        fireEvent.mouseLeave(forward.querySelector('[data-hover="tx"]'));
        fireEvent.mouseEnter(forward.querySelector('[data-hover="rx"]'));
        card = details();
        expect(card).toHaveTextContent('Seen from dev3n2, incoming from dev3n1');
        expect(card).toHaveTextContent('0 of 1 beating');
        expect(rowsOf(card)).toEqual(['hb#1 unicast :10011 ← dev3n1']);
        fireEvent.mouseLeave(forward.querySelector('[data-hover="rx"]'));
        expect(empty()).toBe(true);
        expect(details()).toHaveTextContent(/Hover an arrow or a node/);
        // Only the halves are hover targets: none over the whole line, the gap included.
        expect([...forward.querySelectorAll('[data-hover]')].map((h) => h.dataset.hover)).toEqual(['tx', 'rx']);
    });

    test('a half clicked keeps its details until another is clicked or the ground of the mesh is', () => {
        const onSelect = vi.fn();
        const {container, rerender} = render(<HeartbeatMesh heartbeatStatus={STATUS} onSelect={onSelect} selected={null}/>);
        const [forward, backward] = lines(container);
        const tx = forward.querySelector('[data-hover="tx"]');
        fireEvent.mouseEnter(tx);
        // The press does not move the focus to the line, whose details would replace the half's.
        expect(fireEvent.mouseDown(tx)).toBe(false);
        fireEvent.click(tx);
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({key: 'dev3n1 dev3n2'}));
        rerender(<HeartbeatMesh heartbeatStatus={STATUS} onSelect={onSelect} selected="dev3n1 dev3n2"/>);
        // Left, the details stay, the half bold; another hovered, its own a while.
        fireEvent.mouseLeave(tx);
        expect(details()).toHaveTextContent('Seen from dev3n1, outgoing to dev3n2');
        expect(forward).toHaveAttribute('data-pinned', 'true');
        expect(forward.querySelector('[data-half="tx"]')).toHaveAttribute('stroke-width', '3.5');
        expect(forward.querySelector('[data-half="rx"]')).toHaveAttribute('stroke-width', '2');
        fireEvent.mouseEnter(backward.querySelector('[data-hover="rx"]'));
        expect(details()).toHaveTextContent('Seen from dev3n1, incoming from dev3n2');
        fireEvent.mouseLeave(backward.querySelector('[data-hover="rx"]'));
        expect(details()).toHaveTextContent('Seen from dev3n1, outgoing to dev3n2');
        // Another clicked: its details kept in place.
        fireEvent.click(backward.querySelector('[data-hover="rx"]'));
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({key: 'dev3n2 dev3n1'}));
        rerender(<HeartbeatMesh heartbeatStatus={STATUS} onSelect={onSelect} selected="dev3n2 dev3n1"/>);
        expect(details()).toHaveTextContent('Seen from dev3n1, incoming from dev3n2');
        expect(forward).not.toHaveAttribute('data-pinned');
        // The ground of the mesh clicked: none kept.
        fireEvent.click(container.querySelector('svg[role="group"]'));
        expect(onSelect).toHaveBeenLastCalledWith(null);
        expect(empty()).toBe(true);
        // The line the page shows dropped elsewhere, a chip removed: its details go too.
        rerender(<HeartbeatMesh heartbeatStatus={STATUS} onSelect={onSelect} selected="dev3n1 dev3n2"/>);
        expect(details()).toHaveTextContent('dev3n1 → dev3n2');
        rerender(<HeartbeatMesh heartbeatStatus={STATUS} onSelect={onSelect} selected={null}/>);
        expect(empty()).toBe(true);
    });

    test('a line focused lists all its links in the details, each with all of its data', () => {
        const {container} = render(<HeartbeatMesh heartbeatStatus={STATUS}/>);
        const [forward, backward] = lines(container);
        fireEvent.focus(forward);
        const card = details();
        expect(card).toHaveTextContent('dev3n1 → dev3n2');
        expect(card).toHaveTextContent('1 of 2 beating');
        const rows = cardsOf(card, ['hb', 'side', 'type', 'desc', 'status', 'beat']);
        // Relative to now, as the fixture ages: "… ago", "yesterday", "last week"…
        const relative = expect.stringMatching(/ago|in |yesterday|last /);
        expect(rows).toEqual([
            ['hb#1', 'tx · dev3n1', 'unicast', '→ dev3n2:10011', 'Beating', relative],
            ['hb#1', 'rx · dev3n2', 'unicast', ':10011 ← dev3n1', 'Stale', '–'],
        ]);
        fireEvent.blur(forward);
        expect(empty()).toBe(true);
        fireEvent.focus(backward);
        expect(details()).toHaveTextContent('dev3n2 → dev3n1');
    });

    test('the details in a box of their own, cards wrapping in it, nothing to scroll, no card over the page', () => {
        const {container} = render(<HeartbeatMesh heartbeatStatus={STATUS}/>);
        const room = details();
        // A box of their own, apart from the mesh's, as high as its cards make it, nothing to scroll.
        expect(screen.getByRole('region', {name: 'Mesh'}).contains(room)).toBe(false);
        expect(room.querySelector('h2')).toHaveTextContent('Streams');
        const box = room.querySelector('h2').nextElementSibling;
        expect(box.className).not.toMatch(/overflow-|h-44|min-h/);
        expect(box.style.minHeight).toBe('');
        fireEvent.focus(lines(container)[0]);
        expect(box.querySelector('ul')).toHaveClass('grid', 'grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]');
        expect(box.querySelectorAll('li[data-link]')).toHaveLength(2);
        // Alike the cards of the heartbeats and the routines: ground, border, corners.
        expect(box.querySelector('li[data-link]')).toHaveClass('rounded-(--radius-control)', 'border', 'border-transparent', 'bg-surface-sunken');
        fireEvent.blur(lines(container)[0]);
        fireEvent.mouseEnter(lines(container)[0].querySelector('[data-hover="tx"]'));
        expect(details()).toBe(room);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    test('a line none of whose links beat is red', () => {
        const status = {
            a: {streams: [{id: 'hb#1.tx', type: 'unicast', state: 'stopped', peers: {b: {is_beating: true}}}]},
            b: {streams: [{id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {a: {is_beating: false}}}]},
        };
        const {container} = render(<HeartbeatMesh heartbeatStatus={status}/>);
        expect(lines(container).map((g) => g.dataset.state)).toEqual(['down']);
    });

    test('a half whose end reports no link: grey and dashed', () => {
        const status = {
            a: {streams: [{id: 'hb#1.tx', type: 'unicast', state: 'running', peers: {b: {is_beating: true}}}]},
            b: {streams: []},
        };
        const {container} = render(<HeartbeatMesh heartbeatStatus={status}/>);
        const rx = lines(container)[0].querySelector('[data-half="rx"]');
        expect(rx).toHaveAttribute('data-state', 'none');
        expect(rx).toHaveClass('stroke-line');
        expect(rx).toHaveAttribute('stroke-dasharray', '4 3');
    });

    test('a node orange when some of its routines are stopped, red when all are; hovered, the details say which', () => {
        const status = {
            a: {streams: [
                {id: 'hb#1.tx', type: 'unicast', state: 'stopped', peers: {b: {is_beating: false}}},
                {id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {b: {is_beating: true}}},
            ]},
            b: {streams: [
                {id: 'hb#1.tx', type: 'unicast', state: 'stopped', peers: {a: {is_beating: false}}},
                {id: 'hb#1.rx', type: 'unicast', state: 'failed', peers: {a: {is_beating: false}}},
            ]},
            c: {streams: [{id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {a: {is_beating: true}}}]},
        };
        const {container} = render(<HeartbeatMesh heartbeatStatus={status}/>);
        const node = (name) => container.querySelector(`[data-node="${name}"]`);
        expect(['a', 'b', 'c'].map((name) => node(name).dataset.state)).toEqual(['warn', 'down', 'up']);
        expect(node('a').querySelector('rect')).toHaveClass('stroke-state-warn');
        expect(node('b').querySelector('rect')).toHaveClass('stroke-state-down');
        expect(node('c').querySelector('rect')).toHaveClass('stroke-line');
        fireEvent.mouseEnter(node('b'));
        const card = details();
        expect(card).toHaveTextContent('b2 of 2 routines stopped');
        expect(cardsOf(card, ['id', 'type', 'state'])).toEqual([['hb#1.tx', 'unicast', 'stopped'], ['hb#1.rx', 'unicast', 'failed']]);
        fireEvent.mouseLeave(node('b'));
        expect(empty()).toBe(true);
        fireEvent.mouseEnter(node('a'));
        expect([...details().querySelectorAll('[data-stream]')].map((r) => r.dataset.stream)).toEqual(['hb#1.tx']);
        fireEvent.mouseLeave(node('a'));
        // All running: its name in a tooltip, no details.
        expect(node('c').querySelector('title')).toHaveTextContent(/^c$/);
        fireEvent.mouseEnter(node('c'));
        expect(empty()).toBe(true);
    });

    test('a half titled as its end sees it, in French too', async () => {
        const {default: i18n} = await import('../../i18n');
        await i18n.changeLanguage('fr');
        try {
            const {container} = render(<HeartbeatMesh heartbeatStatus={STATUS}/>);
            fireEvent.mouseEnter(lines(container)[1].querySelector('[data-hover="rx"]'));
            const flux = () => screen.getByRole('region', {name: 'Flux'});
            expect(flux()).toHaveTextContent('Vu de dev3n1, entrant de dev3n2');
            fireEvent.mouseLeave(lines(container)[1].querySelector('[data-hover="rx"]'));
            fireEvent.mouseEnter(lines(container)[1].querySelector('[data-hover="tx"]'));
            expect(flux()).toHaveTextContent('Vu de dev3n2, sortant vers dev3n1');
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    test('nothing hovered nor kept: all the streams in a ring, in the colours of the gauges, optimal when all beat', () => {
        const all = {
            a: {streams: [{id: 'hb#1.tx', type: 'unicast', state: 'running', peers: {b: {is_beating: true}}}]},
            b: {streams: [{id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {a: {is_beating: true}}}]},
        };
        const {rerender} = render(<HeartbeatMesh heartbeatStatus={all}/>);
        const overall = () => details().querySelector('[data-overall]');
        const arcs = () => [...overall().querySelectorAll('[data-arc]')].map((arc) => [
            arc.dataset.arc, arc.getAttribute('class'), Math.round(parseFloat(arc.getAttribute('stroke-dasharray'))), Math.round(0 - arc.getAttribute('stroke-dashoffset')),
        ]);
        const round = Math.round(2 * Math.PI * 52);
        expect(overall()).toHaveTextContent('2/2streams operationaloptimal');
        expect(overall().querySelector('.font-semibold.text-state-up')).toHaveTextContent('optimal');
        // On the grey of the cards, a single arc all round, in the colour of the beating dots.
        expect(overall().querySelector('circle')).toHaveClass('stroke-surface-sunken');
        expect(arcs()).toEqual([['up', 'stroke-state-up', round, 0]]);
        // Some beating, some failing, a stream stopped: their arcs one after the other, in that order.
        rerender(<HeartbeatMesh heartbeatStatus={{
            a: {streams: [
                {id: 'hb#1.tx', type: 'unicast', state: 'running', peers: {b: {is_beating: true}}},
                {id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {b: {is_beating: false}}},
            ]},
            b: {streams: [
                {id: 'hb#1.tx', type: 'unicast', state: 'stopped', peers: {a: {is_beating: false}}},
                {id: 'hb#1.rx', type: 'unicast', state: 'running', peers: {a: {is_beating: true}}},
            ]},
        }}/>);
        expect(overall()).toHaveAttribute('data-overall', 'warn');
        expect(overall()).toHaveTextContent('2/4streams operationaldegraded');
        const quarter = 2 * Math.PI * 52 / 4;
        expect(arcs()).toEqual([
            ['up', 'stroke-state-up', Math.round(2 * quarter), 0],
            ['down', 'stroke-state-down', Math.round(quarter), Math.round(2 * quarter)],
            ['stopped', 'stroke-line', Math.round(quarter), Math.round(3 * quarter)],
        ]);
        expect(details()).toHaveTextContent(/Hover an arrow or a node/);
        // Something hovered: its streams in place of the ring.
        fireEvent.focus(lines(document.body)[0]);
        expect(overall()).toBeNull();
    });

    test('no heartbeat reported: no mesh', () => {
        const {container} = render(<HeartbeatMesh heartbeatStatus={{}}/>);
        expect(container).toBeEmptyDOMElement();
    });
});
