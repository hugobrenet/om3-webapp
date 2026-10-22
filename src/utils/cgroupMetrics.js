// Reads the per cgroup metrics the daemon serves at /metrics/pg, in the
// prometheus text exposition format, one series set per object with a pg.

const SAMPLE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

const FIELDS = {
    opensvc_pg_cgroup_cpu_usage_usec: "cpuUsageUsec",
    opensvc_pg_cgroup_memory_current_bytes: "memoryCurrent",
    opensvc_pg_cgroup_memory_max_bytes: "memoryMax",
};

const parseValue = (text) => {
    if (text === "+Inf") return Infinity;
    if (text === "-Inf") return -Infinity;
    return Number(text);
};

/** The samples of an exposition text, comments left out. */
export const parsePrometheusText = (text) => {
    const samples = [];
    for (const line of (text || "").split("\n")) {
        if (line === "" || line.startsWith("#")) continue;
        const match = SAMPLE.exec(line);
        if (!match) continue;
        const labels = {};
        for (const [, name, value] of (match[2] || "").matchAll(LABEL)) {
            labels[name] = value.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
        }
        samples.push({name: match[1], labels, value: parseValue(match[3])});
    }
    return samples;
};

/**
 * The cgroup usage of the objects of a namespace, by object path:
 * {cpuUsageUsec, memoryCurrent, memoryMax}. memoryMax is Infinity when
 * the cgroup has no memory limit.
 */
export const namespaceCgroupMetrics = (text, namespace) => {
    const byPath = {};
    for (const {name, labels, value} of parsePrometheusText(text)) {
        const field = FIELDS[name];
        if (!field || labels.namespace !== namespace || !labels.path) continue;
        byPath[labels.path] = byPath[labels.path] || {};
        byPath[labels.path][field] = value;
    }
    return byPath;
};

/**
 * The CPU used between two readings, as a percentage of one CPU, or null
 * when it can not be told: no previous reading, or a counter that went
 * back (the cgroup was recreated).
 */
export const cpuPercent = (previous, current, elapsedMs) => {
    if (previous === undefined || current === undefined || elapsedMs <= 0) return null;
    const used = current - previous;
    if (used < 0) return null;
    return (used / 1000 / elapsedMs) * 100;
};

/**
 * The usage of the namespace as a whole: the sum of its objects' cgroups,
 * the daemon reporting none for the namespace itself. The CPU is null
 * while no object has a rate yet; an object without one (first reading,
 * recreated cgroup) adds nothing.
 */
export const namespaceTotals = (rows) => {
    let cpu = null;
    let memoryCurrent;
    for (const row of rows) {
        if (row.cpu !== null && row.cpu !== undefined) cpu = (cpu ?? 0) + row.cpu;
        if (row.memoryCurrent !== undefined) memoryCurrent = (memoryCurrent ?? 0) + row.memoryCurrent;
    }
    return {cpu, memoryCurrent};
};

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

export const formatBytes = (bytes) => {
    if (bytes === undefined || Number.isNaN(bytes)) return "-";
    if (bytes === Infinity) return "unlimited";
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
};
