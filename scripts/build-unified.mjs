#!/usr/bin/env node
/* Unified Forge — app assembly (U0 branch).
   www/ is assembled from unified/ (the unified app's own source tree).
   The unified source carries no service worker and no PWA manifest:
   inside the app, offline is native (bundled assets). */
import { cpSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "unified");
const WWW = path.join(ROOT, "www");
rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });
cpSync(SRC, WWW, { recursive: true });
const files = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(path.relative(WWW, p)); } })(WWW);
console.log("assembled www/ from unified/: " + files.length + " files");
if (!files.includes("index.html") || !files.includes("audio-core.js") || !files.includes("importer.js"))
  throw new Error("assembly incomplete: foundation files missing");
if (files.includes("sw.js") || files.includes("manifest.json"))
  throw new Error("assembly must not contain sw.js or manifest.json");
console.log("assembly checks passed (no sw.js, no manifest.json)");
