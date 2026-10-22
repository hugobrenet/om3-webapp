import {cpuPercent, formatBytes, namespaceCgroupMetrics, namespaceTotals, parsePrometheusText} from '../cgroupMetrics';

const TEXT = `# HELP opensvc_pg_cgroup_cpu_usage_usec Total CPU usage in microseconds for the cgroup
# TYPE opensvc_pg_cgroup_cpu_usage_usec gauge
opensvc_pg_cgroup_cpu_usage_usec{namespace="gh",path="gh/svc/foo"} 1.5e+06
opensvc_pg_cgroup_cpu_usage_usec{namespace="ijklm",path="ijklm/svc/foo"} 42
opensvc_pg_cgroup_cpu_usage_usec{namespace="root",path="foo001"} 7
opensvc_pg_cgroup_memory_current_bytes{namespace="gh",path="gh/svc/foo"} 2048
opensvc_pg_cgroup_memory_max_bytes{namespace="gh",path="gh/svc/foo"} +Inf
opensvc_pg_cgroup_memory_stat_bytes{namespace="gh",path="gh/svc/foo",stat="anon"} 1024
opensvc_pg_cgroups 3
`;

describe('parsePrometheusText', () => {
    test('reads names, labels and values, skipping comments', () => {
        const samples = parsePrometheusText(TEXT);
        expect(samples).toHaveLength(7);
        expect(samples[0]).toEqual({
            name: 'opensvc_pg_cgroup_cpu_usage_usec',
            labels: {namespace: 'gh', path: 'gh/svc/foo'},
            value: 1500000,
        });
        expect(samples[4].value).toBe(Infinity);
        expect(samples[6]).toEqual({name: 'opensvc_pg_cgroups', labels: {}, value: 3});
    });

    test('unescapes label values', () => {
        const [sample] = parsePrometheusText('m{a="x\\"y\\\\z"} 1');
        expect(sample.labels.a).toBe('x"y\\z');
    });

    test('tolerates an empty body', () => {
        expect(parsePrometheusText('')).toEqual([]);
        expect(parsePrometheusText(undefined)).toEqual([]);
    });
});

describe('namespaceCgroupMetrics', () => {
    test('keeps the usage of the objects of the namespace', () => {
        expect(namespaceCgroupMetrics(TEXT, 'gh')).toEqual({
            'gh/svc/foo': {cpuUsageUsec: 1500000, memoryCurrent: 2048, memoryMax: Infinity},
        });
    });

    test('reads the root namespace, whose paths have no namespace part', () => {
        expect(namespaceCgroupMetrics(TEXT, 'root')).toEqual({foo001: {cpuUsageUsec: 7}});
    });

    test('is empty for a namespace without cgroup', () => {
        expect(namespaceCgroupMetrics(TEXT, 'other')).toEqual({});
    });
});

describe('cpuPercent', () => {
    test('is the share of one CPU used between two readings', () => {
        // 500ms of CPU over 1s
        expect(cpuPercent(1000000, 1500000, 1000)).toBe(50);
    });

    test('can not be told without a previous reading or when the counter went back', () => {
        expect(cpuPercent(undefined, 10, 1000)).toBeNull();
        expect(cpuPercent(20, 10, 1000)).toBeNull();
        expect(cpuPercent(10, 20, 0)).toBeNull();
    });
});

describe('namespaceTotals', () => {
    test('sums the CPU and memory of the objects', () => {
        expect(namespaceTotals([
            {cpu: 12.5, memoryCurrent: 1024},
            {cpu: 30, memoryCurrent: 2048},
        ])).toEqual({cpu: 42.5, memoryCurrent: 3072});
    });

    test('leaves out the objects without a CPU rate yet', () => {
        expect(namespaceTotals([{cpu: null, memoryCurrent: 1}, {cpu: 5}]).cpu).toBe(5);
    });

    test('has no CPU while no object has a rate, nor memory when none is known', () => {
        expect(namespaceTotals([{cpu: null}])).toEqual({cpu: null, memoryCurrent: undefined});
        expect(namespaceTotals([])).toEqual({cpu: null, memoryCurrent: undefined});
    });
});

describe('formatBytes', () => {
    test('formats in binary units', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KiB');
        expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
    });

    test('says when there is no limit or no value', () => {
        expect(formatBytes(Infinity)).toBe('unlimited');
        expect(formatBytes(undefined)).toBe('-');
    });
});
