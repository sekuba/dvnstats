import {
  formatTimestampValue,
  looksLikeEidColumn,
  looksLikeHash,
  looksLikeTimestampColumn,
  stringifyScalar,
} from "../../core.js";
import { isNullish } from "../../utils/NumberUtils.js";

export function buildResultsTable(rows, { chainMetadata }) {
  const columnSet = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => columnSet.add(key));
  });

  const columns = Array.from(columnSet);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headerRow.appendChild(th);
  });

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
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

  const container = document.createElement("div");
  container.className = "copyable";
  if (highlight) {
    container.classList.add("cell-variant");
  }

  const content =
    copyValue ??
    nodes
      .map((node) => node.textContent ?? "")
      .join(" ")
      .trim();
  if (content) {
    container.dataset.copyValue = content;
  }

  if (metaObject) {
    if (metaObject.oappId) {
      container.dataset.oappId = metaObject.oappId;
    }
    if (metaObject.localEid) {
      container.dataset.localEid = metaObject.localEid;
    }
  }

  nodes.forEach((node) => container.append(node));
  td.appendChild(container);
}

function interpretValue(column, value, chainMetadata) {
  const nodes = [];

  if (value && typeof value === "object" && value.__formatted) {
    const lines = Array.isArray(value.lines) ? value.lines : [value.lines ?? ""];
    lines.forEach((line) => {
      const span = document.createElement("span");
      const content = isNullish(line) || line === "" ? " " : String(line);
      span.textContent = content;
      nodes.push(span);
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
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(value, null, 2);
    nodes.push(pre);
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
      const secondary = document.createElement("span");
      secondary.className = "cell-secondary";
      secondary.textContent = chainInfo.secondary;
      nodes.push(secondary);
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
      const secondary = document.createElement("span");
      secondary.className = "cell-secondary";
      secondary.textContent = tsInfo.secondary;
      nodes.push(secondary);
      return {
        nodes,
        copyValue: tsInfo.copyValue,
        isCopyable: true,
      };
    }
  }

  if (typeof value === "string" && looksLikeHash(column, value)) {
    const code = document.createElement("code");
    code.textContent = value;
    nodes.push(code);
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
