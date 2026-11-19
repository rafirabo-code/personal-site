// One-page PDF CV (dist/rafi-rabo-cv.pdf), rendered with headless Chrome from the same content as the site
// (worker/generated/content.json, written by build.mjs), so it never drifts. Runs as part of `npm run build`.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "rafi-rabo-cv.pdf");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chrome)) {
  console.error("PDF CV: Chrome not found (set CHROME_PATH). Skipping the PDF would publish a broken link, so stopping.");
  process.exit(1);
}

const { profile, experience } = JSON.parse(readFileSync(join(root, "worker", "generated", "content.json"), "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Content may contain Markdown links: keep the text only.
const plain = (s) => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "");
// One font family only: Helvetica Neue has no arrow glyph, which would pull in a fallback font.
const glyphs = (s) => String(s ?? "").replace(/0→1/g, "0-to-1").replace(/→/g, "to");
const t = (s) => esc(glyphs(plain(s)));
const exp = Object.fromEntries(experience.map((d) => [d.slug, d]));
const site = profile.site.url.replace(/\/$/, "");
const shortTitle = (s) => s.replace("Associate Product Manager", "Associate PM").replace("Senior Product Manager", "Senior PM").replace("Product Manager", "PM");
// One line per role: the role's pdf_line (in content), else its site line.
const roleText = (r) => r.pdf_line ?? r.line;

// Two columns: text (wraps within its own column) and years (never wraps).
const row = (left, years) => `<div class="row"><div class="main">${left}</div><span class="yr">${t(years)}</span></div>`;
const section = (name, years, items) => `
${row(`<h3>${t(name)}</h3>`, years)}
<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

const edu = profile.education[0];
const mil = exp["special-forces"];
const vol = profile.beyond_work.volunteering.map((v) => plain(v).split(":")[0]);
const linkedin = profile.links.find((l) => /linkedin/i.test(l.url))?.url ?? "";
// Subtitle: role plus what I'm looking for (first sentence of availability), one line.
const pitch = `${profile.role}. ${profile.availability.split(/(?<=\.)\s/)[0]}`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(profile.name)} — CV</title>
<style>
  @page { size: Letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.35 "Helvetica Neue"; color: #000; }
  h1 { font-size: 22pt; margin: 0 0 3pt; letter-spacing: -0.2pt; }
  .pitch { margin: 0 0 5pt; font-style: italic; color: #333; white-space: nowrap; }
  .contact { font-size: 9.5pt; color: #444; margin: 0 0 4pt; padding-bottom: 11pt; border-bottom: 0.6pt solid #000; }
  .contact a { color: #444; text-decoration: none; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.8pt; margin: 27pt 0 10pt; }
  .row { display: flex; align-items: baseline; margin: 17pt 0 7pt; }
  h2 + .row { margin-top: 0; }
  .main { flex: 1; padding-right: 1.5em; }
  .yr { white-space: nowrap; }
  h3 { font-size: 10.5pt; margin: 0; }
  ul { margin: 0; padding-left: 13pt; }
  li { margin: 0 0 5.5pt; }
  p { margin: 0; }
  b, h3 { font-weight: 600; }
</style></head><body>
<h1>${esc(profile.name)}</h1>
<p class="pitch">${t(pitch)}</p>
<div class="contact">Tel Aviv · <a href="mailto:${esc(profile.contact.email)}">${esc(profile.contact.email)}</a> · <a href="${esc(linkedin)}">${esc(linkedin.replace(/^https?:\/\/(www\.)?/, ""))}</a> · <a href="${esc(site)}">${esc(site.replace(/^https?:\/\//, ""))}</a></div>

<h2>Experience</h2>
${section(exp.founder.company, exp.founder.years, exp.founder.roles.map((r) => `<b>${t(r.team)}</b>: ${t(roleText(r))}`))}
${section("Microsoft", exp.microsoft.years, exp.microsoft.roles.map((r) => `<b>${t(r.team)}</b>, ${t(shortTitle(r.title))}: ${t(roleText(r))}`))}
${section("Apple", exp.apple.years, exp.apple.roles.map((r) => `<b>${t(r.team)}</b>, ${t(r.title)}: ${t(roleText(r))}`))}

<h2>Education</h2>
${row(`<b>${t(edu.school)}</b> — ${t(edu.degree)}<br>${t(edu.note)}`, edu.years)}

<h2>Military</h2>
${row(`<b>IDF special forces</b> — ${t(mil.roles[0].title.toLowerCase())}; ${t(roleText(mil.roles[0]))}`, mil.years)}

<h2>Also</h2>
<p>Volunteering: ${t(vol[0])}, surf mentoring for youth at risk; ${t(vol[1])}, a pre-military preparatory group for teens. Surfer since childhood.</p>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), "cvpdf-"));
try {
  const src = join(tmp, "cv.html");
  writeFileSync(src, html);
  execFileSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${join(tmp, "profile")}`, `--print-to-pdf=${out}`, `file://${src}`], { stdio: "ignore" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const pdf = readFileSync(out, "latin1");
const pages = (pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
if (pages !== 1) {
  console.error(`PDF CV: ${pages} pages; it must be exactly 1. Shorten the content.`);
  process.exit(1);
}
// Embedded fonts look like "/BaseFont /AAAAAA+HelveticaNeue-Bold": strip the subset tag and the style.
const fonts = [...new Set([...pdf.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/<>\[\]()]+)/g)].map((m) => m[1]))];
const families = [...new Set(fonts.map((f) => f.split("-")[0]))];
if (families.length !== 1) {
  console.error(`PDF CV: ${families.length} font families embedded (${fonts.join(", ")}); use one. A glyph is probably missing from the main font.`);
  process.exit(1);
}
console.log(`PDF CV: 1 page, fonts: ${fonts.join(", ")}`);
