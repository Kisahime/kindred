// Builds the test bundle and runs every scripts/test-*.mjs (live checks inside each script skip when Ollama is down).
import { execSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const SKIP = new Set(["test-stream.mjs"]); // manual streaming benchmark: node scripts/test-stream.mjs [model]
execSync('npx esbuild scripts/test-entry.ts --bundle --platform=node --format=esm --outfile=dist-test/all.js "--external:@tauri-apps/*"', { stdio: "inherit" });
const files = readdirSync("scripts").filter((f) => /^test-.*\.mjs$/.test(f) && !SKIP.has(f)).sort();
const failed = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [`scripts/${f}`], { stdio: "inherit" });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nall ${files.length} test scripts passed`);
process.exit(failed.length ? 1 : 0);
