import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePeek } from "./panel-search";
import type { PeekKind } from "./peek";

/**
 * Value of a cell that names a record from another view: the object of an address,
 * the node of an instance… as the oc3 badges do. In the body of a panel, the
 * convention for what can be drilled down into: the nodes, the objects, their
 * instances and their resources, each a badge opening its own panel. A badge of
 * its name alone, no icon.
 *
 * A click shows its record over the view, without leaving it (`peek` in the URL, see
 * `PeekPanel`). The click stops at the badge: the row under it, whose own panel a
 * click elsewhere on the row opens, does not receive it.
 */
export function CrossLink({
  kind,
  id,
  tab,
  children,
}: {
  kind: PeekKind;
  /** Id of the record; without it, the value stays plain text. */
  id: string | undefined;
  /** Tab of the record panel to open on, its first one by default. */
  tab?: string;
  children: ReactNode;
}) {
  const peek = usePeek();
  const { t } = useTranslation();

  if (id === undefined || id === "" || children === undefined || children === null || children === "")
    return <>{children}</>;

  const open = () => {
    peek(kind, id, tab);
  };

  return (
    <button
      type="button"
      title={t("panel.crossLink", { kind: t(`panel.kinds.${kind}`) })}
      onClick={(event) => {
        // Not for the row: it would open its own panel under the record.
        event.stopPropagation();
        open();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        open();
      }}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface px-1.5 text-data hover:border-line-strong hover:bg-surface-sunken"
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
