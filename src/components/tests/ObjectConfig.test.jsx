import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {vi} from 'vitest';
import ObjectConfig from '../ObjectConfig';
import useEventStore from '../../hooks/useEventStore.js';

// The configuration itself is tested on its own: here, what it is given.
vi.mock('../ConfigSection', () => ({
    default: ({decodedObjectName, configNode, inline, configRefreshTrigger, openSnackbar}) => (
        <div data-testid="config" data-inline={String(inline)}>
            {`${decodedObjectName} from ${configNode}, read ${configRefreshTrigger}`}
            <button onClick={() => openSnackbar('Configuration updated')}>save</button>
        </div>
    ),
}));

describe('ObjectConfig', () => {
    beforeEach(() => {
        act(() => useEventStore.setState({
            objectInstanceStatus: {'ns1/svc/web': {node2: {}, node1: {}}},
            instanceConfig: {'ns1/svc/web': {node1: {}}},
        }));
    });

    test('shows the configuration in place, read from a node having an instance', async () => {
        render(<ObjectConfig path="ns1/svc/web"/>);
        expect(screen.getByTestId('config')).toHaveAttribute('data-inline', 'true');
        await waitFor(() => expect(screen.getByTestId('config')).toHaveTextContent('ns1/svc/web from node1, read 0'));
    });

    test('reads it again when an event says it changed', async () => {
        render(<ObjectConfig path="ns1/svc/web"/>);
        await waitFor(() => expect(screen.getByTestId('config')).toHaveTextContent('from node1'));
        act(() => useEventStore.setState({instanceConfig: {'ns1/svc/web': {node1: {csum: 'x'}}}}));
        await waitFor(() => expect(screen.getByTestId('config')).toHaveTextContent('read 1'));
    });

    test('says what came of a change, in the strip of the other views', async () => {
        render(<ObjectConfig path="ns1/svc/web"/>);
        fireEvent.click(screen.getByRole('button', {name: 'save'}));
        expect(screen.getByText('Configuration updated')).toBeInTheDocument();
    });
});
