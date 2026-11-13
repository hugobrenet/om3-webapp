import React from "react";
import {useTranslation} from "react-i18next";
import {RelativeTime} from "../ui/components/RelativeTime";
import {formatRelativeTime} from "../ui/lib/format";

/** The zero time a daemon reports for a time that never happened. */
export const ZERO_DATE = "0001-01-01T00:00:00Z";

/**
 * How long ago a time was, within a sentence: as every time from now is said
 * (RelativeTime), "4 days ago", a dash when there is none.
 */
export const formatAge = (dateString, language) => {
    if (!dateString || dateString === ZERO_DATE) {
        return "-";
    }
    return formatRelativeTime(dateString, language);
};

/** A time in a table: from now, as in the panels (RelativeTime), a dash when there is none. */
export const AgeTime = ({value}) => {
    const {i18n} = useTranslation();
    if (!value || value === ZERO_DATE) {
        return "-";
    }
    return <RelativeTime value={value} locale={i18n.language}/>;
};
