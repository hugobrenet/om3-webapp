import {decodeCertificate, decodePemCertificates, fingerprint, formatName, hasPemCertificate} from '../x509';
import {CA_PEM, LEAF_PEM} from './certificates.fixture';

const PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n';

describe('x509', () => {
    test('a PEM certificate is detected, a key alone is not', () => {
        expect(hasPemCertificate(LEAF_PEM)).toBe(true);
        expect(hasPemCertificate(PRIVATE_KEY + LEAF_PEM)).toBe(true);
        expect(hasPemCertificate(PRIVATE_KEY)).toBe(false);
        expect(hasPemCertificate('hello')).toBe(false);
        expect(hasPemCertificate(undefined)).toBe(false);
    });

    test('a server certificate decodes as openssl tells it', () => {
        const [leaf] = decodePemCertificates(LEAF_PEM);
        expect(leaf.version).toBe(3);
        // The zero byte keeping the serial positive left out.
        expect(leaf.serialNumber).toBe('f1:e2');
        expect(formatName(leaf.subject)).toBe('O=OpenSVC, CN=web.example.com');
        expect(formatName(leaf.issuer)).toBe('C=FR, O=OpenSVC, CN=Test CA');
        expect(leaf.signatureAlgorithm).toBe('ecdsa-with-SHA256');
        expect(leaf.publicKey).toEqual({algorithm: 'RSA', bits: 2048});
        // UTCTime before 2050, GeneralizedTime past it.
        expect(leaf.notBefore.getUTCFullYear()).toBe(2026);
        expect(leaf.notAfter.toISOString()).toMatch(/^2126-/);
        expect(leaf.extensions).toMatchObject({
            subjectAltName: ['DNS:web.example.com', 'IP Address:10.0.0.1', 'IP Address:2001:db8::1'],
            keyUsage: ['Digital Signature', 'Key Encipherment'],
            extendedKeyUsage: ['TLS Web Server Authentication'],
            basicConstraints: {ca: false, pathLength: null},
            authorityKeyId: '4B:64:01:CC:CA:A6:71:AC:59:AE:2E:87:13:BB:80:13:FF:45:B9:17',
            critical: ['2.5.29.15'],
        });
    });

    test('an authority decodes with its constraints', () => {
        const [ca] = decodePemCertificates(CA_PEM);
        expect(ca.publicKey).toEqual({algorithm: 'EC', curve: 'P-256'});
        expect(ca.extensions.basicConstraints).toEqual({ca: true, pathLength: 0});
        expect(ca.extensions.keyUsage).toEqual(['Certificate Sign', 'CRL Sign']);
        expect(ca.extensions.subjectKeyId).toBe('4B:64:01:CC:CA:A6:71:AC:59:AE:2E:87:13:BB:80:13:FF:45:B9:17');
    });

    test('a chain decodes in its order, the private key around left out', () => {
        const certificates = decodePemCertificates(PRIVATE_KEY + LEAF_PEM + CA_PEM);
        expect(certificates.map((c) => c.subject.at(-1).value)).toEqual(['web.example.com', 'Test CA']);
    });

    test('a block that is not a certificate tells its error', () => {
        const [broken, ca] = decodePemCertificates('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n' + CA_PEM);
        expect(broken.error).toEqual(expect.any(String));
        expect(ca.subject.at(-1).value).toBe('Test CA');
        expect(() => decodeCertificate(new Uint8Array([0x02, 0x01, 0x00]))).toThrow();
    });

    test('the fingerprints are those of openssl', async () => {
        const [leaf] = decodePemCertificates(LEAF_PEM);
        expect(await fingerprint(leaf.der)).toBe('47:A1:99:02:3B:78:94:F8:15:13:08:6B:FF:13:01:C5:45:3E:E2:22:DE:0C:08:6E:67:0F:C6:D9:48:57:90:3D');
        expect(await fingerprint(leaf.der, 'SHA-1')).toBe('91:F4:AD:05:AC:61:6E:CA:F4:BC:E6:7D:CD:33:94:83:18:F1:78:2D');
    });
});
