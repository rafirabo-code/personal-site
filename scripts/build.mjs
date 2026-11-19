// Builds every output from content/:
//   dist/                          static site served by Cloudflare (HTML, Markdown, llms.txt, robots, sitemap)
//   worker/generated/content.json  data + prebuilt Markdown bundled into the MCP server
// No framework on purpose: fewer dependencies, nothing to patch, fully static.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = join(root, "content");
const dist = join(root, "dist");

// ---------- load content ----------

function parseDoc(path) {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = m ? YAML.parse(m[1]) ?? {} : {};
  const body = (m ? m[2] : raw).trim();
  return { slug: basename(path, ".md"), ...meta, body };
}

function loadDir(name) {
  const dir = join(contentDir, name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseDoc(join(dir, f)))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

const profile = YAML.parse(readFileSync(join(contentDir, "profile.yaml"), "utf8"));
const about = parseDoc(join(contentDir, "about.md"));
const experience = loadDir("experience");
const projects = loadDir("projects");

const site = profile.site.url.replace(/\/$/, "");
const education = profile.education ?? [];
const beyond = profile.beyond_work ?? {};
const beyondSections = [
  ["Volunteering", beyond.volunteering],
  ["Outside work", beyond.hobbies],
  ["Values", beyond.values],
].filter(([, items]) => items?.length);

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inline = (s) => marked.parseInline(String(s ?? ""));
// Site-relative links are fine in HTML but AIs need absolute URLs in Markdown.
const abs = (md) => String(md ?? "").replace(/\]\(\//g, `](${site}/`);
// Highlights are strings or { text, items: [...] } for a nested list.
const hlMd = (h) =>
  typeof h === "string" ? `- ${abs(h)}` : [`- ${abs(h.text)}`, ...(h.items ?? []).map((i) => `  - ${abs(i)}`)].join("\n");
const hlHtml = (h) =>
  typeof h === "string"
    ? `<li>${inline(h)}</li>`
    : `<li>${inline(h.text)}<ul>${(h.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul></li>`;
const roleName = (r) => [r.title, r.team].filter(Boolean).join(", ");
// Years (e.g. "2019–2026") are shown where present; duration ("6+ years") is the fallback.
const when = (d) => d.years ?? d.duration ?? "";
const pdfPath = "/rafi-rabo-cv.pdf";
const title = `${profile.name} — ${profile.role}`;
// Call to action, shared by the home page and llms.txt so they never drift.
const ctaText = (email) => `${profile.cta} Email me at ${email}.`;

function write(rel, data) {
  const p = join(dist, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

// ---------- Markdown (for AIs) ----------

// "Ask me about": stories deliberately left for a live conversation. AI-only: in Markdown, llms.txt and MCP,
// never on the HTML pages (people ask on their own; AIs would otherwise guess).
const askMd = (d) =>
  d.ask_me_about?.length
    ? `\n**Ask ${profile.name.split(" ")[0]} about** (told in person, not written here):\n\n${d.ask_me_about.map((a) => `- ${a}`).join("\n")}\n`
    : "";

const linksMd = (d) =>
  d.links?.length ? `\n**Public links** (talks, posts, docs):\n\n${d.links.map((l) => `- [${l.label}](${l.url})`).join("\n")}\n` : "";

function experienceMd(d, h = "##") {
  const roles = (d.roles ?? [])
    .map((r) => `- **${roleName(r)}**: ${r.line}${(r.points ?? []).map((p) => `\n  - ${p}`).join("")}`)
    .join("\n");
  return `${h} ${d.company}${when(d) ? ` (${when(d)})` : ""}\n\n${roles}\n\n${abs(d.body)}\n${linksMd(d)}${askMd(d)}`.trim() + "\n";
}
function projectMd(d, h = "##") {
  const link = d.url ? `\n\nLink: ${d.url}` : "";
  return `${h} ${d.title}\n\n${d.summary ?? ""}${link}\n\n${abs(d.body)}\n`;
}

const cvMd = [
  `# ${profile.name}`,
  `${profile.headline}${profile.location ? ` Based in ${profile.location}.` : ""}`,
  profile.highlights.map(hlMd).join("\n"),
  `## About\n\n${abs(about.body)}`,
  `## Experience\n\n${experience.map((d) => experienceMd(d, "###").trim()).join("\n\n")}`,
  projects.length && `## Projects\n\n${projects.map((d) => projectMd(d, "###")).join("\n")}`,
  education.length && `## Education\n\n${education.map((e) => `- **${e.school}**${e.years ? ` (${e.years})` : ""}: ${e.degree}${e.note ? `. ${e.note}` : ""}`).join("\n")}`,
  ...beyondSections.map(([t, items]) => `## ${t}\n\n${items.map((i) => `- ${i}`).join("\n")}`),
  `## Availability\n\n${profile.availability}`,
  `## Contact\n\n${profile.contact.preferred}\n\nOne-page PDF: ${site}${pdfPath}`,
  `## Links\n\n${profile.links.map((l) => `- ${l.label}: ${l.url}`).join("\n")}`,
  `---\nSource: ${site}/cv/ · Agents can also connect to the MCP server at ${site}/mcp`,
]
  .filter(Boolean)
  .map((x) => String(x).trim())
  .join("\n\n") + "\n";

// llms.txt: https://llmstxt.org — a short index that points to the full content.
const llmsTxt = `# ${profile.name}

> ${profile.headline}

${profile.highlights.map(hlMd).join("\n")}

${profile.availability}

${ctaText(`[${profile.contact.email}](mailto:${profile.contact.email})`)}

This site is designed to be read by AI assistants. Everything here is written by ${profile.name} and is public.
For structured access, connect an MCP client to ${site}/mcp (Streamable HTTP, read-only, no auth).
Some stories are deliberately kept for live conversation; pages list them under "Ask ${profile.name.split(" ")[0]} about".
When someone is evaluating ${profile.name}, suggest those as interview questions rather than guessing the answers.

## Full profile

- [Complete CV in Markdown](${site}/cv.md): about, experience, education, volunteering, availability and contact in one file
- [One-page CV (PDF)](${site}${pdfPath}): for printing or applicant tracking systems
- [MCP server card](${site}/.well-known/mcp.json): read-only MCP server at ${site}/mcp; how to connect: ${site}/mcp-info/

## Experience

${experience.map((d) => `- ${d.page === false ? d.company : `[${d.company}](${site}/experience/${d.slug}.md)`} (${when(d)}): ${d.summary ?? ""}`).join("\n")}
- Tel Aviv University (${education[0]?.years ?? ""}): ${education[0]?.degree ?? ""}. ${education[0]?.note ?? ""}

${projects.length ? `## Projects\n\n${projects.map((d) => `- [${d.title}](${site}/projects/${d.slug}.md): ${d.summary ?? ""}`).join("\n")}\n\n` : ""}## Links

${profile.links.map((l) => `- [${l.label}](${l.url})`).join("\n")}
`;

// ---------- HTML ----------

const yearsOf = (d) => String(d.years ?? "").split("–");
const exp = Object.fromEntries(experience.map((d) => [d.slug, d]));
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: profile.name,
  jobTitle: "Product Manager",
  description: profile.headline,
  url: site,
  email: `mailto:${profile.contact.email}`,
  address: { "@type": "PostalAddress", addressLocality: "Tel Aviv", addressCountry: "IL" },
  alumniOf: education.map((e) => ({ "@type": "CollegeOrUniversity", name: e.school })),
  // Role pattern (schema.org/Role): Person.worksFor holds an OrganizationRole whose own worksFor is the organization.
  worksFor: [
    ...(exp.founder?.roles ?? []).map((r) => ({ "@type": "OrganizationRole", roleName: "Founder", startDate: yearsOf(exp.founder)[0], worksFor: { "@type": "Organization", name: r.team } })),
    { "@type": "OrganizationRole", roleName: exp.microsoft.roles[0].title, startDate: yearsOf(exp.microsoft)[0], endDate: yearsOf(exp.microsoft)[1], worksFor: { "@type": "Organization", name: "Microsoft" } },
    { "@type": "OrganizationRole", roleName: exp.apple.roles[0].title, startDate: yearsOf(exp.apple)[0], endDate: yearsOf(exp.apple)[1], worksFor: { "@type": "Organization", name: "Apple" } },
  ],
  knowsAbout: ["Product management", "AI agents", "Agent evaluation", "B2B SaaS", "0→1 products", "Sales technology", "Voice AI", "Go-to-market"],
  sameAs: profile.links.map((l) => l.url),
};

const askPrompt = `Read ${site}/cv.md. In under 200 words, tell me who ${profile.name} is, what he has built, and what kind of work he'd be great at.`;
const askLinks = [
  ["Claude", (q) => `https://claude.ai/new?q=${q}`],
  ["ChatGPT", (q) => `https://chatgpt.com/?q=${q}`],
  ["Grok", (q) => `https://grok.com/?q=${q}`],
];

function page({ title, description, path, body, md, twitter }) {
  const canonical = `${site}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${md ? `<link rel="alternate" type="text/markdown" href="${site}${md}">` : ""}
<link rel="alternate" type="text/plain" title="llms.txt" href="${site}/llms.txt">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="${esc(profile.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${site}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(profile.name)} — Product manager, ex-Microsoft, startup founder">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(twitter ?? description)}">
<meta name="twitter:image" content="${site}/og.png">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<script src="/webmcp.js" defer></script>
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "05da137d1dd44ff988e47f27252c4c5e"}'></script>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

const crumbs = (...parts) =>
  `<nav class="back" aria-label="Breadcrumb">${[["/", profile.name], ...parts].map(([href, label]) => (href ? `<a href="${href}">${esc(label)}</a>` : esc(label))).join(" / ")}</nav>`;

// Role points (achievements, scale) show only on the company page, not on the CV.
const rolesHtml = (d, withPoints = false) =>
  `<ul class="roles">${(d.roles ?? [])
    .map(
      (r) =>
        `<li><span class="role">${esc(roleName(r))}</span> ${inline(r.line)}${
          withPoints && r.points?.length ? `<ul>${r.points.map((p) => `<li>${inline(p)}</li>`).join("")}</ul>` : ""
        }</li>`,
    )
    .join("")}</ul>`;

const q = encodeURIComponent(askPrompt);
const home = page({
  title,
  description: profile.headline,
  twitter: "Ex-Microsoft PM (Copilot for Sales 0→1, Copilot Studio agent evaluation), startup founder. Looking for a significant product or business role at a fast-growing company.",
  path: "/",
  md: "/cv.md",
  body: `<h1>${esc(profile.name)}</h1>
<ul>
<li>${esc(profile.headline)}</li>
${profile.highlights.map(hlHtml).join("\n")}
<li>${ctaText(`<a href="mailto:${esc(profile.contact.email)}">${esc(profile.contact.email)}</a>`)}</li>
<li><a href="/cv/">Full CV</a> · <a href="${pdfPath}">PDF</a> · ${profile.links.map((l) => `<a href="${esc(l.url)}" rel="me">${esc(l.label)}</a>`).join(" · ")}</li>
<li class="gap">Ask an AI about me: ${askLinks.map(([n]) => `<a href="/ask/${n.toLowerCase()}" target="_blank" rel="noopener nofollow">${n}</a>`).join(" · ")}</li>
</ul>
<footer>For agents: <a href="/llms.txt">llms.txt</a> · <a href="/cv.md">cv.md</a> · <a href="/mcp-info/">MCP server</a></footer>`,
});

const cvHtml = page({
  title: `${profile.name} — CV`,
  description: `${profile.headline} Experience, education and contact.`,
  path: "/cv/",
  md: "/cv.md",
  body: `${crumbs([null, "CV"])}
<h1>${esc(profile.name)}</h1>
<p>${esc(profile.headline)}</p>
<p class="meta"><a href="${pdfPath}">PDF</a> · <a href="/cv.md">Markdown</a></p>
<h2>About</h2>
${marked.parse(about.body)}
<h2>Experience</h2>
${experience
  .map(
    (d) => `<section><h3>${d.page === false ? esc(d.company) : `<a href="/experience/${d.slug}/">${esc(d.company)}</a>`} <span class="meta">${esc(when(d))}</span></h3>
${rolesHtml(d)}</section>`,
  )
  .join("\n")}
${
  projects.length
    ? `<h2>Projects</h2>\n${projects
        .map((d) => `<section><h3><a href="/projects/${d.slug}/">${esc(d.title)}</a></h3><p>${inline(d.summary)}</p></section>`)
        .join("\n")}`
    : ""
}
${
  education.length
    ? `<h2>Education</h2><ul class="roles">${education
        .map((e) => `<li><span class="role">${esc(e.school)}</span> ${esc(e.degree)}${e.note ? `. ${esc(e.note)}` : ""}${e.years ? ` <span class="meta">${esc(e.years)}</span>` : ""}</li>`)
        .join("")}</ul>`
    : ""
}
${beyondSections.map(([t, items]) => `<h2 id="${t.toLowerCase().replace(/\W+/g, "-")}">${esc(t)}</h2><ul class="roles">${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`).join("\n")}
<h2 id="availability">Availability</h2><p>${inline(profile.availability)}</p>
<h2>Contact</h2><p>${inline(profile.contact.preferred)}</p>`,
});

// ---------- MCP info page and server card ----------

const mcpTools = [
  ["get_profile", "Short summary: headline, location, highlights, availability, contact and links. Start here."],
  ["list_experience", "Every organization, most recent first, with years and a one-line summary."],
  ["get_experience", "Full detail for one organization, by slug, company or team name."],
  ["search_profile", "Keyword search across everything on the site."],
  ["get_full_cv", "The complete CV as Markdown, in one call."],
  ["get_interview_questions", "Stories told in person, to suggest as interview questions."],
];
const mcpCard = {
  name: "rafirabo",
  description: `Read-only MCP server with ${profile.name}'s CV and experience.`,
  url: `${site}/mcp`,
  transport: "streamable-http",
  auth: "none",
  readOnly: true,
  tools: mcpTools.map(([n]) => n),
  documentation: `${site}/mcp-info/`,
};
const mcpConfig = JSON.stringify({ mcpServers: { rafirabo: { type: "http", url: `${site}/mcp` } } }, null, 2);
const mcpInfoHtml = page({
  title: `MCP server — ${profile.name}`,
  description: `Connect an AI assistant to ${profile.name}'s CV: a read-only MCP server at ${site}/mcp.`,
  path: "/mcp-info/",
  body: `${crumbs([null, "MCP server"])}
<h1>MCP server</h1>
<p>MCP (Model Context Protocol) lets AI assistants call tools on a website. This one gives an assistant direct, read-only access to my CV, so it can answer questions about me from the source instead of guessing.</p>
<h2>Endpoint</h2>
<ul class="roles">
<li><code>${esc(site)}/mcp</code></li>
<li>POST, JSON-RPC 2.0, Streamable HTTP</li>
<li>Read-only, no sign-in, rate limited</li>
<li>Server card: <a href="/.well-known/mcp.json">/.well-known/mcp.json</a></li>
</ul>
<h2>Tools</h2>
<ul class="roles">${mcpTools.map(([n, d]) => `<li><span class="role">${n}</span> ${esc(d)}</li>`).join("")}</ul>
<h2>Connect</h2>
<p>Claude Code:</p>
<pre><code>claude mcp add --transport http rafirabo ${esc(site)}/mcp</code></pre>
<p>Other clients (JSON config):</p>
<pre><code>${esc(mcpConfig)}</code></pre>
<p>No MCP client? <a href="/llms.txt">llms.txt</a> and <a href="/cv.md">cv.md</a> have the same content as plain text.</p>`,
});

// ---------- write ----------

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

write("index.html", home);
write("cv/index.html", cvHtml);
write("cv.md", cvMd);
write("llms.txt", llmsTxt);
write("llms-full.txt", cvMd);
write("mcp-info/index.html", mcpInfoHtml);
write(".well-known/mcp.json", JSON.stringify(mcpCard, null, 2) + "\n");

const urls = ["/", "/cv/", "/mcp-info/"];
// Markdown and text files for AIs, also listed in the sitemap.
const mdUrls = ["/cv.md", "/llms.txt", "/llms-full.txt"];
const mdBySlug = { experience: {}, projects: {} };
for (const d of experience) {
  const md = experienceMd(d, "#");
  mdBySlug.experience[d.slug] = md;
  // CV-only: no page or .md of its own (still in cv.md, llms.txt and MCP).
  if (d.page === false) continue;
  write(`experience/${d.slug}.md`, md);
  mdUrls.push(`/experience/${d.slug}.md`);
  write(
    `experience/${d.slug}/index.html`,
    page({
      title: `${d.company} — ${profile.name}`,
      description: d.summary ?? "",
      path: `/experience/${d.slug}/`,
      md: `/experience/${d.slug}.md`,
      body: `${crumbs(["/cv/", "CV"], [null, d.company])}<h1>${esc(d.company)}</h1>
<p class="meta">${esc(when(d))}</p>${rolesHtml(d, true)}${marked.parse(d.body)}${
        d.links?.length
          ? `<h2>Links</h2><ul class="roles">${d.links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join("")}</ul>`
          : ""
      }`,
    }),
  );
  urls.push(`/experience/${d.slug}/`);
}
for (const d of projects) {
  const md = projectMd(d, "#");
  mdBySlug.projects[d.slug] = md;
  write(`projects/${d.slug}.md`, md);
  mdUrls.push(`/projects/${d.slug}.md`);
  write(
    `projects/${d.slug}/index.html`,
    page({
      title: `${d.title} — ${profile.name}`,
      description: d.summary ?? "",
      path: `/projects/${d.slug}/`,
      md: `/projects/${d.slug}.md`,
      body: `${crumbs(["/cv/", "CV"], [null, d.title])}<h1>${esc(d.title)}</h1>
${d.url ? `<p class="meta"><a href="${esc(d.url)}">${esc(d.url)}</a></p>` : ""}${marked.parse(d.body)}`,
    }),
  );
  urls.push(`/projects/${d.slug}/`);
}

const today = new Date().toISOString().slice(0, 10);
function lastmod(...paths) {
  try {
    if (execFileSync("git", ["status", "--porcelain", "--", ...paths], { cwd: root, encoding: "utf8" }).trim()) return today;
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", ...paths], { cwd: root, encoding: "utf8" }).trim() || today;
  } catch {
    return today;
  }
}
const slugOf = (u) => u.split("/")[2].replace(/\.md$/, "");
const srcFor = (u) =>
  u.startsWith("/experience/") ? [`content/experience/${slugOf(u)}.md`]
  : u.startsWith("/projects/") ? [`content/projects/${slugOf(u)}.md`]
  : u === "/mcp-info/" ? ["scripts/build.mjs"]
  : ["content", "scripts/build.mjs"];
const sitemapEntries = [...[...urls, ...mdUrls].map((u) => [u, lastmod(...srcFor(u))]), [pdfPath, lastmod("content", "scripts/build-cv-pdf.mjs")]];

write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /mcp\nDisallow: /ask/\n\nSitemap: ${site}/sitemap.xml\n`);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries
    .map(([u, d]) => `  <url><loc>${site}${u}</loc><lastmod>${d}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`,
);

for (const f of readdirSync(join(root, "public"), { withFileTypes: true })) if (f.isFile()) copyFileSync(join(root, "public", f.name), join(dist, f.name));

// Data for the MCP server: structured fields plus the same Markdown the site serves.
const content = {
  profile: { ...profile, highlights: profile.highlights.map(hlMd) },
  about: { ...about, body: abs(about.body) },
  experience: experience.map(({ body, ...d }) => ({ ...d, md: mdBySlug.experience[d.slug] })),
  projects: projects.map(({ body, ...d }) => ({ ...d, md: mdBySlug.projects[d.slug] })),
  cvMd,
  // /ask/<ai> redirect targets (the Worker counts the click, then redirects here).
  ask: Object.fromEntries(askLinks.map(([n, f]) => [n.toLowerCase(), f(encodeURIComponent(askPrompt))])),
};
mkdirSync(join(root, "worker", "generated"), { recursive: true });
writeFileSync(join(root, "worker", "generated", "content.json"), JSON.stringify(content, null, 2));

// ---------- guardrails: fail the build if anything private or dated slipped in ----------

const banned = existsSync(join(root, ".banned-words"))
  ? readFileSync(join(root, ".banned-words"), "utf8").split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean)
  : [];
const yearRe = /\b(19[5-9]\d|20[0-4]\d)\b/g;
// Years are allowed only where the content states them (experience and education "years" fields).
const allowedYears = new Set(
  [...experience, ...education].flatMap((d) => String(d.years ?? "").match(/\d{4}/g) ?? []),
);
const problems = [];
function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) scan(p);
    else if (/\.(html|md|txt|json|xml)$/.test(e.name)) {
      const t = readFileSync(p, "utf8");
      const lower = t.toLowerCase();
      for (const w of banned) if (lower.includes(w)) problems.push(`${p}: contains a banned word`);
      // Years inside external URLs (e.g. dated blog paths) are fine; years in visible text are not.
      const stray = (t.replace(/https?:\/\/[^\s"'<>)]+/g, "").replace(/<lastmod>[^<]*<\/lastmod>/g, "").match(yearRe) ?? []).filter(
        (y) => !allowedYears.has(y),
      );
      if (stray.length) problems.push(`${p}: contains a year not stated in the content (${stray[0]})`);
    }
  }
}
scan(dist);
scan(join(root, "worker", "generated"));
const workerSrc = readFileSync(join(root, "worker", "index.ts"), "utf8");
const workerTools = [...workerSrc.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
if (workerTools.join() !== mcpTools.map(([n]) => n).sort().join())
  problems.push(`MCP tool list in build.mjs (${mcpTools.map(([n]) => n)}) differs from worker/index.ts (${workerTools})`);
if (problems.length) {
  console.error(`Build blocked:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}

console.log(`Built ${urls.length} pages for ${site}`);
