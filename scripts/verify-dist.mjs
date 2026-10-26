// Asserts the shipped bundles carry the endpoint the source names.
//
// IINA installs straight from this repo, so dist/ IS the plugin: a source-only
// edit leaves every install talking to the old surface, and the source would
// look correct while the running code is not. Run after `pnpm build`.
//
//   pnpm verify

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const problems = [];

function fail(message) {
  problems.push(message);
}

function read(path) {
  return readFileSync(path, "utf8");
}

// ---- what the source says ---------------------------------------------------

const SOURCE = "src/tidb.js";
const source = read(SOURCE);
const declared = source.match(/TIDB_API_URL\s*=\s*"([^"]+)"/)?.[1];

if (!declared) {
  fail(`could not read TIDB_API_URL out of ${SOURCE}`);
} else if (!/^https:\/\/api\.theintrodb\.org\/v4\/media$/.test(declared)) {
  fail(`${SOURCE} names a non-v4 endpoint: ${declared}`);
}

// ---- what the bundles carry -------------------------------------------------

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...jsFiles(path));
    else if (entry.endsWith(".js")) out.push(path);
  }
  return out;
}

const bundles = jsFiles("dist");
if (bundles.length === 0) fail("dist/ holds no bundles: run `pnpm build` first");

let carrying = 0;
for (const bundle of bundles) {
  const text = read(bundle);
  if (!text.includes("api.theintrodb.org")) continue; // the overlay does not call it
  carrying++;

  if (declared && !text.includes(declared)) {
    fail(`${bundle} does not carry ${declared} — rebuild (pnpm build)`);
  }
  const stale = text.match(/api\.theintrodb\.org\/v[23]\/media/g);
  if (stale) fail(`${bundle} still carries ${[...new Set(stale)].join(", ")}`);
}

if (carrying === 0) {
  fail("no bundle carries the TheIntroDB endpoint at all — is dist/ stale?");
}

// ---- the host still has to be permitted -------------------------------------

const info = JSON.parse(read("Info.json"));
if (!(info.allowedDomains || []).includes("api.theintrodb.org")) {
  fail("Info.json allowedDomains no longer permits api.theintrodb.org");
}

// ---- report -----------------------------------------------------------------

if (problems.length > 0) {
  console.error("verify-dist: FAILED");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `verify-dist: ok — ${carrying} bundle(s) carry ${declared}, no stale endpoint, host permitted`
);
