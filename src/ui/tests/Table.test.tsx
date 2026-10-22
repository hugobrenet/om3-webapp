import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  Cell,
  EmptyRow,
  HeaderCell,
  HeaderRow,
  Row,
  SortHeaderCell,
  Table,
} from "../components/Table";
import { TableCardsContext } from "../components/table-cards";
import { StatusMark } from "../components/StatusMark";

function renderTable(rows: React.ReactNode, sticky = false) {
  return render(
    <Table sticky={sticky} aria-label="wrapper">
      <thead>
        <HeaderRow>
          <HeaderCell>Name</HeaderCell>
          <HeaderCell>Size</HeaderCell>
        </HeaderRow>
      </thead>
      <tbody>{rows}</tbody>
    </Table>,
  );
}

describe("Table", () => {
  test("renders a table with column headers in the oc3 list style", () => {
    renderTable(
      <Row>
        <Cell>a</Cell>
        <Cell numeric>1</Cell>
      </Row>,
    );
    expect(screen.getByRole("table")).toHaveClass("w-full", "border-collapse", "text-data");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("cell", { name: "1" })).toHaveAttribute("data-numeric");
    expect(screen.getByRole("cell", { name: "1" })).toHaveClass("tabular-nums");
  });

  test("aligns every column left, its title as its values, text and numbers alike", () => {
    render(
      <Table>
        <thead>
          <HeaderRow>
            <HeaderCell>Name</HeaderCell>
            <SortHeaderCell label="Size" active direction="asc" onSort={() => {}} />
          </HeaderRow>
        </thead>
        <tbody>
          <Row>
            <Cell>a</Cell>
            <Cell numeric>1</Cell>
          </Row>
        </tbody>
      </Table>,
    );
    for (const header of screen.getAllByRole("columnheader")) expect(header).toHaveClass("text-left");
    for (const cell of screen.getAllByRole("cell")) expect(cell).toHaveClass("text-left");
    expect(screen.getByRole("button", { name: "Size" })).toHaveClass("text-left");
  });

  test("hangs the sort arrow past the title, so sorting does not move it", () => {
    render(
      <Table>
        <thead>
          <HeaderRow>
            <SortHeaderCell label="Size" active direction="desc" onSort={() => {}} />
          </HeaderRow>
        </thead>
      </Table>,
    );
    const arrow = screen.getByText("▼");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(arrow).toHaveClass("absolute", "left-full");
    expect(screen.getByRole("button", { name: "Size" })).toBeInTheDocument();
  });

  test("gives every row the 30px height of the other views", () => {
    renderTable(
      <Row>
        <Cell>a</Cell>
        <Cell>b</Cell>
      </Row>,
    );
    for (const row of screen.getAllByRole("row").slice(1)) expect(row).toHaveClass("h-[1.875rem]");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("h-[1.875rem]");
  });

  test("keeps the header in view when sticky: the wrapper scrolls both ways", () => {
    renderTable(null, true);
    expect(screen.getByRole("table")).toHaveAttribute("data-sticky");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-auto");
  });

  test("scrolls only sideways when not sticky", () => {
    renderTable(null);
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("table").parentElement).not.toHaveClass("overflow-auto");
  });

  test("names the table itself with aria-label", () => {
    renderTable(null);
    expect(screen.getByRole("table", { name: "wrapper" })).toBeInTheDocument();
  });

  test("a row with onActivate opens by click, Enter and Space, not from a control inside", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderTable(
      <Row onActivate={onActivate}>
        <Cell>a</Cell>
        <Cell>
          {/* A control inside a row stops its click, as the row documents. */}
          <button type="button" onClick={(event) => event.stopPropagation()}>
            inner
          </button>
        </Cell>
      </Row>,
    );
    const row = screen.getAllByRole("row")[1]!;
    expect(row).toHaveAttribute("tabindex", "0");
    await user.click(screen.getByRole("cell", { name: "a" }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    row.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onActivate).toHaveBeenCalledTimes(3);
    screen.getByRole("button", { name: "inner" }).focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  test("Up and Down walk the rows that open something, Home and End go to the ends; not from a control inside", async () => {
    const user = userEvent.setup();
    renderTable(
      <>
        <Row onActivate={() => {}}><Cell>one</Cell></Row>
        <Row><Cell>plain</Cell></Row>
        <Row onActivate={() => {}}><Cell>two</Cell></Row>
        <Row onActivate={() => {}}>
          <Cell>three</Cell>
          <Cell><input aria-label="inner" /></Cell>
        </Row>
      </>,
    );
    const row = (name: string) => screen.getByRole("row", { name: new RegExp(`^${name}`) });
    row("one").focus();
    await user.keyboard("{ArrowDown}");
    expect(row("two")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(row("three")).toHaveFocus();
    // The last one: it stays.
    await user.keyboard("{ArrowDown}");
    expect(row("three")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(row("one")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(row("one")).toHaveFocus();
    await user.keyboard("{End}");
    expect(row("three")).toHaveFocus();
    screen.getByRole("textbox", { name: "inner" }).focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("textbox", { name: "inner" })).toHaveFocus();
  });

  test("Space checks the checkbox of a row that has one, Enter still opens it", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onChange = vi.fn();
    renderTable(
      <Row onActivate={onActivate}>
        <Cell><input type="checkbox" aria-label="pick" onChange={onChange} onClick={(event) => event.stopPropagation()} /></Cell>
        <Cell>a</Cell>
      </Row>,
    );
    const row = screen.getAllByRole("row")[1]!;
    row.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: "pick" })).toBeChecked();
    expect(onActivate).not.toHaveBeenCalled();
    expect(row).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: "pick" })).not.toBeChecked();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test("a row without onActivate is not focusable, a selected one is marked current", () => {
    renderTable(
      <Row selected>
        <Cell>a</Cell>
        <Cell>b</Cell>
      </Row>,
    );
    const row = screen.getAllByRole("row")[1]!;
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveClass("bg-accent-soft");
  });

  test("a sortable header is a button announcing its order", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    const { rerender } = render(
      <table>
        <thead>
          <tr>
            <SortHeaderCell label="Name" active={false} direction="asc" onSort={onSort} />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "none");
    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(onSort).toHaveBeenCalledTimes(1);
    rerender(
      <table>
        <thead>
          <tr>
            <SortHeaderCell label="Name" active direction="desc" onSort={onSort} />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("button")).toHaveTextContent("Name▼");
  });

  test("an empty table says so across all its columns", () => {
    renderTable(<EmptyRow colSpan={2}>No pools</EmptyRow>);
    expect(screen.getByRole("cell", { name: "No pools" })).toHaveAttribute("colspan", "2");
  });
});

describe("StatusMark", () => {
  test.each([
    ["up", "text-state-up", "up"],
    ["warn", "text-state-warn", "warn"],
    ["down", "text-state-down", "down"],
    ["na", "text-state-unknown", "n/a"],
    ["unknown", "text-state-unknown", "unknown"],
  ] as const)("marks %s with its drawn shape, tint and label", (state, ink, label) => {
    render(<StatusMark state={state} />);
    const mark = screen.getByTitle(label);
    expect(mark).toHaveAttribute("data-state", state);
    expect(mark).toHaveClass(ink);
    expect(mark).toHaveTextContent(label);
    expect(mark.querySelector("svg")).toHaveAttribute("data-glyph", state);
  });

  test("takes a more precise label", () => {
    render(<StatusMark state="down" label="stale" />);
    expect(screen.getByTitle("stale")).toHaveTextContent("stale");
    expect(screen.getByTitle("stale").querySelector("svg")).toHaveAttribute("data-glyph", "down");
  });
});

describe("Table cards", () => {
  function List({ rows, cards }: { rows: string[]; cards?: boolean }) {
    return (
      <Table aria-label="Disks" cards={cards}>
        <thead>
          <HeaderRow>
            <HeaderCell />
            <SortHeaderCell label="Device" active direction="asc" onSort={() => {}} />
            <HeaderCell>Size</HeaderCell>
          </HeaderRow>
        </thead>
        <tbody>
          <tr>
            <th colSpan={3}>vg0</th>
          </tr>
          {rows.map((name) => (
            <Row key={name}>
              <Cell>
                <input type="checkbox" aria-label={`Select ${name}`} />
              </Cell>
              <Cell>{name}</Cell>
              <Cell numeric>1 GiB</Cell>
            </Row>
          ))}
        </tbody>
      </Table>
    );
  }

  test("a cell named after its column, the sort arrow left out; none for a cell without a title or across columns", async () => {
    const { rerender } = render(<List rows={["sda"]} cards />);
    expect(screen.getByRole("table", { name: "Disks" })).toHaveAttribute("data-cards");
    const cells = screen.getByText("sda").closest("tr")!.querySelectorAll("td");
    expect([...cells].map((cell) => cell.dataset.label)).toEqual([undefined, "Device", "Size"]);
    expect(screen.getByText("vg0")).not.toHaveAttribute("data-label");
    // A row come later, named as well.
    rerender(<List rows={["sda", "sdb"]} cards />);
    await waitFor(() => {
      expect(screen.getByText("sdb")).toHaveAttribute("data-label", "Device");
    });
  });

  test("off by default, out of a panel: no cards, no names", () => {
    render(<List rows={["sda"]} />);
    expect(screen.getByRole("table", { name: "Disks" })).not.toHaveAttribute("data-cards");
    expect(screen.getByText("sda")).not.toHaveAttribute("data-label");
  });

  test("on in a panel, unless the table keeps its columns", () => {
    render(
      <TableCardsContext.Provider value>
        <List rows={["sda"]} />
        <Table aria-label="Board" cards={false}>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </Table>
      </TableCardsContext.Provider>,
    );
    expect(screen.getByRole("table", { name: "Disks" })).toHaveAttribute("data-cards");
    expect(screen.getByRole("table", { name: "Board" })).not.toHaveAttribute("data-cards");
  });
});
