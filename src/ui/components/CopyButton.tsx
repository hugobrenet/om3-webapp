import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./Button";
import { CheckIcon, CopyIcon } from "../icons";

/** How long the check says the text was copied. */
const COPIED_MS = 2000;

/** Whether the page may write the clipboard: a secure context with the clipboard API. */
const canCopy = () =>
  typeof window !== "undefined" && window.isSecureContext !== false && typeof navigator.clipboard?.writeText === "function";

/**
 * Copies `text` to the clipboard, a check in the place of its icon for a while, said
 * to assistive tools. Not shown where the page may not write the clipboard (served
 * over plain http): no button that would do nothing.
 */
export function CopyButton({ text, label, size = "sm" }: { text: string; label: string; size?: "sm" | "md" }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  if (!canCopy()) return null;
  return (
    <>
      <IconButton
        size={size}
        label={copied ? t("common.copied") : label}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? <CheckIcon className="text-state-up" /> : <CopyIcon />}
      </IconButton>
      <span className="sr-only" role="status">
        {copied ? t("common.copied") : ""}
      </span>
    </>
  );
}
