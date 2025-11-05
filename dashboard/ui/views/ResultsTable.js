import {
  formatTimestampValue,
  looksLikeEidColumn,
  looksLikeHash,
  looksLikeTimestampColumn,
  stringifyScalar,
} from "../../core.js";
import { isNullish } from "../../utils/NumberUtils.js";
import { DomBuilder } from "../../utils/dom/DomBuilder.js";

export function buildResultsTable(rows, { chainMetadata }) {
  const columnSet = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => columnSet.add(key));
  });

  const columns = Array.from(columnSet);
  const table = DomBuilder.table();

  const headerRow = DomBuilder.tr();
  columns.forEach((column) => {
    headerRow.appendChild(DomBuilder.th({ textContent: column }));
  });

  const thead = DomBuilder.thead({}, headerRow);
  table.appendChild(thead);

  const tbody = DomBuilder.tbody();
  rows.forEach((row) => {
    const tr = DomBuilder.tr();
    columns.forEach((column) => {
      const td = DomBuilder.td();
      renderCell(td, column, row[column], chainMetadata);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function renderCell(td, column, value, chainMetadata) {
  const { nodes, copyValue, isCopyable, meta, highlight } = interpretValue(
    column,
    value,
    chainMetadata,
  );

  td.classList.remove("meter-cell");
  td.style.removeProperty("--meter-fill");

  const metaObject = meta && typeof meta === "object" ? { ...meta } : null;

  if (metaObject && typeof metaObject.meterPercent === "number") {
    const clamped = Math.max(0, Math.min(1, metaObject.meterPercent));
    if (clamped > 0) {
      td.classList.add("meter-cell");
      td.style.setProperty("--meter-fill", clamped.toFixed(4));
    }
    delete metaObject.meterPercent;
  }

  if (!isCopyable) {
    const fragment = document.createDocumentFragment();
    nodes.forEach((node) => fragment.append(node));
    td.appendChild(fragment);
    return;
  }

  const content =
    copyValue ??
    nodes
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();

  const dataset = {};
  if (content) dataset.copyValue = content;
  if (metaObject?.oappId) dataset.oappId = metaObject.oappId;
  if (metaObject?.localEid) dataset.localEid = metaObject.localEid;

  const containerClasses = ["copyable"];
  if (highlight) containerClasses.push("cell-variant");

  const container = DomBuilder.div({
    className: containerClasses.join(" "),
    dataset,
  });

  nodes.forEach((node) => container.append(node));
  td.appendChild(container);
}

function interpretValue(column, value, chainMetadata) {
  const nodes = [];

  if (value && typeof value === "object" && value.__formatted) {
    const lines = Array.isArray(value.lines) ? value.lines : [value.lines ?? ""];
    lines.forEach((line) => {
      const content = isNullish(line) || line === "" ? " " : String(line);
      nodes.push(DomBuilder.span({ textContent: content }));
    });
    const cleanedLines = lines
      .map((line) => (isNullish(line) ? "" : String(line)))
      .filter((line) => line.trim().length > 0);
    const copyValue = value.copyValue ?? cleanedLines.join(" | ");
    return {
      nodes,
      copyValue,
      isCopyable: true,
      meta: value.meta || null,
      highlight: value.highlight || false,
    };
  }

  if (isNullish(value)) {
    nodes.push(document.createTextNode("—"));
    return {
      nodes,
      copyValue: "null",
      isCopyable: true,
    };
  }

  if (Array.isArray(value) || (typeof value === "object" && value)) {
    nodes.push(DomBuilder.pre({ textContent: JSON.stringify(value, null, 2) }));
    return {
      nodes,
      copyValue: JSON.stringify(value, null, 2),
      isCopyable: true,
    };
  }

  if (looksLikeEidColumn(column)) {
    const chainInfo = chainMetadata?.getChainInfo?.(value);
    if (chainInfo) {
      nodes.push(document.createTextNode(chainInfo.primary));
      nodes.push(
        DomBuilder.span({
          className: "cell-secondary",
          textContent: chainInfo.secondary,
        }),
      );
      return {
        nodes,
        copyValue: chainInfo.copyValue,
        isCopyable: true,
      };
    }
  }

  if (looksLikeTimestampColumn(column)) {
    const tsInfo = formatTimestampValue(value);
    if (tsInfo) {
      nodes.push(document.createTextNode(tsInfo.primary));
      nodes.push(
        DomBuilder.span({
          className: "cell-secondary",
          textContent: tsInfo.secondary,
        }),
      );
      return {
        nodes,
        copyValue: tsInfo.copyValue,
        isCopyable: true,
      };
    }
  }

  if (typeof value === "string" && looksLikeHash(column, value)) {
    nodes.push(DomBuilder.code({ textContent: value }));
    return {
      nodes,
      copyValue: value,
      isCopyable: true,
    };
  }

  const strValue = stringifyScalar(value);
  nodes.push(document.createTextNode(strValue));
  return {
    nodes,
    copyValue: strValue,
    isCopyable: true,
  };
}
