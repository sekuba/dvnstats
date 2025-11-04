/**
 * Build the collapsible JSON payload viewer shown beneath tabular results.
 */
export function buildPayloadDetails(payload) {
  const details = document.createElement("details");
  details.className = "json-dump";

  const summary = document.createElement("summary");
  summary.textContent = "View response payload";
  details.appendChild(summary);

  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(payload, null, 2);
  details.appendChild(pre);

  return details;
}
