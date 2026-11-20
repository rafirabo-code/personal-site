// Renders public/og.png (1200×630 link preview) with headless Chrome. Run when the pitch changes: npm run og
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const html = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; background: #fff; color: #111; overflow: hidden; }
  body { font-family: ui-monospace, "SF Mono", Menlo, monospace; padding: 96px 100px; box-sizing: border-box; position: relative; }
  h1 { font-size: 88px; font-weight: 900; margin: 0 0 36px; letter-spacing: -1px; }
  p { font-size: 34px; margin: 0 0 18px; color: #333; }
  .site { position: absolute; left: 100px; bottom: 72px; font-size: 26px; color: #6b6b6b; }
</style>
<h1>Rafi Rabo</h1>
<p>Product manager · Ex-Microsoft · Startup founder</p>
<p>Founding PM or strategy, fast-growing company</p>
<div class="site">rafirabo.com</div>`;
const tmp = mkdtempSync(join(tmpdir(), "og-"));
try {
  writeFileSync(join(tmp, "og.html"), html);
  execFileSync(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", "--window-size=1200,630", "--force-device-scale-factor=1",
    `--user-data-dir=${join(tmp, "p")}`, `--screenshot=${join(root, "public", "og.png")}`, `file://${join(tmp, "og.html")}`], { stdio: "ignore" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log("Wrote public/og.png");
