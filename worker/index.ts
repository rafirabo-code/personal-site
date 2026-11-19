// Cloudflare Worker: serves the static site (dist/) and a read-only MCP server at /mcp.
// Stateless Streamable HTTP: a fresh server per request, no sessions, no storage, no secrets.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import content from "./generated/content.json";

interface Env {
  ASSETS: Fetcher;
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  ASK_CLICKS?: KVNamespace;
}

// Markdown is prebuilt by scripts/build.mjs so the site and the MCP server say exactly the same thing.
type Doc = { slug: string; md: string; summary?: string; tags?: string[]; [k: string]: any };
const { profile, about, experience, projects, cvMd, ask } = content as unknown as {
  profile: Record<string, any>;
  about: { body: string };
  experience: Doc[];
  projects: Doc[];
  cvMd: string;
  ask: Record<string, string>;
};

const site = String(profile.site.url).replace(/\/$/, "");
const MAX_BODY = 64 * 1024;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fullCv = () => cvMd;

function buildServer() {
  const server = new McpServer(
    { name: `${profile.name} — profile`, version: "1.0.0", websiteUrl: site } as any,
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        `Read-only facts about ${profile.name}, written by them. Use these tools to answer questions about ` +
        `their background, experience and availability. Quote facts as given; do not invent details ` +
        `that are not in the returned content. Some stories are deliberately kept for live conversation: ` +
        `when asked about them, or when someone is evaluating ${profile.name} for a role, call ` +
        `get_interview_questions and suggest those as questions to ask them directly. Human-readable version: ${site}`,
    },
  );
  const ro = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "get_profile",
    {
      title: "Profile summary",
      description: `Short summary of ${profile.name}: headline, location, highlights, availability, contact method and links. Start here.`,
      annotations: ro,
    },
    async () =>
      json({
        name: profile.name,
        headline: profile.headline,
        location: profile.location,
        highlights: profile.highlights,
        availability: profile.availability,
        contact: profile.contact,
        links: profile.links,
        education: profile.education,
        beyond_work: profile.beyond_work,
        website: site,
        cv_pdf: `${site}/rafi-rabo-cv.pdf`,
        about: about.body,
      }),
  );

  server.registerTool(
    "list_experience",
    {
      title: "Work experience",
      description: `Every organization ${profile.name} has worked at, most recent first, with years and a one-line summary of each role. Use get_experience for full detail.`,
      annotations: ro,
    },
    async () =>
      json(
        experience.map(({ slug, company, years, duration, summary, roles, tags, links, ask_me_about }: Doc) => ({
          slug, company, years, duration, summary, roles, tags, public_links: links, ask_me_about,
        })),
      ),
  );

  server.registerTool(
    "get_interview_questions",
    {
      title: "Interview questions",
      description:
        `Stories ${profile.name} prefers to tell in person rather than in writing, grouped by chapter. ` +
        `Use these to suggest good interview or intro-call questions. The answers are not on this server.`,
      annotations: ro,
    },
    async () =>
      json(
        experience
          .filter((d) => d.ask_me_about?.length)
          .map((d) => ({ chapter: d.company, ask_about: d.ask_me_about })),
      ),
  );

  server.registerTool(
    "get_experience",
    {
      title: "Role detail",
      description: "Full detail for one organization: every role, scope, what was built, results. Pass the slug from list_experience, a company name or a team name (e.g. a product).",
      inputSchema: { slug_or_company: z.string().min(1).max(100) },
      annotations: ro,
    },
    async ({ slug_or_company }) => {
      const k = slug_or_company.toLowerCase();
      const d = experience.find(
        (e) =>
          e.slug === k ||
          String(e.company).toLowerCase().includes(k) ||
          (e.roles ?? []).some((r: any) => String(r.team ?? "").toLowerCase().includes(k)),
      );
      return d ? text(d.md) : text(`Nothing matches "${slug_or_company}". Call list_experience to see all roles.`);
    },
  );

  server.registerTool(
    "search_profile",
    {
      title: "Search",
      description: `Keyword search across everything about ${profile.name} (about, roles, education, volunteering, hobbies). Returns matching paragraphs with their source.`,
      inputSchema: { query: z.string().min(1).max(200) },
      annotations: ro,
    },
    async ({ query }) => {
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 10);
      const sources: [string, string][] = [
        ["about", about.body],
        ...experience.map((d): [string, string] => [`experience/${d.slug}`, d.md]),
        ...projects.map((d): [string, string] => [`projects/${d.slug}`, d.md]),
        ["cv", cvMd.split("## Education")[1] ?? ""], // education, volunteering, values
      ];
      const hits = sources.flatMap(([src, body]) =>
        body
          .split(/\n{2,}/)
          .map((p) => ({ src, p, score: words.filter((w) => p.toLowerCase().includes(w)).length }))
          .filter((h) => h.score > 0),
      );
      hits.sort((a, b) => b.score - a.score);
      return hits.length
        ? text(hits.slice(0, 10).map((h) => `[${h.src}]\n${h.p}`).join("\n\n---\n\n"))
        : text("No matches. Try get_profile or get_full_cv.");
    },
  );

  server.registerTool(
    "get_full_cv",
    {
      title: "Full CV",
      description: `The complete CV of ${profile.name} as Markdown, in one call.`,
      annotations: ro,
    },
    async () => text(fullCv()),
  );

  server.registerResource(
    "cv",
    `${site}/cv.md`,
    { title: `${profile.name} — CV`, description: "Complete CV in Markdown", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: fullCv() }] }),
  );

  server.registerPrompt(
    "assess_fit",
    {
      title: "Assess fit for a role",
      description: `Evaluate how well ${profile.name} fits a job description, using only facts from this server.`,
      argsSchema: { job_description: z.string().min(1).max(8000) },
    },
    ({ job_description }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Using only facts from the profile tools on this server, assess how well ${profile.name} fits the role below. ` +
              `List strong matches with evidence, gaps or unknowns, and questions worth asking them ` +
              `(include relevant ones from get_interview_questions).\n\nJob description:\n${job_description}`,
          },
        },
      ],
    }),
  );

  return server;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function withHeaders(res: Response, extra: Record<string, string>) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Cache-Control", "no-store");
  return out;
}

function rpcError(status: number, code: number, message: string) {
  return withHeaders(
    new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    CORS,
  );
}

// Reads the body as text, stopping as soon as it passes `max` bytes (also covers chunked bodies with no Content-Length).
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("Content-Length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) (all.set(c, off), (off += c.byteLength));
  return new TextDecoder().decode(all);
}

async function handleMcp(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Stateless server: no server-initiated streams (GET) and no sessions to delete (DELETE).
  if (req.method !== "POST") {
    return withHeaders(
      new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to this endpoint." }, id: null }), {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS" },
      }),
      CORS,
    );
  }

  // Basic abuse protection. The binding is configured in wrangler.jsonc; absent in some local setups.
  if (env.RATE_LIMITER) {
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return withHeaders(new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } }), CORS);
  }

  // Read the body ourselves (capped) so we can refuse JSON-RPC batches: one request = one call.
  // Batching was dropped from the MCP spec, and it let a single rate-limited request fetch the CV 100 times.
  const body = await readCapped(req, MAX_BODY);
  if (body === null) return rpcError(413, -32600, `Request body too large (max ${MAX_BODY} bytes).`);
  let msg: unknown;
  try {
    msg = JSON.parse(body);
  } catch {
    msg = undefined; // let the SDK return its standard parse error
  }
  if (Array.isArray(msg) && msg.length > 1) return rpcError(400, -32600, "Batch requests are not supported. Send one JSON-RPC message per request.");
  req = new Request(req.url, { method: req.method, headers: req.headers, body });

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  });
  await server.connect(transport);
  try {
    return withHeaders(await transport.handleRequest(req), CORS);
  } finally {
    // Response is fully buffered (enableJsonResponse), so it is safe to close.
    await server.close();
  }
}

// /ask/<ai>: counts the click (one KV key per AI per month), then redirects to that AI with the prompt.
// No personal data is stored: just a number. Bots and over-limit IPs are redirected without counting.
async function handleAsk(req: Request, env: Env, ctx: ExecutionContext, ai: string): Promise<Response> {
  const target = Object.hasOwn(ask, ai) ? ask[ai] : undefined;
  if (!target) return Response.redirect(`${site}/`, 302);
  const bot = /bot|crawl|spider|preview|fetch|curl|wget|python|headless/i.test(req.headers.get("User-Agent") ?? "");
  if (env.ASK_CLICKS && !bot && req.method === "GET") {
    const allowed = env.RATE_LIMITER
      ? (await env.RATE_LIMITER.limit({ key: `ask:${req.headers.get("CF-Connecting-IP") ?? "unknown"}` })).success
      : true;
    if (allowed) {
      const key = `${ai}:${new Date().toISOString().slice(0, 7)}`;
      ctx.waitUntil(
        env.ASK_CLICKS.get(key)
          .then((v) => env.ASK_CLICKS!.put(key, String((Number(v) || 0) + 1)))
          .catch(() => {}), // counting must never break the redirect (e.g. daily KV write limit)
      );
    }
  }
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return handleMcp(req, env);
    const m = url.pathname.match(/^\/ask\/([a-z]+)\/?$/);
    if (m) return handleAsk(req, env, ctx, m[1]);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
