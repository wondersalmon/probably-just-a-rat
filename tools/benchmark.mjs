import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../scripts/core/memory-store.js";

// Measures only pure state work, never Foundry canvas or GPU performance.
const workload = { version: 1, tokens: 100, remembered: 20, iterations: 1000 };
const context = {
  sceneId: "fixture",
  userId: "player",
  levelId: null,
  sourceIds: ["observer"],
  mode: "limited",
  permissionKey: "owner"
};
const snapshot = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  levelId: null,
  texture: null,
  name: "Fixture"
};
const run = () => {
  const store = new MemoryStore({ now: () => 1000 });
  store.setContext(context);
  for (let i = 0; i < workload.tokens; i++)
    store.observe(`token-${i}`, { ...snapshot, x: i * 100 });
  for (let i = 0; i < workload.remembered; i++) store.loseSight(`token-${i}`);
  if (store.remembered().length !== workload.remembered)
    throw new Error("Invalid benchmark workload.");
  store.setContext(null);
  if (store.size !== 0) throw new Error("Context cleanup failed.");
};
for (let i = 0; i < 100; i++) run();
const samples = [];
for (let i = 0; i < workload.iterations; i++) {
  const start = performance.now();
  run();
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const percentile = p => samples[Math.ceil(samples.length * p) - 1];
const report = {
  createdAt: new Date().toISOString(),
  scope: "pure memory store; excludes Foundry, canvas and renderer",
  workload,
  fingerprint: createHash("sha256")
    .update(JSON.stringify(workload))
    .digest("hex"),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model
  },
  milliseconds: { median: percentile(0.5), p95: percentile(0.95) },
  comparison: "No accepted release baseline exists. No regression verdict."
};
const day = report.createdAt.slice(0, 10);
const stem = `memory-store-standard-${report.createdAt.replace(/[:.]/g, "-")}`;
const directory = path.join("dev", "benchmarks", day);
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, `${stem}.json`),
  `${JSON.stringify(report, null, 2)}\n`
);
const escape = value =>
  String(value).replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]
  );
await writeFile(
  path.join(directory, `${stem}.html`),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Memory store benchmark</title><style>body{font:16px system-ui;max-width:850px;margin:3rem auto;padding:1rem}pre{white-space:pre-wrap}</style><h1>Memory store benchmark</h1><p>100 tokens, 20 remembered records. State logic only; no Foundry canvas measurements.</p><p>Median: ${report.milliseconds.median.toFixed(3)} ms; p95: ${report.milliseconds.p95.toFixed(3)} ms.</p><p>${escape(report.comparison)}</p><pre>${escape(JSON.stringify(report, null, 2))}</pre></html>`
);
await writeFile(path.join(directory, "latest.txt"), `${stem}.json\n`);
console.log(
  `Memory store median ${report.milliseconds.median.toFixed(3)} ms; p95 ${report.milliseconds.p95.toFixed(3)} ms. Report: ${directory}/${stem}.html`
);
