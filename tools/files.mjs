import { readdir } from "node:fs/promises";
import path from "node:path";

export async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(target)));
    else if (entry.isFile()) files.push(target);
    else throw new Error(`Unsupported package entry: ${target}`);
  }
  return files.sort();
}

export async function releaseFiles(root) {
  const files = [
    "module.json",
    "README.md",
    "README.ru.md",
    "CHANGELOG.md",
    "CHANGELOG.ru.md",
    "media/demo.webp"
  ];
  for (const directory of ["scripts", "lang", "styles"])
    for (const file of await listFiles(path.join(root, directory)))
      files.push(path.relative(root, file).split(path.sep).join("/"));
  return files.sort();
}
