import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validate } from "./validate.mjs";
import { releaseNotes } from "./release-notes.mjs";

const root = process.cwd();
const files = await validate(root);
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });
const data = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
await writeFile(
  path.join(dist, "release-notes.md"),
  releaseNotes(
    await readFile(path.join(root, "CHANGELOG.md"), "utf8"),
    data.version
  )
);
if (process.argv.includes("--release")) {
  const repository = "https://github.com/wondersalmon/probably-just-a-rat";
  const tag = `v${data.version}`;
  data.manifest = `${repository}/releases/${data.version.includes("-") ? `download/${tag}` : "latest/download"}/module.json`;
  data.download = `${repository}/releases/download/${tag}/probably-just-a-rat.zip`;
}
const manifest = `${JSON.stringify(data, null, 2)}\n`;
await writeFile(path.join(dist, "module.json"), manifest);
const output = createWriteStream(path.join(dist, "probably-just-a-rat.zip"));
const archive = new ZipArchive({ zlib: { level: 9 } });
const complete = new Promise((resolve, reject) => {
  output.on("close", resolve);
  output.on("error", reject);
  archive.on("error", reject);
  archive.on("warning", reject);
});
archive.pipe(output);
for (const file of files) {
  if (file === "module.json") archive.append(manifest, { name: file });
  else archive.file(path.join(root, file), { name: file });
}
await archive.finalize();
await complete;
const sums = [];
for (const file of ["module.json", "probably-just-a-rat.zip"])
  sums.push(
    `${createHash("sha256")
      .update(await readFile(path.join(dist, file)))
      .digest("hex")}  ${file}`
  );
await writeFile(path.join(dist, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(`Built dist/probably-just-a-rat.zip (${files.length} files).`);
