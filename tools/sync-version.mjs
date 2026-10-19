import { readFile, writeFile } from "node:fs/promises";
import { format, resolveConfig } from "prettier";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?$/.test(version ?? ""))
  throw new Error("Use a stable version or a beta.N version.");
// Load everything before writing. No Git or network operations.
const documents = await Promise.all(
  ["package.json", "package-lock.json", "module.json"].map(async file => [
    file,
    JSON.parse(await readFile(file, "utf8"))
  ])
);
for (const [file, data] of documents) {
  if (
    data.version === version &&
    (file !== "package-lock.json" || data.packages[""].version === version)
  )
    continue;
  data.version = version;
  if (file === "package-lock.json") data.packages[""].version = version;
  await writeFile(
    file,
    await format(JSON.stringify(data), {
      ...(await resolveConfig(file)),
      filepath: file
    })
  );
}
