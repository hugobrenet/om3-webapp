import React, {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {cn} from "../ui/cn";
import {decodePemCertificates, fingerprint, formatName} from "../utils/x509";

const DAY = 24 * 60 * 60 * 1000;
// Fewer days left, the end of the validity is told as close.
const EXPIRES_SOON_DAYS = 30;

/** Where a certificate is in its validity, told and colored as a state. */
const validityOf = (certificate, now, t) => {
    if (now < certificate.notBefore) return {text: t("keys.certificate.notYetValid"), tone: "text-state-warn"};
    if (now > certificate.notAfter) return {text: t("keys.certificate.expired"), tone: "text-state-down"};
    const days = Math.floor((certificate.notAfter - now) / DAY);
    return {
        text: t("keys.certificate.expiresIn", {count: days}),
        tone: days < EXPIRES_SOON_DAYS ? "text-state-warn" : "text-state-up",
    };
};

const publicKeyOf = ({algorithm, bits, curve}, t) => {
    if (bits) return t("keys.certificate.keyBits", {algorithm, bits});
    if (curve) return `${algorithm} ${curve}`;
    return algorithm;
};

const Line = ({label, children, mono = false}) => (
    <>
        <dt className="text-ink-muted">{label}</dt>
        <dd className={cn("min-w-0 break-words text-ink", mono && "font-mono break-all")}>{children}</dd>
    </>
);

const List = ({items}) => (
    <ul className="space-y-0.5">
        {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
);

/** The fingerprints of a certificate, read once WebCrypto has hashed it: none on plain http. */
const useFingerprints = (der) => {
    const [prints, setPrints] = useState(null);
    useEffect(() => {
        let live = true;
        Promise.all([fingerprint(der, "SHA-256"), fingerprint(der, "SHA-1")])
            .then(([sha256, sha1]) => live && setPrints(sha256 ? {sha256, sha1} : null))
            .catch(() => live && setPrints(null));
        return () => {
            live = false;
        };
    }, [der]);
    return prints;
};

const Certificate = ({certificate, index, total}) => {
    const {t, i18n} = useTranslation();
    const prints = useFingerprints(certificate.der);
    const validity = validityOf(certificate, new Date(), t);
    const date = (value) => value.toLocaleString(i18n.language, {dateStyle: "medium", timeStyle: "long", timeZone: "UTC"});
    const {subjectAltName, keyUsage, extendedKeyUsage, basicConstraints, subjectKeyId, authorityKeyId, critical = []} = certificate.extensions;
    const criticalMark = (oid) => (critical.includes(oid) ? ` (${t("keys.certificate.critical")})` : "");
    const commonName = certificate.subject.find((attribute) => attribute.type === "CN")?.value;
    const title = total > 1 ? t("keys.certificate.numbered", {index: index + 1, total}) : t("keys.certificate.title");

    return (
        <section aria-label={title} className="rounded-(--radius-control) border border-line bg-surface p-3">
            <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 font-semibold text-ink">
                {title}
                {commonName && <span className="font-normal text-ink-muted">{commonName}</span>}
                {basicConstraints?.ca && <span className="font-normal text-ink-muted">· {t("keys.certificate.authority")}</span>}
            </h3>
            <dl className="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-4 gap-y-1 text-data">
                <Line label={t("keys.certificate.subject")}>{formatName(certificate.subject) || "—"}</Line>
                <Line label={t("keys.certificate.issuer")}>{formatName(certificate.issuer) || "—"}</Line>
                <Line label={t("keys.certificate.validity")}>
                    <span className={cn("font-medium", validity.tone)}>{validity.text}</span>
                </Line>
                <Line label={t("keys.certificate.notBefore")}>{date(certificate.notBefore)}</Line>
                <Line label={t("keys.certificate.notAfter")}>{date(certificate.notAfter)}</Line>
                {subjectAltName && (
                    <Line label={t("keys.certificate.altNames") + criticalMark("2.5.29.17")}>
                        <List items={subjectAltName}/>
                    </Line>
                )}
                <Line label={t("keys.certificate.publicKey")}>{publicKeyOf(certificate.publicKey, t)}</Line>
                <Line label={t("keys.certificate.signature")}>{certificate.signatureAlgorithm}</Line>
                {keyUsage && (
                    <Line label={t("keys.certificate.keyUsage") + criticalMark("2.5.29.15")}>{keyUsage.join(", ")}</Line>
                )}
                {extendedKeyUsage && (
                    <Line label={t("keys.certificate.extendedKeyUsage") + criticalMark("2.5.29.37")}>{extendedKeyUsage.join(", ")}</Line>
                )}
                {basicConstraints && (
                    <Line label={t("keys.certificate.basicConstraints") + criticalMark("2.5.29.19")}>
                        {basicConstraints.ca ? "CA:TRUE" : "CA:FALSE"}
                        {basicConstraints.pathLength !== null && `, pathlen:${basicConstraints.pathLength}`}
                    </Line>
                )}
                <Line label={t("keys.certificate.serial")} mono>{certificate.serialNumber}</Line>
                <Line label={t("keys.certificate.version")}>{certificate.version}</Line>
                {subjectKeyId && <Line label={t("keys.certificate.subjectKeyId")} mono>{subjectKeyId}</Line>}
                {authorityKeyId && <Line label={t("keys.certificate.authorityKeyId")} mono>{authorityKeyId}</Line>}
                {prints && <Line label={t("keys.certificate.sha256")} mono>{prints.sha256}</Line>}
                {prints && <Line label={t("keys.certificate.sha1")} mono>{prints.sha1}</Line>}
            </dl>
        </section>
    );
};

/**
 * The PEM certificates of a key decoded, as `openssl x509 -text` tells them: a
 * chain, one by one, in its order. A block that does not decode is said so, the
 * others still shown.
 */
const CertificateDetails = ({text}) => {
    const {t} = useTranslation();
    const certificates = React.useMemo(() => decodePemCertificates(text), [text]);
    return (
        <div className="max-h-[28rem] space-y-2 overflow-auto">
            {certificates.map((certificate, index) => (
                certificate.error ? (
                    <p key={index} role="alert" className="rounded-(--radius-control) border border-line p-3 text-state-down">
                        {t("keys.certificate.invalid", {index: index + 1, message: certificate.error})}
                    </p>
                ) : (
                    <Certificate key={index} certificate={certificate} index={index} total={certificates.length}/>
                )
            ))}
        </div>
    );
};

export default CertificateDetails;
