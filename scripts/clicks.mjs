// Prints Ask-an-AI click counts from the ASK_CLICKS KV namespace: npm run clicks
import { execFileSync } from "node:child_process";

const run = (...args) => execFileSync("npx", ["wrangler", "kv", ...args, "--binding", "ASK_CLICKS", "--remote"], { encoding: "utf8" });
const keys = JSON.parse(run("key", "list")).map((k) => k.name).sort();
if (!keys.length) console.log("No clicks yet.");
for (const k of keys) {
  const [ai, month] = k.split(":");
  console.log(`${month}  ${ai.padEnd(8)} ${run("key", "get", k).trim()}`);
}
