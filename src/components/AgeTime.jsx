import React from "react";
import {useTranslation} from "react-i18next";

/** The zero time a daemon reports for a time that never happened. */
export const ZERO_DATE = "0001-01-01T00:00:00Z";

/**
 * How long ago a time was, as the tables say it: just now, minutes, hours or days
 * ago within a week, the date after that, a dash when there is none.
 */
export const formatAge = (dateString, t, language) => {
    if (!dateString || dateString === ZERO_DATE) {
        return "-";
    }

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t("nodes.time.justNow");
    if (diffMins < 60) return t("nodes.time.minutesAgo", {count: diffMins});
    if (diffHours < 24) return t("nodes.time.hoursAgo", {count: diffHours});
    if (diffDays < 7) return t("nodes.time.daysAgo", {count: diffDays});

    return date.toLocaleDateString(language);
};

/** A time in a table: its age, the full date and time on hover, a dash when there is none. */
export const AgeTime = ({value}) => {
    const {t, i18n} = useTranslation();
    if (!value || value === ZERO_DATE) {
        return "-";
    }
    return <span title={new Date(value).toLocaleString(i18n.language)}>{formatAge(value, t, i18n.language)}</span>;
};
