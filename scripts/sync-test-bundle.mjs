#!/usr/bin/env node
/* M1 harness bundle assembler (test branch only).
   Builds www/ from the four upstream repos at the exact commits pinned in
   upstream.lock.json — never from a moving branch. Upstream repos are only
   READ (public tarballs at a fixed SHA). Bundle-only transforms:
     1. FIT-HQ's tests/ directory is excluded (not app content).
     2. test-harness/probe.html is copied to www/probe.html.
     3. A diagnostic doorway link to probe.html is appended to the COPIED
        Forge index.html (the upstream file is never modified).
   Service workers are copied AS SHIPPED — M1 measures their behaviour. */
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(readFileSync(path.join(ROOT, "upstream.lock.json"), "utf8"));
const scratch = path.join(ROOT, ".bundle-src");
const www = path.join(ROOT, "www");

rmSync(scratch, { recursive: true, force: true });
rmSync(www, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
mkdirSync(www, { recursive: true });

for (const [name, info] of Object.entries(lock.repos)) {
  const url = `https://codeload.github.com/${info.repo}/tar.gz/${info.sha}`;
  const tgz = path.join(scratch, `${name}.tgz`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed for ${name}: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(tgz));
  const extractDir = path.join(scratch, name);
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["xzf", tgz, "-C", extractDir, "--strip-components=1"]);
  const dest = info.bundlePath === "." ? www : path.join(www, info.bundlePath);
  mkdirSync(dest, { recursive: true });
  cpSync(extractDir, dest, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(extractDir, src);
      if (name === "FIT-HQ" && (rel === "tests" || rel.startsWith(`tests${path.sep}`))) return false;
      return true;
    },
  });
  console.log(`bundled ${name} @ ${info.sha.slice(0, 7)} -> www/${info.bundlePath}`);
}

// Bundle transform (M1 finding F1): Capacitor's Android server routes any
// extensionless path to the ROOT index.html (SPA html5mode), so the hub's
// "../<App>/" links land on a Forge page whose own assets then 404.
// Rewriting the copies' links to name index.html explicitly fixes serving
// without touching upstream sources or any acceptance criterion.
for (const jsName of ["adapters.js", "app.js"]) {
  const jsPath = path.join(www, jsName);
  if (!existsSync(jsPath)) continue;
  let js = readFileSync(jsPath, "utf8");
  let n = 0;
  for (const folder of ["Couch-to-5k", "Home-Corner", "Namastay-Home"]) {
    const before = js;
    js = js.split(`../${folder}/"`).join(`../${folder}/index.html"`);
    js = js.split(`../${folder}/'`).join(`../${folder}/index.html'`);
    if (js !== before) n++;
  }
  if (n) { writeFileSync(jsPath, js); console.log(`F1 transform: rewrote folder links in copied ${jsName}`); }
}

// probe page + doorway link (bundle copies only)
cpSync(path.join(ROOT, "test-harness", "probe.html"), path.join(www, "probe.html"));
const idx = path.join(www, "index.html");
const html = readFileSync(idx, "utf8");
const doorway = `\n<!-- M1 harness diagnostic doorway (bundle copy only; not in upstream) -->\n<a href="probe.html" style="position:fixed;right:10px;bottom:10px;z-index:9999;background:#d4a72c;color:#141b2e;font:700 12px system-ui;padding:8px 12px;border-radius:999px;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.5)">M1 PROBE</a>\n`;
if (!html.includes("</body>")) throw new Error("Forge index.html has no </body> to anchor the doorway");
writeFileSync(idx, html.replace("</body>", doorway + "</body>"));
console.log("probe.html + doorway link added to the bundle copy");
console.log("bundle complete:", existsSync(path.join(www, "Couch-to-5k", "index.html")),
  existsSync(path.join(www, "Home-Corner", "index.html")),
  existsSync(path.join(www, "Namastay-Home", "index.html")));
