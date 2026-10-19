import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json"
};
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1:4179");
    const resource =
      url.pathname === "/"
        ? "test-ui/fixture.html"
        : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(root, resource);
    if (
      !file.startsWith(`${root}${path.sep}`) ||
      !/^(scripts\/|styles\/|test-ui\/fixture\.(html|mjs)$|node_modules\/pixi\.js\/dist\/pixi\.min\.js$|lang\/)/.test(
        resource
      )
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream"
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(4179, "127.0.0.1");
