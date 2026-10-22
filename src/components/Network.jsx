import React, {useEffect, useState, useRef, useMemo} from "react";
import axios from "axios";
import {useTranslation} from "react-i18next";
import {URL_NETWORK} from "../config/apiPath.js";
import logger from '../utils/logger.js';
import {Table, HeaderRow, SortHeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {UsageBar} from "../ui/components/UsageBar";
import {usePanelSearch} from "../app/panel-search";
import {NetworkDetailPanel} from "./RecordPanels";

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
            title={`${network.used}/${network.size}`}
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
    const {sel, select} = usePanelSearch();
    const containerRef = useRef(null);

    // Scroll to top on component mount
    useEffect(() => {
        window.scrollTo(0, 0);
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
    }, []);

    useEffect(() => {
        const fetchNetworks = async () => {
            try {
                const token = localStorage.getItem("authToken");
                const res = await axios.get(URL_NETWORK, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });
                setNetworks(res.data.items || []);
            } catch (err) {
                logger.error("Error retrieving networks", err);
            }
        };

        void fetchNetworks();
    }, []);

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

            <NetworkDetailPanel name={sel} onClose={() => select(undefined)}/>
        </div>
    );
};

export default Network;
