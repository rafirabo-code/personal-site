// Tells Bing (and other IndexNow engines) that the site changed. Run after a deploy: npm run indexnow
import { readFileSync, readdirSync } from "node:fs";

const site = "https://rafirabo.com";
const key = readdirSync("public").find((f) => /^[0-9a-f]{32}\.txt$/.test(f))?.slice(0, -4);
if (!key) throw new Error("IndexNow key file (public/<key>.txt) not found");

const urls = [...readFileSync("dist/sitemap.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
urls.push(`${site}/llms.txt`, `${site}/cv.md`);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${key}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} for ${urls.length} URLs`);
