import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {vi} from 'vitest';
import '../../i18n';
import {NodeActionDialog} from '../NodeActionDialog';
import {nodeActionRequest} from '../../app/node-actions';

describe('NodeActionDialog', () => {
    test('a safe action: what it does, confirmed at once', () => {
        const onConfirm = vi.fn();
        render(<NodeActionDialog pending={{action: 'restart daemon'}} target="node n1" onConfirm={onConfirm} onClose={() => {}}/>);
        const dialog = screen.getByRole('dialog', {name: 'Restart: node n1'});
        expect(dialog).toHaveTextContent('Restart the daemon; the instances keep running.');
        expect(screen.queryByRole('checkbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Restart'}));
        expect(onConfirm).toHaveBeenCalledWith('restart daemon');
    });

    test.each([
        ['shutdown', 'Shutdown', 'All the instances hosted on the node shut down. Starting the daemon again needs a console access to the node.'],
        ['stop', 'Stop', 'Starting the daemon again needs a console access to the node.'],
        ['drain', 'Drain', 'All the instances hosted on the node shut down.'],
        ['leave', 'Leave', 'All the instances hosted on the node shut down and are deleted from it'],
    ])('a harmful action, %s: what it costs in a warning, understood before it may go', (action, label, warning) => {
        const onConfirm = vi.fn();
        render(<NodeActionDialog pending={{action}} target="node n1" onConfirm={onConfirm} onClose={() => {}}/>);
        expect(screen.getByRole('dialog')).toHaveTextContent(warning);
        const go = screen.getByRole('button', {name: label});
        expect(go).toBeDisabled();
        fireEvent.click(screen.getByRole('checkbox', {name: 'I understand'}));
        expect(go).toBeEnabled();
        fireEvent.click(go);
        expect(onConfirm).toHaveBeenCalledWith(action);
    });

    test('nothing pending: nothing', () => {
        const {container} = render(<NodeActionDialog pending={null} target="" onConfirm={() => {}} onClose={() => {}}/>);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('nodeActionRequest', () => {
    test('an action of the node posted to it; leave to the cluster, which evicts it', () => {
        expect(nodeActionRequest('n1', 'freeze')).toEqual({url: '/api/node/name/n1/action/freeze'});
        expect(nodeActionRequest('n1', 'restart daemon')).toEqual({url: '/api/node/name/n1/daemon/action/restart'});
        expect(nodeActionRequest('n1', 'leave')).toEqual({url: '/api/cluster/evict', body: JSON.stringify({node: 'n1'})});
    });
});
