import { APP_CONFIG } from "../../../config.js";
import { clampInteger, isZeroAddress, normalizeOAppId, splitOAppId } from "../../../core.js";

// localEid_0x<20-byte EVM address | 32-byte peer address>, as produced by the indexer.
const OAPP_ID_PATTERN = /^\d+_0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function normalizeSeedOAppId(rawValue) {
  const shown = rawValue.length > 90 ? `${rawValue.slice(0, 90)}…` : rawValue;
  const invalid = (reason) =>
    new Error(`Invalid seed OApp ID "${shown}": ${reason} Expected localEid_0xaddress.`);

  let normalized;
  try {
    normalized = normalizeOAppId(rawValue);
  } catch (error) {
    throw invalid(`${error.message}.`);
  }
  if (!OAPP_ID_PATTERN.test(normalized)) {
    throw invalid("malformed.");
  }
  if (isZeroAddress(splitOAppId(normalized).address)) {
    throw invalid("zero address.");
  }
  return normalized;
}

export function createWebOfSecurityConfig(coordinator) {
  return {
    label: "Web of Security",
    description: "Crawl or load the security graph for an OApp",
    query: null,

    initialize: ({ card, run }) => {
      const fileInput = card.querySelector('input[name="webFile"]');
      if (fileInput) {
        fileInput.addEventListener("change", () => {
          if (fileInput.files && fileInput.files[0]) {
            run();
          }
        });
      }
    },

    buildVariables: (card) => {
      const seedOAppIdInput = card.querySelector('input[name="seedOAppId"]');
      const depthInput = card.querySelector('input[name="depth"]');
      const fileInput = card.querySelector('input[name="webFile"]');

      const rawSeed = seedOAppIdInput?.value?.trim() ?? "";
      const depth = clampInteger(
        depthInput?.value,
        1,
        APP_CONFIG.CRAWLER.MAX_DEPTH,
        APP_CONFIG.CRAWLER.DEFAULT_DEPTH,
      );
      const file = fileInput?.files?.[0];

      if (!rawSeed && !file) {
        throw new Error(
          "Please provide a seed OApp ID to crawl or select a web data JSON file to load.",
        );
      }

      // The seed can come from the URL and auto-runs, so validate before crawling.
      const seedOAppId = rawSeed ? normalizeSeedOAppId(rawSeed) : "";
      if (seedOAppId && seedOAppIdInput) {
        seedOAppIdInput.value = seedOAppId;
      }
      if (depthInput && String(depth) !== depthInput.value) {
        depthInput.value = String(depth);
      }

      const mode = seedOAppId ? "crawl" : "upload";

      if (file && seedOAppIdInput) {
        seedOAppIdInput.value = "";
      }

      return {
        variables: {
          seedOAppId: seedOAppId || null,
          depth,
        },
        meta: {
          limitLabel: seedOAppId ? `seed=${seedOAppId}` : "web-of-security",
          summary: seedOAppId || "Web of Security",
        },
        mode,
        file,
        seedOAppId,
        depth,
      };
    },

    execute: async (request, context) => {
      if (request.mode === "crawl") {
        const seed = request.seedOAppId;
        if (!seed) {
          throw new Error("Seed OApp ID required for crawl.");
        }
        const { SecurityGraphCrawler } = await import("../../../crawler.js");
        context.setStatus("Crawling...", "loading");
        const crawler = new SecurityGraphCrawler(context.client, context.chainMetadata);
        const webData = await crawler.crawl(seed, {
          depth: request.depth,
          onProgress: (status) => context.setStatus(status, "loading"),
        });
        return { webData };
      }

      const file = request.file;
      if (!file) {
        throw new Error("Web data file missing.");
      }
      const text = await file.text();
      const webData = JSON.parse(text);
      return { webData };
    },

    processResponse: async (payload, meta) => {
      const webData = payload?.webData;
      if (!webData) {
        throw new Error("Invalid web data format");
      }

      return {
        rows: [],
        meta: {
          ...meta,
          webData,
          resultLabel: "Web of Security",
          renderMode: "graph",
        },
      };
    },
  };
}
