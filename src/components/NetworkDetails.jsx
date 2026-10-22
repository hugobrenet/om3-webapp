import React, {useEffect, useState, useMemo, useRef} from "react";
import {useParams} from "react-router-dom";
import axios from "axios";
import {useTranslation} from "react-i18next";
import debounce from "lodash.debounce";
import {URL_NETWORK_IP} from "../config/apiPath.js";
import logger from '../utils/logger.js';
import {Table, HeaderRow, HeaderCell, Row, Cell, EmptyRow} from "../ui/components/Table";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Input} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {ChevronDownIcon} from "../ui/icons";
import {CrossLink} from "../app/CrossLink";

/**
 * The addresses of a network. A page of its own under its route, or, `embedded`, the
 * content of the network record panel, which gives the name and already shows it.
 */
const NetworkDetails = ({name, embedded = false} = {}) => {
    const {t} = useTranslation();
    const [ipDetails, setIpDetails] = useState([]);
    // The type of the network, null while unknown.
    const [networkType, setNetworkType] = useState(null);
    const [nodeFilter, setNodeFilter] = useState("");
    const [pathFilter, setPathFilter] = useState("");
    const [ridFilter, setRidFilter] = useState("");
    const [showFilters, setShowFilters] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(false);
    const params = useParams();
    const networkName = name ?? params.networkName;
    const containerRef = useRef(null);

    // Scroll to top on component mount and when networkName changes
    useEffect(() => {
        window.scrollTo(0, 0);
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
    }, [networkName]);

    useEffect(() => {
        let isMounted = true;
        const fetchIpDetails = async () => {
            setIsLoading(true);
            setError(false);
            try {
                const token = localStorage.getItem("authToken");
                const res = await axios.get(URL_NETWORK_IP, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const filteredItems = (res.data.items || []).filter(
                    (item) => item.network?.name === networkName
                );
                if (isMounted) {
                    setIpDetails(filteredItems);
                    setNetworkType(
                        filteredItems.length > 0
                            ? filteredItems[0].network?.type || null
                            : null
                    );
                }
            } catch (err) {
                logger.error("Error retrieving network IP details", err);
                if (isMounted) {
                    setError(true);
                    setIpDetails([]);
                    setNetworkType(null);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        if (networkName) {
            fetchIpDetails();
        } else {
            setNetworkType(null);
            setIpDetails([]);
            setIsLoading(false);
        }

        return () => {
            isMounted = false;
        };
    }, [networkName]);

    // Debounced filter handlers
    const debouncedSetNodeFilter = useMemo(
        () => debounce((value) => setNodeFilter(value), 300),
        []
    );
    const debouncedSetPathFilter = useMemo(
        () => debounce((value) => setPathFilter(value), 300),
        []
    );
    const debouncedSetRidFilter = useMemo(
        () => debounce((value) => setRidFilter(value), 300),
        []
    );

    // Clean up debounced functions on unmount
    useEffect(() => {
        return () => {
            debouncedSetNodeFilter.cancel();
            debouncedSetPathFilter.cancel();
            debouncedSetRidFilter.cancel();
        };
    }, [debouncedSetNodeFilter, debouncedSetPathFilter, debouncedSetRidFilter]);

    const filteredIpDetails = useMemo(() => {
        return ipDetails.filter(
            (detail) =>
                (nodeFilter === "" ||
                    (detail.node || "")
                        .toLowerCase()
                        .includes(nodeFilter.toLowerCase())) &&
                (pathFilter === "" ||
                    (detail.path || "")
                        .toLowerCase()
                        .includes(pathFilter.toLowerCase())) &&
                (ridFilter === "" ||
                    (detail.rid || "")
                        .toLowerCase()
                        .includes(ridFilter.toLowerCase()))
        );
    }, [ipDetails, nodeFilter, pathFilter, ridFilter]);

    const notAvailable = t("common.notAvailable");

    return (
        <div ref={containerRef} className={embedded ? "space-y-3" : "p-4 space-y-3"}>
            {embedded ? (
                <p className="text-ink-muted">{t("networks.details.type", {type: networkType || notAvailable})}</p>
            ) : (
                <h1 className="text-title font-semibold">
                    {t("networks.details.title", {name: networkName || notAvailable, type: networkType || notAvailable})}
                </h1>
            )}
            {error && <Alert>{t("networks.details.loadError")}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    icon={<ChevronDownIcon className={showFilters ? "rotate-180" : undefined}/>}
                    aria-label={showFilters ? t("networks.details.hideFilters") : t("networks.details.showFilters")}
                    aria-expanded={showFilters}
                >
                    {showFilters ? t("networks.details.hideFilters") : t("networks.details.showFilters")}
                </Button>
                {showFilters && (
                    <>
                        <label className="flex items-center gap-1 text-ink-muted">
                            {t("common.node")}
                            <Input
                                className="h-7 w-48"
                                value={nodeFilter}
                                onChange={(e) => debouncedSetNodeFilter(e.target.value)}
                            />
                        </label>
                        <label className="flex items-center gap-1 text-ink-muted">
                            {t("networks.details.path")}
                            <Input
                                className="h-7 w-48"
                                value={pathFilter}
                                onChange={(e) => debouncedSetPathFilter(e.target.value)}
                            />
                        </label>
                        <label className="flex items-center gap-1 text-ink-muted">
                            {t("networks.details.rid")}
                            <Input
                                className="h-7 w-48"
                                value={ridFilter}
                                onChange={(e) => debouncedSetRidFilter(e.target.value)}
                            />
                        </label>
                    </>
                )}
            </div>
            {isLoading ? (
                <div className="flex justify-center py-8">
                    <Spinner label={t("networks.details.loading")}/>
                </div>
            ) : (
                <Table sticky>
                    <caption className="sr-only">{t("networks.details.caption")}</caption>
                    <thead>
                        <HeaderRow>
                            <HeaderCell>{t("networks.details.ip")}</HeaderCell>
                            <HeaderCell>{t("common.node")}</HeaderCell>
                            <HeaderCell>{t("networks.details.path")}</HeaderCell>
                            <HeaderCell>{t("networks.details.rid")}</HeaderCell>
                        </HeaderRow>
                    </thead>
                    <tbody>
                        {filteredIpDetails.length > 0 ? (
                            filteredIpDetails.map((detail, index) => (
                                <Row key={`${detail.rid}-${index}`}>
                                    <Cell className="font-medium">{detail.ip || notAvailable}</Cell>
                                    <Cell>{detail.node || notAvailable}</Cell>
                                    <Cell>
                                        {detail.path
                                            ? <CrossLink kind="object" id={detail.path}>{detail.path}</CrossLink>
                                            : notAvailable}
                                    </Cell>
                                    <Cell>{detail.rid || notAvailable}</Cell>
                                </Row>
                            ))
                        ) : (
                            <EmptyRow colSpan={4}>{t("networks.details.empty")}</EmptyRow>
                        )}
                    </tbody>
                </Table>
            )}
        </div>
    );
};

export default NetworkDetails;
