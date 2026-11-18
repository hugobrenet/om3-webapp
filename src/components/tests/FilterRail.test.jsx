import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, test, vi} from 'vitest';
import {FilterToolbar} from '../FilterRail';

// A phone: the filters folded under their button.
vi.mock('../../ui/lib/media', async (importOriginal) => ({
    ...(await importOriginal()),
    useMediaQuery: vi.fn((query) => query.includes('max-width')),
}));

const facet = (selected) => ({
    label: 'Status', options: [{value: 'up', text: 'up'}, {value: 'down', text: 'down'}],
    selected, onToggle: vi.fn(), onClear: vi.fn(),
});

describe('FilterToolbar, folded', () => {
    test('nothing filtered: its button says nothing more', () => {
        render(<FilterToolbar facets={[facet([])]} search="" onSearch={vi.fn()} searchLabel="Name"/>);
        const button = screen.getByRole('button', {name: 'Show filters'});
        expect(button).toHaveAttribute('aria-expanded', 'false');
        expect(button).not.toHaveClass('border-accent');
    });

    test('folded while filtering, its button says how many filters are on, in the accent', () => {
        render(
            <FilterToolbar facets={[facet(['down']), facet([])]} search=" web " onSearch={vi.fn()} searchLabel="Name" active={1}>
                <input type="checkbox" aria-label="Problems only" defaultChecked/>
            </FilterToolbar>
        );
        // A facet chosen, the words searched, the checkbox of the list: three.
        const button = screen.getByRole('button', {name: 'Show filters · 3 on'});
        expect(button).toHaveClass('border-accent', 'bg-accent-soft');
        expect(button).toHaveTextContent('3');
        fireEvent.click(button);
        expect(screen.getByRole('button', {name: 'Hide filters · 3 on'})).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('checkbox', {name: 'Problems only'})).toBeInTheDocument();
    });
});
