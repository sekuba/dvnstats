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

      const seedOAppId = seedOAppIdInput?.value?.trim();
      const depth = parseInt(depthInput?.value) || 10;
      const file = fileInput?.files?.[0];

      if (!seedOAppId && !file) {
        throw new Error(
          "Please provide a seed OApp ID to crawl or select a web data JSON file to load.",
        );
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
