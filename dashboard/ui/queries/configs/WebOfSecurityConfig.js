/**
 * Web of Security Query Configuration
 * Crawl or load the security graph for an OApp
 */

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

      const isCrawl = !!seedOAppId;

      if (file && seedOAppIdInput) {
        seedOAppIdInput.value = "";
      }

      return {
        variables: {
          seedOAppId,
          depth,
          file: isCrawl ? null : file,
          isCrawl,
        },
        meta: {
          limitLabel: seedOAppId ? `seed=${seedOAppId}` : "web-of-security",
          summary: seedOAppId || "Web of Security",
        },
      };
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
