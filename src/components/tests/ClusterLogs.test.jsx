import React from "react";
import {render, screen} from "@testing-library/react";
import {describe, expect, test, vi} from "vitest";
import "../../i18n";

const shown = vi.hoisted(() => ({props: null}));
vi.mock("../LogsViewer", () => ({
    default: (props) => {
        shown.props = props;
        return <div data-testid="logs"/>;
    },
}));

import {ClusterLogs} from "../ObjectLogs";

describe("ClusterLogs", () => {
    test("the logs of the daemon of every node of the cluster, in its order, as om cluster logs", () => {
        render(<ClusterLogs nodes={["dev2n1", "dev2n2", "dev2n3"]}/>);
        expect(screen.getByTestId("logs")).toBeInTheDocument();
        expect(shown.props).toMatchObject({type: "node", nodenames: ["dev2n1", "dev2n2", "dev2n3"]});
        expect(shown.props.instanceName).toBeUndefined();
    });

    test("the nodes not known yet, nothing read; none, said so", () => {
        shown.props = null;
        const {container, rerender} = render(<ClusterLogs nodes={null}/>);
        expect(container).toBeEmptyDOMElement();
        expect(shown.props).toBeNull();
        rerender(<ClusterLogs nodes={[]}/>);
        expect(screen.queryByTestId("logs")).toBeNull();
    });
});
