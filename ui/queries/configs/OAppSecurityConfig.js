/**
 * OApp Security Config Query Configuration
 * Resolve the current security posture for a single OApp
 */

import { normalizeAddress, normalizeOAppId } from "../../../core.js";
import { resolveOAppSecurityConfigs } from "../../../resolver.js";
import { OAPP_SECURITY_CONFIG_QUERY } from "../../../queries/oappSecurityConfig.js";

export function createOAppSecurityConfig(coordinator) {
  return {
    label: "OApp Security Config",
    description: "Resolve the current security posture for a single OApp",
    query: OAPP_SECURITY_CONFIG_QUERY,

    initialize: ({ card }) => {
      const endpointInput = card.querySelector("[data-chain-input]");
      const chainLabel = card.querySelector("[data-chain-label]");
      const datalist = card.querySelector("[data-chain-datalist]");

      if (datalist) {
        coordinator.populateChainDatalist(datalist);
      }

      if (endpointInput && chainLabel) {
        const updateLabel = () => {
          const localEid = endpointInput.value.trim();
          const display = coordinator.getChainDisplayLabel(localEid);
          chainLabel.textContent = display ? `Chain: ${display}` : "Chain not selected.";
        };
        endpointInput.addEventListener("input", updateLabel);
        updateLabel();
      }

      const idInput = card.querySelector('input[name="oappId"]');
      if (idInput) {
        idInput.addEventListener("blur", () => {
          if (!idInput.value) return;
          try {
            const normalized = normalizeOAppId(idInput.value);
            if (normalized !== idInput.value) {
              idInput.value = normalized;
            }
          } catch (error) {
            // ignore invalid input on blur
          }
        });
      }
    },

    buildVariables: (card) => {
      const idInput = card.querySelector('input[name="oappId"]');
      const eidInput = card.querySelector('input[name="localEid"]');
      const addressInput = card.querySelector('input[name="oappAddress"]');

      const rawId = idInput?.value?.trim() ?? "";
      let oappId = "";
      let localEid = "";
      let address = "";

      if (rawId) {
        const normalizedId = normalizeOAppId(rawId);
        const parts = normalizedId.split("_");
        localEid = parts[0];
        address = parts[1];
        oappId = normalizedId;
        if (eidInput) {
          eidInput.value = localEid;
          eidInput.dispatchEvent(new Event("input"));
        }
        if (addressInput) {
          addressInput.value = address;
        }
        if (idInput) {
          idInput.value = oappId;
        }
      } else {
        localEid = eidInput?.value?.trim() ?? "";
        address = addressInput?.value?.trim() ?? "";
        if (!localEid || !address) {
          throw new Error("Provide an OApp ID or local EID plus address.");
        }
        address = normalizeAddress(address);
        oappId = `${localEid}_${address}`;
        if (idInput) {
          idInput.value = oappId;
        }
        if (addressInput) {
          addressInput.value = address;
        }
        if (eidInput) {
          eidInput.dispatchEvent(new Event("input"));
        }
      }

      const localLabel = coordinator.getChainDisplayLabel(localEid) || `EID ${localEid}`;
      const summary = `${localLabel} • ${address}`;
      return {
        variables: { oappId, localEid },
        meta: {
          limitLabel: `oappId=${oappId}`,
          summary,
          localEid,
          chainLabel: localLabel,
          oappAddress: address,
          resultLabel: `OApp Security Config – ${localLabel}`,
        },
      };
    },

    processResponse: (payload, meta) => {
      const oapp = payload?.data?.OAppStats?.[0] ?? null;
      const configs = payload?.data?.OAppSecurityConfig ?? [];
      const peers = payload?.data?.OAppPeer ?? [];
      const routeStats = payload?.data?.OAppRouteStats ?? [];
      const rateLimiter = payload?.data?.OAppRateLimiter?.[0] ?? null;
      const rateLimits = payload?.data?.OAppRateLimit ?? [];
      const defaultReceiveLibraries = payload?.data?.DefaultReceiveLibrary ?? [];
      const defaultUlnConfigs = payload?.data?.DefaultUlnConfig ?? [];
      const oappReceiveLibraries = payload?.data?.OAppReceiveLibrary ?? [];
      const oappUlnConfigs = payload?.data?.OAppUlnConfig ?? [];
      const enrichedMeta = { ...meta };

      if (oapp) {
        const localEid = String(oapp.localEid ?? "");
        const chainDisplay =
          coordinator.getChainDisplayLabel(localEid) ||
          enrichedMeta.chainLabel ||
          `EID ${localEid}`;
        enrichedMeta.oappInfo = oapp;
        enrichedMeta.oappAddress = oapp.address;
        enrichedMeta.chainLabel = chainDisplay;
        enrichedMeta.localEid = localEid;
        enrichedMeta.summary = enrichedMeta.summary || `${chainDisplay} • ${oapp.address}`;
        enrichedMeta.resultLabel = `OApp Security Config – ${chainDisplay}`;
      }

      // Create peer lookup map
      const peerMap = new Map();
      peers.forEach((peer) => {
        const key = String(peer.eid);
        peerMap.set(key, peer);
      });
      enrichedMeta.peerMap = peerMap;

      // Store route stats, rate limiting info
      enrichedMeta.routeStats = routeStats;
      enrichedMeta.rateLimiter = rateLimiter;
      enrichedMeta.rateLimits = rateLimits;
      const queryVars = meta?.variables ?? {};
      const derivedLocalEid =
        enrichedMeta.localEid ||
        (queryVars.localEid !== undefined ? String(queryVars.localEid) : null) ||
        (oapp && oapp.localEid !== undefined && oapp.localEid !== null
          ? String(oapp.localEid)
          : null);
      const resolvedOappId = queryVars.oappId || oapp?.id || enrichedMeta.oappInfo?.id || null;
      const resolvedAddress = oapp?.address || enrichedMeta.oappAddress || meta?.oappAddress || "";

      let resolvedRows = configs;
      if (resolvedOappId && derivedLocalEid) {
        const resolution = resolveOAppSecurityConfigs({
          oappId: resolvedOappId,
          localEid: derivedLocalEid,
          oappAddress: resolvedAddress,
          securityConfigs: configs,
          defaultReceiveLibraries,
          defaultUlnConfigs,
          oappPeers: peers,
          oappReceiveLibraries,
          oappUlnConfigs,
          routeStats,
        });
        resolvedRows = resolution.rows;
        enrichedMeta.securitySummary = resolution.summary;
      }

      const formattedRows = coordinator.securityConfigFormatter.formatSecurityConfigRows(
        resolvedRows,
        enrichedMeta,
      );

      return { rows: formattedRows, meta: enrichedMeta };
    },
  };
}
