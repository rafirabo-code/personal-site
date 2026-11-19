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
const exp = Object.fromEntries(experience.map((d) => [d.slug, d]));
const site = profile.site.url.replace(/\/$/, "");
const shortTitle = (t) => t.replace("Associate Product Manager", "Associate PM").replace("Senior Product Manager", "Senior PM").replace("Product Manager", "PM");
// One line per role: what I did (role line), then the first point (scale or result).
const roleLine = (r) => [r.line, r.points?.[0]].filter(Boolean).join(" ");

const section = (name, years, items) => `
<div class="row"><h3>${esc(name)}</h3><span class="yr">${esc(years)}</span></div>
<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

const edu = profile.education[0];
const vol = profile.beyond_work.volunteering.map((v) => plain(v).split(":")[0]);
const linkedin = profile.links.find((l) => /linkedin/i.test(l.url))?.url ?? "";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(profile.name)} — CV</title>
<style>
  @page { size: Letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.25pt/1.38 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #000; }
  h1 { font-size: 20pt; margin: 0 0 7pt; letter-spacing: -0.2pt; }
  .contact { margin: 0 0 10pt; padding-bottom: 9pt; border-bottom: 0.6pt solid #000; }
  .contact a { color: #000; text-decoration: none; }
  .pitch { margin: 0 0 6pt; }
  h2 { font-size: 10.25pt; text-transform: uppercase; letter-spacing: 0.8pt; margin: 16pt 0 7pt; }
  .row { display: flex; justify-content: space-between; align-items: baseline; margin: 11pt 0 6pt; }
  h2 + .row { margin-top: 0; }
  h3 { font-size: 10.25pt; margin: 0; }
  .yr { white-space: nowrap; padding-left: 12pt; }
  ul { margin: 0; padding-left: 13pt; }
  li { margin: 0 0 2.5pt; }
  p { margin: 0; }
  b { font-weight: 600; }
</style></head><body>
<h1>${esc(profile.name)}</h1>
<div class="contact">Tel Aviv · <a href="mailto:${esc(profile.contact.email)}">${esc(profile.contact.email)}</a> · <a href="${esc(linkedin)}">${esc(linkedin.replace(/^https?:\/\/(www\.)?/, ""))}</a> · <a href="${esc(site)}">${esc(site.replace(/^https?:\/\//, ""))}</a></div>
<p class="pitch">${esc(profile.headline)}</p>

<h2>Experience</h2>
${section("Founder — Batta, then Penny", exp.founder.years, exp.founder.roles.map((r) => `<b>${esc(r.team)}:</b> ${esc(r.line)}`))}
${section("Microsoft", exp.microsoft.years, exp.microsoft.roles.map((r) => `<b>${esc(shortTitle(r.title))}, ${esc(r.team)}:</b> ${esc(roleLine(r))}`))}
${section("Apple", exp.apple.years, exp.apple.roles.map((r) => `<b>${esc(r.title)}, ${esc(r.team.toLowerCase())}:</b> ${esc(roleLine(r))}`))}

<h2>Education</h2>
<div class="row"><p><b>${esc(edu.school)}</b> — ${esc(edu.degree)}. ${esc(edu.note)}</p><span class="yr">${esc(edu.years)}</span></div>

<h2>Military</h2>
<div class="row"><p><b>IDF special forces</b> — ${esc(exp["special-forces"].roles[0].title)}. ${esc(exp["special-forces"].roles[0].line)}</p><span class="yr">${esc(exp["special-forces"].years)}</span></div>

<h2>Also</h2>
<p>Volunteering: ${esc(vol[0])}, surf mentoring for youth at risk; ${esc(vol[1])}, a pre-military preparatory group for teens. Surfer since childhood.</p>
</body></html>`;

const tmp = mkdtempSync(join(tmpdir(), "cvpdf-"));
try {
  const src = join(tmp, "cv.html");
  writeFileSync(src, html);
  execFileSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${join(tmp, "profile")}`, `--print-to-pdf=${out}`, `file://${src}`], { stdio: "ignore" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const pages = (readFileSync(out, "latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
if (pages !== 1) {
  console.error(`PDF CV: ${pages} pages; it must be exactly 1. Shorten the content.`);
  process.exit(1);
}
console.log("PDF CV: 1 page");
