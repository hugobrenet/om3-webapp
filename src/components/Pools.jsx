import React, {useEffect, useState, useMemo} from "react";
import axios from "axios";
import {useTranslation} from "react-i18next";
import {URL_POOL} from "../config/apiPath.js";
import logger from '../utils/logger.js';
import {Table, HeaderRow, SortHeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Spinner} from "../ui/components/Spinner";
import {UsageBar} from "../ui/components/UsageBar";

/**
 * @typedef {Object} Pool
 * @property {string} [name]
 * @property {string} [type]
 * @property {number} [volume_count]
 * @property {number} [size]
 * @property {number} [used]
 * @property {string} [head]
 */

const COLUMNS = [
    {key: "name", labelKey: "common.name"},
    {key: "type", labelKey: "common.type"},
    {key: "volume_count", labelKey: "pools.columns.volumeCount"},
    {key: "usage", labelKey: "pools.columns.usage"},
    {key: "head", labelKey: "pools.columns.head"},
];

/** The usage percentage, a small bar beside it: the row keeps one line. */
const Usage = ({pool}) => {
    const {t} = useTranslation();
    return (
        <UsageBar
            value={pool.size && pool.used >= 0 ? (pool.used / pool.size) * 100 : undefined}
            missing={t("common.notAvailable")}
            title={`${pool.used}/${pool.size}`}
            label={t("pools.usageOf", {name: pool.name || t("common.notAvailable")})}
        />
    );
};

const Pools = () => {
    const {t} = useTranslation();
    /** @type {[Pool[], function]} */
    const [pools, setPools] = useState([]);
    const [loading, setLoading] = useState(true);
    /** @type {[boolean, function]} Whether the pools failed to load. */
    const [error, setError] = useState(false);
    const [sortColumn, setSortColumn] = useState("name");
    const [sortDirection, setSortDirection] = useState("asc");

    useEffect(() => {
        let isMounted = true;

        const fetchPools = async () => {
            try {
                setLoading(true);
                setError(false);
                const token = localStorage.getItem("authToken");
                const res = await axios.get(URL_POOL, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });

                const items = Array.isArray(res.data.items) ? res.data.items : [];
                if (isMounted) {
                    setPools(items);
                    setLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setPools([]);
                    setError(true);
                    setLoading(false);
                }
                logger.error("Error retrieving pools", err);
            }
        };

        void fetchPools();
        return () => {
            isMounted = false;
        };
    }, []);

    // Memoize sorted pools to optimize performance
    /** @type {Pool[]} */
    const sortedPools = useMemo(() => {
        return [...pools].sort((a, b) => {
            let diff = 0;
            if (sortColumn === "name") {
                diff = (a.name || '').localeCompare(b.name || '');
            } else if (sortColumn === "type") {
                diff = (a.type || '').localeCompare(b.type || '');
            } else if (sortColumn === "volume_count") {
                diff = (a.volume_count ?? 0) - (b.volume_count ?? 0);
            } else if (sortColumn === "usage") {
                const usedPercentageA = a.size && a.used >= 0 ? (a.used / a.size) * 100 : 0;
                const usedPercentageB = b.size && b.used >= 0 ? (b.used / b.size) * 100 : 0;
                diff = usedPercentageA - usedPercentageB;
            } else if (sortColumn === "head") {
                diff = (a.head || '').localeCompare(b.head || '');
            }
            return sortDirection === "asc" ? diff : -diff;
        });
    }, [pools, sortColumn, sortDirection]);

    const handleRetry = () => {
        setLoading(true);
        setError(false);
        setPools([]);
        const fetchPools = async () => {
            try {
                const token = localStorage.getItem("authToken");
                const res = await axios.get(URL_POOL, {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });
                const items = Array.isArray(res.data.items) ? res.data.items : [];
                setPools(items);
                setLoading(false);
            } catch (err) {
                setPools([]);
                setError(true);
                setLoading(false);
                logger.error("Error retrieving pools", err);
            }
        };
        void fetchPools();
    };

    const handleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortColumn(column);
            setSortDirection("asc");
        }
    };

    const notAvailable = t("common.notAvailable");

    return (
        <div className="p-4 space-y-3">
            {loading ? (
                <div className="flex justify-center py-8">
                    <Spinner label={t("pools.loading")}/>
                </div>
            ) : error ? (
                <Alert
                    action={
                        <Button size="sm" onClick={handleRetry}>
                            {t("common.retry")}
                        </Button>
                    }
                >
                    {t("pools.loadError")}
                </Alert>
            ) : (
                <Table sticky>
                    <caption className="sr-only">{t("pools.caption")}</caption>
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
                        {sortedPools.length === 0 ? (
                            <EmptyRow colSpan={COLUMNS.length}>{t("pools.empty")}</EmptyRow>
                        ) : (
                            sortedPools.map((pool) => (
                                <Row key={pool.name || Math.random()}>
                                    <Cell className="font-medium">{pool.name || notAvailable}</Cell>
                                    <Cell>{pool.type || notAvailable}</Cell>
                                    <Cell numeric>{pool.volume_count ?? notAvailable}</Cell>
                                    <Cell numeric><Usage pool={pool}/></Cell>
                                    <Cell>{pool.head || notAvailable}</Cell>
                                </Row>
                            ))
                        )}
                    </tbody>
                </Table>
            )}
        </div>
    );
};

export default Pools;
