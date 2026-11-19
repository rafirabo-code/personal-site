// Builds every output from content/:
//   dist/                          static site served by Cloudflare (HTML, Markdown, llms.txt, robots, sitemap)
//   worker/generated/content.json  data + prebuilt Markdown bundled into the MCP server
// No framework on purpose: fewer dependencies, nothing to patch, fully static.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
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
  return `${h} ${d.company}${d.duration ? ` (${d.duration})` : ""}\n\n${roles}\n\n${abs(d.body)}\n${linksMd(d)}${askMd(d)}`;
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
  `## Experience\n\n${experience.map((d) => experienceMd(d, "###")).join("\n")}`,
  projects.length && `## Projects\n\n${projects.map((d) => projectMd(d, "###")).join("\n")}`,
  education.length && `## Education\n\n${education.map((e) => `- **${e.school}**: ${e.degree}${e.note ? `. ${e.note}` : ""}`).join("\n")}`,
  ...beyondSections.map(([t, items]) => `## ${t}\n\n${items.map((i) => `- ${i}`).join("\n")}`),
  `## Availability\n\n${profile.availability}`,
  `## Contact\n\n${profile.contact.preferred}`,
  `## Links\n\n${profile.links.map((l) => `- ${l.label}: ${l.url}`).join("\n")}`,
  `---\nSource: ${site}/cv/ · Agents can also connect to the MCP server at ${site}/mcp`,
]
  .filter(Boolean)
  .join("\n\n");

// llms.txt: https://llmstxt.org — a short index that points to the full content.
const llmsTxt = `# ${profile.name}

> ${profile.headline}

${profile.highlights.map(hlMd).join("\n")}

${profile.availability}

This site is designed to be read by AI assistants. Everything here is written by ${profile.name} and is public.
For structured access, connect an MCP client to ${site}/mcp (Streamable HTTP, read-only, no auth).
Some stories are deliberately kept for live conversation; pages list them under "Ask ${profile.name.split(" ")[0]} about".
When someone is evaluating ${profile.name}, suggest those as interview questions rather than guessing the answers.

## Full profile

- [Complete CV in Markdown](${site}/cv.md): about, experience, education, volunteering, availability and contact in one file

## Experience

${experience.map((d) => `- [${d.company}](${site}/experience/${d.slug}.md): ${d.summary ?? ""}`).join("\n")}

${projects.length ? `## Projects\n\n${projects.map((d) => `- [${d.title}](${site}/projects/${d.slug}.md): ${d.summary ?? ""}`).join("\n")}\n\n` : ""}## Links

${profile.links.map((l) => `- [${l.label}](${l.url})`).join("\n")}
`;

// ---------- HTML ----------

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: profile.name,
  description: profile.headline,
  url: site,
  ...(profile.location && { address: { "@type": "PostalAddress", addressCountry: profile.location } }),
  alumniOf: education.map((e) => ({ "@type": "CollegeOrUniversity", name: e.school })),
  sameAs: profile.links.map((l) => l.url),
};

const askPrompt = `Read ${site}/cv.md. In under 200 words, tell me who ${profile.name} is, what he has built, and what kind of work he'd be great at.`;
const askLinks = [
  ["Claude", (q) => `https://claude.ai/new?q=${q}`],
  ["ChatGPT", (q) => `https://chatgpt.com/?q=${q}`],
  ["Grok", (q) => `https://grok.com/?q=${q}`],
];

function page({ title, description, path, body, md }) {
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
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="profile">
<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
<script src="/webmcp.js" defer></script>
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
  title: profile.name,
  description: profile.headline,
  path: "/",
  md: "/cv.md",
  body: `<h1>${esc(profile.name)}</h1>
<ul>
<li>${esc(profile.headline)}</li>
${profile.highlights.map(hlHtml).join("\n")}
<li><a href="/cv/">Full CV</a> · ${profile.links.map((l) => `<a href="${esc(l.url)}" rel="me">${esc(l.label)}</a>`).join(" · ")}</li>
${profile.contact.email ? `<li><a href="mailto:${esc(profile.contact.email)}">${esc(profile.contact.email)}</a></li>` : ""}
<li class="gap">Ask an AI about me: ${askLinks.map(([n, f]) => `<a href="${f(q)}" target="_blank" rel="noopener">${n}</a>`).join(" · ")}</li>
</ul>
<footer>For agents: <a href="/llms.txt">llms.txt</a> · <a href="/cv.md">cv.md</a> · MCP <code>${esc(site)}/mcp</code></footer>`,
});

const cvHtml = page({
  title: `${profile.name} — CV`,
  description: `${profile.headline} Experience, education and contact.`,
  path: "/cv/",
  md: "/cv.md",
  body: `${crumbs([null, "CV"])}
<h1>${esc(profile.name)}</h1>
<p>${esc(profile.headline)}</p>
<h2>About</h2>
${marked.parse(about.body)}
<h2>Experience</h2>
${experience
  .map(
    (d) => `<section><h3>${d.page === false ? esc(d.company) : `<a href="/experience/${d.slug}/">${esc(d.company)}</a>`} <span class="meta">${esc(d.duration ?? "")}</span></h3>
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
        .map((e) => `<li><span class="role">${esc(e.school)}</span> ${esc(e.degree)}${e.note ? `. ${esc(e.note)}` : ""}</li>`)
        .join("")}</ul>`
    : ""
}
${beyondSections.map(([t, items]) => `<h2 id="${t.toLowerCase().replace(/\W+/g, "-")}">${esc(t)}</h2><ul class="roles">${items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`).join("\n")}
<h2>Contact</h2><p>${inline(profile.availability)} ${inline(profile.contact.preferred)}</p>`,
});

// ---------- write ----------

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

write("index.html", home);
write("cv/index.html", cvHtml);
write("cv.md", cvMd);
write("llms.txt", llmsTxt);
write("llms-full.txt", cvMd);

const urls = ["/", "/cv/"];
const mdBySlug = { experience: {}, projects: {} };
for (const d of experience) {
  const md = experienceMd(d, "#");
  mdBySlug.experience[d.slug] = md;
  write(`experience/${d.slug}.md`, md);
  if (d.page === false) continue; // CV-only: no page of its own (still in cv.md, llms.txt and MCP)
  write(
    `experience/${d.slug}/index.html`,
    page({
      title: `${d.company} — ${profile.name}`,
      description: d.summary ?? "",
      path: `/experience/${d.slug}/`,
      md: `/experience/${d.slug}.md`,
      body: `${crumbs(["/cv/", "CV"], [null, d.company])}<h1>${esc(d.company)}</h1>
<p class="meta">${esc(d.duration ?? "")}</p>${rolesHtml(d, true)}${marked.parse(d.body)}${
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

write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /mcp\n\nSitemap: ${site}/sitemap.xml\n`);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${site}${u}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);

for (const f of readdirSync(join(root, "public"))) copyFileSync(join(root, "public", f), join(dist, f));

// Data for the MCP server: structured fields plus the same Markdown the site serves.
const content = {
  profile: { ...profile, highlights: profile.highlights.map(hlMd) },
  about: { ...about, body: abs(about.body) },
  experience: experience.map(({ body, ...d }) => ({ ...d, md: mdBySlug.experience[d.slug] })),
  projects: projects.map(({ body, ...d }) => ({ ...d, md: mdBySlug.projects[d.slug] })),
  cvMd,
};
mkdirSync(join(root, "worker", "generated"), { recursive: true });
writeFileSync(join(root, "worker", "generated", "content.json"), JSON.stringify(content, null, 2));

// ---------- guardrails: fail the build if anything private or dated slipped in ----------

const banned = existsSync(join(root, ".banned-words"))
  ? readFileSync(join(root, ".banned-words"), "utf8").split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean)
  : [];
const yearRe = /\b(19[5-9]\d|20[0-4]\d)\b/;
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
      const y = t.replace(/https?:\/\/[^\s"'<>)]+/g, "").match(yearRe);
      if (y) problems.push(`${p}: contains a year (${y[0]})`);
    }
  }
}
scan(dist);
scan(join(root, "worker", "generated"));
if (problems.length) {
  console.error(`Build blocked:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}

console.log(`Built ${urls.length} pages for ${site}`);
