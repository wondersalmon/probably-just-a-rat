import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { publishFoundryRelease } from "../tools/publish-foundry.mjs";

// Stable publication must be tested even when this checkout prepares a beta.
const manifest = {
  ...JSON.parse(await readFile("module.json", "utf8")),
  version: "2.3.4",
  compatibility: { minimum: "14", verified: "14", maximum: "14" }
};
const publicationRoot = await mkdtemp(path.join(tmpdir(), "rat-publisher-"));
await writeFile(
  path.join(publicationRoot, "module.json"),
  JSON.stringify(manifest)
);
await writeFile(
  path.join(publicationRoot, "package.json"),
  JSON.stringify({ version: manifest.version })
);
test.after(async () => {
  assert.ok(publicationRoot.startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(publicationRoot, { recursive: true, force: true });
});
const token = "fvttp_test-token";
const tag = "v" + manifest.version;
const versioned = manifest.url + "/releases/download/" + tag;
const runPublication = async (post, { asset, root = publicationRoot } = {}) => {
  const requests = [],
    delays = [],
    messages = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options });
    assert.equal(options.signal instanceof AbortSignal, true);
    if (options.method === "POST")
      return post(
        requests.filter(row => row.method === "POST").length,
        options
      );
    const override = asset?.(url, options);
    if (override) return override;
    if (url === versioned + "/module.json")
      return Response.json({
        ...manifest,
        download: versioned + "/probably-just-a-rat.zip"
      });
    if (
      url === versioned + "/probably-just-a-rat.zip" &&
      options.method === "HEAD"
    )
      return new Response(null);
    throw new Error("Unexpected request: " + url);
  };
  let error;
  try {
    await publishFoundryRelease({
      root,
      tag,
      token,
      fetchImpl,
      sleep: async delay => {
        delays.push(delay);
      },
      now: () => 0,
      log: message => messages.push(message)
    });
  } catch (failure) {
    error = failure;
  }
  return { requests, delays, messages, error };
};

test("release workflow invokes the tested publisher with scoped secret and same-tag concurrency", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(
    source,
    /run: node \.release-tools\/tools\/publish-foundry\.mjs/
  );
  assert.match(source, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.match(
    source,
    /RAT_RELEASE_TOKEN: \$\{\{ secrets\.RAT_RELEASE_TOKEN \}\}/
  );
  assert.match(
    source,
    /group: foundry-release-\$\{\{ inputs\.tag \|\| github\.ref_name \}\}/
  );
  assert.match(source, /cancel-in-progress: false/);
});

test("publisher sends exact versioned assets and compatibility to Foundry", async () => {
  const result = await runPublication(() =>
    Response.json({ status: "success" })
  );
  assert.equal(result.error, undefined);
  const post = result.requests.find(row => row.method === "POST");
  assert.equal(post.headers.Authorization, token);
  const payload = JSON.parse(post.body);
  assert.equal(payload.id, manifest.id);
  assert.equal(payload.release.version, manifest.version);
  assert.equal(payload.release.manifest, versioned + "/module.json");
  assert.equal(payload.release.notes, manifest.url + "/releases/tag/" + tag);
  assert.equal(
    post.url,
    "https://foundryvtt.com/_api/packages/release_version/"
  );
  assert.deepEqual(payload.release.compatibility, manifest.compatibility);
});

test("publisher accepts an already registered version without further requests", async () => {
  const result = await runPublication(() =>
    Response.json(
      { errors: { __all__: [{ code: "unique_together" }] } },
      { status: 400 }
    )
  );
  assert.equal(result.error, undefined);
  assert.match(result.messages[0], /already has Probably Just a Rat/);
  assert.equal(result.delays.length, 0);
});

test("publisher respects seconds and HTTP date Retry-After values", async () => {
  for (const value of ["3", "Thu, 01 Jan 1970 00:00:03 GMT"]) {
    const result = await runPublication(attempt =>
      attempt === 1
        ? new Response("Busy", {
            status: 429,
            headers: { "Retry-After": value }
          })
        : Response.json({ status: "success" })
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.delays, [3000]);
    assert.equal(
      result.requests.filter(row => row.method === "POST").length,
      2
    );
  }
});

test("publisher retries transient HTML and network/timeout failures", async () => {
  for (const failure of [
    () => new Response("<html>Unavailable</html>", { status: 503 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () => {
      throw new DOMException("timed out", "TimeoutError");
    }
  ]) {
    const result = await runPublication(attempt =>
      attempt === 1 ? failure() : Response.json({ status: "success" })
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.delays, [1000]);
  }
});

test("publisher has bounded retries and rejects excessive server delays", async () => {
  const result = await runPublication(
    () => new Response("Unavailable", { status: 503 })
  );
  assert.match(
    result.error.message,
    /Foundry publication failed \(503\).*Non-JSON/
  );
  assert.deepEqual(result.delays, [1000, 2000, 4000, 8000]);
  assert.equal(result.requests.filter(row => row.method === "POST").length, 5);
  const delayed = await runPublication(
    () =>
      new Response("Busy", { status: 429, headers: { "Retry-After": "3600" } })
  );
  assert.match(delayed.error.message, /retry delay exceeds/);
  assert.deepEqual(delayed.delays, []);
});

test("publisher does not retry validation/auth failures or expose its token", async () => {
  for (const status of [400, 401, 403]) {
    const result = await runPublication(() =>
      Response.json({ errors: { detail: token } }, { status })
    );
    assert.equal(
      result.error.message.includes("failed (" + status + ")"),
      true
    );
    assert.equal(result.error.message.includes(token), false);
    assert.equal(
      result.requests.filter(row => row.method === "POST").length,
      1
    );
    assert.deepEqual(result.delays, []);
  }
});

test("publisher waits for assets but never publishes a mismatched manifest", async () => {
  let attempts = 0;
  const available = await runPublication(
    () => Response.json({ status: "success" }),
    {
      asset: url =>
        url.endsWith("module.json") && ++attempts === 1
          ? new Response("Not yet available", { status: 404 })
          : null
    }
  );
  assert.equal(available.error, undefined);
  assert.deepEqual(available.delays, [1000]);
  const mismatched = await runPublication(
    () => {
      throw new Error("Must not publish");
    },
    {
      asset: url =>
        url.endsWith("module.json")
          ? Response.json({ ...manifest, version: "wrong" })
          : null
    }
  );
  assert.match(mismatched.error.message, /does not match/);
  assert.equal(
    mismatched.requests.some(row => row.method === "POST"),
    false
  );
});

test("publisher rejects invalid tag/token before accessing the network", async () => {
  for (const options of [
    { tag: "main", token },
    { tag, token: undefined },
    { tag, token: "invalid" },
    { tag: "v999.0.0", token }
  ]) {
    await assert.rejects(
      publishFoundryRelease({
        root: publicationRoot,
        ...options,
        fetchImpl: () => {
          assert.fail("No network allowed");
        }
      }),
      /tag|TOKEN|versions differ/
    );
  }
});

test("prereleases cannot reach Foundry publication, including a manual invocation", async () => {
  for (const tag of ["v2.2.0-beta.1", "v2.2.0-rc.1"]) {
    await assert.rejects(
      publishFoundryRelease({
        tag,
        token,
        fetchImpl: () =>
          assert.fail("Prereleases must never access the network")
      }),
      /Prereleases are GitHub-only/
    );
  }
});

test("release workflow keeps prereleases away from stable latest and Foundry, including dispatch", async () => {
  const source = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(source, /CHANNEL_ARGS=\(--prerelease --latest=false\)/);
  assert.match(source, /--verify-tag/);
  const foundryJob = source.slice(source.indexOf("  publish-foundry:"));
  assert.match(
    foundryJob,
    /!contains\(inputs\.tag \|\| github\.ref_name, '-'\)/
  );
  assert.match(foundryJob, /github\.event_name == 'workflow_dispatch'/);
  assert.match(foundryJob, /needs: release/);
  assert.match(foundryJob, /needs\.release\.result == 'success'/);
  assert.match(
    source.slice(0, source.indexOf("  publish-foundry:")),
    /if: github\.event_name == 'push'/
  );
});

test("publisher rejects invalid compatibility and package identity before network access", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rat-publisher-validation-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: manifest.version })
    );
    for (const [override, message] of [
      [
        { compatibility: { minimum: "14", maximum: "14" } },
        /compatibility\.verified/
      ],
      [
        { compatibility: { minimum: "14", verified: "undefined" } },
        /compatibility\.verified/
      ],
      [
        { compatibility: { minimum: "", verified: "14" } },
        /compatibility\.minimum/
      ],
      [
        { compatibility: { minimum: "14", verified: "14", maximum: false } },
        /compatibility\.maximum/
      ],
      [{ id: "other-package" }, /Unexpected package/],
      [{ url: "https://example.com/other-package" }, /Unexpected package/]
    ]) {
      await writeFile(
        path.join(root, "module.json"),
        JSON.stringify({ ...manifest, ...override })
      );
      const result = await runPublication(
        () => assert.fail("Must not publish"),
        { root }
      );
      assert.match(result.error.message, message);
      assert.equal(result.requests.length, 0);
    }
  } finally {
    assert.ok(root.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("publisher rejects mismatched published identity, ZIP and compatibility, or a missing ZIP", async () => {
  for (const override of [
    { id: "other-package" },
    { download: "https://example.com/other.zip" },
    { compatibility: { ...manifest.compatibility, verified: "13" } }
  ]) {
    const result = await runPublication(() => assert.fail("Must not publish"), {
      asset: url =>
        url.endsWith("module.json")
          ? Response.json({
              ...manifest,
              download: versioned + "/probably-just-a-rat.zip",
              ...override
            })
          : null
    });
    assert.match(result.error.message, /does not match/);
    assert.equal(
      result.requests.some(row => row.method === "POST"),
      false
    );
  }
  const missing = await runPublication(() => assert.fail("Must not publish"), {
    asset: url =>
      url.endsWith(".zip") ? new Response(null, { status: 404 }) : null
  });
  assert.match(missing.error.message, /Release asset unavailable/);
  assert.equal(
    missing.requests.some(row => row.method === "POST"),
    false
  );
  assert.deepEqual(missing.delays, [1000, 2000, 4000, 8000]);
});
