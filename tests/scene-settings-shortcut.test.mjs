import assert from "node:assert/strict";
import test from "node:test";
import { openCurrentSceneMemorySettings } from "../scripts/foundry/scene-config.js";
import { runtimeHost } from "./helpers/runtime.mjs";

function fixture({ rendered = false, minimized = false } = {}) {
  const f = runtimeHost();
  f.host.game.user.isGM = true;
  f.host.canvas.scene.isOwner = true;
  const calls = [];
  f.host.canvas.scene.sheet = {
    rendered,
    minimized,
    isEditable: true,
    render: async options => calls.push(["render", options]),
    changeTab: (...args) => calls.push(["tab", ...args]),
    maximize: async () => calls.push(["maximize"]),
    bringToFront: () => calls.push(["front"])
  };
  return { ...f, calls };
}

test("scene shortcut opens the native Visibility tab and raises the sheet", async () => {
  const f = fixture();
  assert.equal(await openCurrentSceneMemorySettings(f.host), true);
  assert.deepEqual(f.calls, [
    ["render", { force: true, tab: { sheet: "visibility" } }],
    ["front"]
  ]);
});

test("an already open scene form changes tab without rerendering unsaved edits", async () => {
  const f = fixture({ rendered: true, minimized: true });
  assert.equal(await openCurrentSceneMemorySettings(f.host), true);
  assert.deepEqual(f.calls, [
    ["tab", "visibility", "sheet"],
    ["maximize"],
    ["front"]
  ]);
});

test("scene shortcut rejects players, missing scenes and noneditable sheets", async () => {
  for (const mutate of [
    host => {
      host.game.user.isGM = false;
    },
    host => {
      host.canvas.scene = null;
    },
    host => {
      host.canvas.ready = false;
    },
    host => {
      host.canvas.scene.isOwner = false;
    },
    host => {
      host.canvas.scene.sheet.isEditable = false;
    }
  ]) {
    const f = fixture();
    mutate(f.host);
    assert.equal(await openCurrentSceneMemorySettings(f.host), false);
    assert.deepEqual(f.calls, []);
  }
});
