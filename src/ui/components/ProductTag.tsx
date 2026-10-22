import { useTranslation } from "react-i18next";

/**
 * The "Cluster" tag after the OpenSVC name: the webapp of an om3 cluster borrows the
 * look of oc3, the collector frontend, and this tag tells the two apart at a glance.
 */
export function ProductTag() {
  const { t } = useTranslation();
  return (
    <span
      title={t("ui.productTag.title")}
      className="rounded-(--radius-control) bg-accent-soft px-1.5 py-px text-data font-semibold text-accent"
    >
      {/* Name of this frontend, set apart from the collector one (oc3) that looks the same. */}
      {t("ui.productTag.name")}
    </span>
  );
}
