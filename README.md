# personal-site

A deliberately short personal site, built for three readers from one content source:

| Reader | What they get |
|---|---|
| Humans | A minimal homepage, a CV page and a page per role and project |
| Search and AI assistants | Server-rendered HTML, JSON-LD (`schema.org/Person`), `llms.txt`, Markdown copies of every page, sitemap |
| Agents | A read-only MCP server at `/mcp`, WebMCP tools on the page, and "Ask about me in Claude / ChatGPT / Grok" links |

## Layout

```
content/          ← the only place you edit (profile.yaml + Markdown)
scripts/build.mjs ← generates dist/ and worker/generated/content.json
public/           ← CSS, WebMCP script, security headers
worker/index.ts   ← Cloudflare Worker: /mcp (MCP server), everything else static
```

## Commands

```bash
npm install
npm run dev        # build + local server at http://localhost:8787
npm run typecheck
npm run deploy     # build + deploy to Cloudflare (run `npx wrangler login` once first)
```

## Connecting an MCP client

Streamable HTTP, no auth: `https://<your-site>/mcp`

```bash
claude mcp add --transport http profile https://<your-site>/mcp
```

Tools: `get_profile`, `list_experience`, `get_experience`,
`search_profile`, `get_full_cv`. Prompt: `assess_fit`. Resource: the full CV.

## Content guidelines

- Short, plain sentences. Concrete facts, numbers and decisions over adjectives.
- Lead with the customer and the business: who, what problem, why they'd pay. Technology last.
- Honest about what didn't work, without spin or blame.
- Durations, not dates.
- Some stories stay for live conversation and are listed under "Ask me about".
- Nothing is invented. Everything in `content/` is public.

## Security model

- Everything served is public, read-only content from `content/`. No database, no secrets, no LLM calls.
- `/mcp` is stateless, accepts POST only, caps request bodies at 64 KB, validates tool input,
  and is rate-limited per IP.
- Static pages ship a strict Content-Security-Policy and standard hardening headers.
