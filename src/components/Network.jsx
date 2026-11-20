import React, {useCallback, useEffect, useState, useRef, useMemo} from "react";
import axios from "axios";
import {useTranslation} from "react-i18next";
import {URL_NETWORK} from "../config/apiPath.js";
import logger from '../utils/logger.js';
import {Table, HeaderRow, SortHeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {UsageBar} from "../ui/components/UsageBar";
import {usePanelSearch} from "../app/panel-search";
import {NetworkDetailPanel} from "./RecordPanels";
import {NetworkWizard} from "./NetworkWizard";
import {useNetworkChanges} from "./NetworkPanel";
import {Button} from "../ui/components/Button";
import {PlusIcon} from "../ui/icons";
import {useGrants} from "../hooks/useGrants";
import {useClusterNodes} from "../hooks/usePgUsage";
import {useSettle} from "../hooks/useSettle";

const COLUMNS = [
    {key: "name", labelKey: "common.name"},
    {key: "type", labelKey: "common.type"},
    {key: "network", labelKey: "networks.columns.network"},
    {key: "usage", labelKey: "networks.columns.usage"},
];

/** The usage percentage, a small bar beside it: the row keeps one line. */
const Usage = ({network}) => {
    const {t} = useTranslation();
    return (
        <UsageBar
            value={network.size ? (network.used / network.size) * 100 : undefined}
            missing={t("common.notAvailable")}
            label={t("networks.usageOf", {name: network.name})}
        />
    );
};

const Network = () => {
    const {t} = useTranslation();
    const [networks, setNetworks] = useState([]);
    const [sortColumn, setSortColumn] = useState("name");
    const [sortDirection, setSortDirection] = useState("asc");
    // The network whose panel is open, in the URL.
    const {sel, select, tab, setTab} = usePanelSearch();
    const containerRef = useRef(null);
    // Root writes the cluster configuration: a network added from a wizard.
    const isRoot = Object.prototype.hasOwnProperty.call(useGrants(), "root");
    const nodes = useClusterNodes();
    const [adding, setAdding] = useState(false);

    // Scroll to top on component mount
    useEffect(() => {
        window.scrollTo(0, 0);
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
    }, []);

    /** The networks read, set and answered; none on an error, logged. */
    const fetchNetworks = useCallback(async () => {
        try {
            const token = localStorage.getItem("authToken");
            const res = await axios.get(URL_NETWORK, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            const items = res.data.items || [];
            setNetworks(items);
            return items;
        } catch (err) {
            logger.error("Error retrieving networks", err);
            return [];
        }
    }, []);

    // Read at first, then again as the networks or the cluster configuration change.
    const changes = useNetworkChanges();
    useEffect(() => {
        void fetchNetworks();
    }, [fetchNetworks, changes]);

    // The list read until the network is there, or gone: no more once the page is left.
    const settle = useSettle();

    /** A network deleted: its panel closed, the list read until it no longer has it. */
    const deleted = async (name) => {
        select(undefined);
        await settle(fetchNetworks, (items) => !items.some((n) => n.name === name));
    };

    /** A network written: the list read until it has it, then its panel opened. */
    const added = async (name) => {
        setAdding(false);
        if (await settle(fetchNetworks, (items) => items.some((n) => n.name === name))) select(name);
    };

    const sortedNetworks = useMemo(() => {
        return [...networks].sort((a, b) => {
            let diff = 0;
            if (sortColumn === "name") {
                diff = a.name.localeCompare(b.name);
            } else if (sortColumn === "type") {
                diff = a.type.localeCompare(b.type);
            } else if (sortColumn === "network") {
                diff = a.network.localeCompare(b.network);
            } else if (sortColumn === "usage") {
                const usedPercentageA = a.size ? (a.used / a.size) * 100 : 0;
                const usedPercentageB = b.size ? (b.used / b.size) * 100 : 0;
                diff = usedPercentageA - usedPercentageB;
            }
            return sortDirection === "asc" ? diff : -diff;
        });
    }, [networks, sortColumn, sortDirection]);

    const handleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortColumn(column);
            setSortDirection("asc");
        }
    };

    return (
        <div ref={containerRef} className="p-4 space-y-3">
            {isRoot && (
                <div className="flex justify-end">
                    <Button size="sm" variant="create" icon={<PlusIcon className="h-4 w-4"/>} onClick={() => setAdding(true)}>
                        {t("networks.add")}
                    </Button>
                </div>
            )}
            <Table sticky>
                <caption className="sr-only">{t("networks.caption")}</caption>
                <thead>
                    <HeaderRow>
                        {COLUMNS.map(({key, labelKey}) => (
                            <SortHeaderCell
                                key={key}
                                label={t(labelKey)}
                                active={sortColumn === key}
                                direction={sortDirection}
                                onSort={() => handleSort(key)}
                            />
                        ))}
                    </HeaderRow>
                </thead>
                <tbody>
                    {sortedNetworks.map((network) => (
                        <Row
                            key={network.name}
                            onActivate={() => select(network.name)}
                            selected={sel === network.name}
                        >
                            <Cell className="font-medium">{network.name}</Cell>
                            <Cell>{network.type}</Cell>
                            <Cell>{network.network}</Cell>
                            <Cell numeric><Usage network={network}/></Cell>
                        </Row>
                    ))}
                    {sortedNetworks.length === 0 && (
                        <EmptyRow colSpan={COLUMNS.length}>{t("networks.empty")}</EmptyRow>
                    )}
                </tbody>
            </Table>

            <NetworkDetailPanel name={sel} tab={tab} onTabChange={setTab} onClose={() => select(undefined)} onDeleted={deleted}/>
            {adding && <NetworkWizard networks={networks} nodes={nodes} onClose={() => setAdding(false)} onSaved={added}/>}
        </div>
    );
};

export default Network;
