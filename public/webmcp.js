// WebMCP (experimental): exposes read-only tools to AI agents running in the visitor's browser.
// Does nothing in browsers without navigator.modelContext. The API is still a draft, so both
// known shapes are feature-detected and any failure is swallowed.
(function () {
  const mc = typeof navigator !== "undefined" && navigator.modelContext;
  if (!mc) return;

  let cache;
  const load = () => (cache ??= fetch("/cv.md").then((r) => r.text()));
  const text = (t) => ({ content: [{ type: "text", text: t }] });

  const tools = [
    {
      name: "get_cv",
      description:
        "Return the complete CV of the person this website belongs to, in Markdown: about, experience, projects, availability and contact. Read-only.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => text(await load()),
    },
    {
      name: "search_cv",
      description:
        "Search the CV of the person this website belongs to and return matching paragraphs. Read-only.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Words to look for", maxLength: 200 } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
      execute: async ({ query }) => {
        const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
        const parts = (await load()).split(/\n{2,}/);
        const hits = parts.filter((p) => words.some((w) => p.toLowerCase().includes(w)));
        return text(hits.length ? hits.slice(0, 12).join("\n\n") : "No matches. Try get_cv for everything.");
      },
    },
  ];

  try {
    if (typeof mc.registerTool === "function") tools.forEach((t) => mc.registerTool(t));
    else if (typeof mc.provideContext === "function") mc.provideContext({ tools });
  } catch (_) {
    /* draft API changed; ignore */
  }
})();
