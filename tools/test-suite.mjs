import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { listFiles } from "./files.mjs";

const coverage = process.argv.includes("--coverage");
const files = (await listFiles("tests")).filter(file =>
  file.endsWith(".test.mjs")
);
if (!files.length) throw new Error("No tests found.");
const args = ["--test"];
if (coverage) {
  await mkdir("dev/coverage", { recursive: true });
  args.push(
    "--experimental-test-coverage",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    "--test-reporter-destination=dev/coverage/lcov.info"
  );
}
const result = spawnSync(process.execPath, [...args, ...files], {
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
