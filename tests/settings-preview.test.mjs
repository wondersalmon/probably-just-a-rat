import assert from "node:assert/strict";
import test from "node:test";
import { SettingsPreview } from "../scripts/foundry/settings-preview.js";
import { runtimeHost } from "./helpers/runtime.mjs";

function form() {
  const root = new EventTarget();
  root.querySelector = () => null;
  return root;
}
function input(root, key, value, type = "input") {
  const field = { getAttribute: () => `probably-just-a-rat.${key}`, value };
  const event = new Event(type);
  Object.defineProperty(event, "target", {
    value: { closest: () => field, value, tagName: "INPUT" }
  });
  root.dispatchEvent(event);
}

test("slider events batch locally without saving and close cancels an unsaved pending preview", () => {
  const f = runtimeHost();
  const applied = [];
  const preview = new SettingsPreview(f.host, values =>
    applied.push({ ...values })
  );
  const app = {},
    root = form();
  preview.mount(app, root);
  input(root, "opacity", "30");
  input(root, "opacity", "35");
  input(root, "grayscale", "100");
  input(root, "sharePings", "0");
  assert.equal(f.frames.size, 1);
  assert.deepEqual(applied, []);
  f.frame();
  assert.deepEqual(applied, [{ opacity: 35, grayscale: 100 }]);
  input(root, "opacity", "65");
  preview.unmount(app);
  f.frame();
  assert.deepEqual(applied.at(-1), {});
  input(root, "opacity", "20");
  assert.equal(f.frames.size, 0);
  preview.dispose();
});

test("rerender removes old listeners, preserves draft values and disposal cancels queued work", () => {
  const f = runtimeHost();
  const applied = [];
  const preview = new SettingsPreview(f.host, values =>
    applied.push({ ...values })
  );
  const app = {},
    oldRoot = form(),
    nextRoot = form();
  preview.mount(app, oldRoot);
  input(oldRoot, "opacity", "35");
  f.frame();
  const control = { value: "50" };
  nextRoot.querySelector = () => control;
  preview.mount(app, nextRoot);
  assert.equal(control.value, "35");
  input(oldRoot, "opacity", "70");
  assert.equal(f.frames.size, 0);
  preview.mount(app, nextRoot);
  input(nextRoot, "grayscale", "50");
  assert.equal(f.frames.size, 1);
  preview.dispose();
  assert.equal(f.frames.size, 0);
  assert.deepEqual(applied.at(-1), {});
  f.frame();
  assert.deepEqual(applied.at(-1), {});
});

test("GM marker selection previews without a save and cancel restores the stored style", () => {
  const f = runtimeHost();
  f.host.game.user.isGM = true;
  const applied = [];
  const preview = new SettingsPreview(f.host, values =>
    applied.push({ ...values })
  );
  const app = {},
    root = form();
  preview.mount(app, root);
  input(root, "markerStyle", "footprints", "change");
  f.frame();
  assert.deepEqual(applied.at(-1), { markerStyle: "footprints" });
  input(root, "markerStyle", "invalid", "change");
  assert.equal(f.frames.size, 0);
  preview.unmount(app);
  f.frame();
  assert.deepEqual(applied.at(-1), {});
  preview.dispose();
});

test("players cannot preview a different marker style while personal opacity still previews", () => {
  const f = runtimeHost();
  const applied = [];
  const preview = new SettingsPreview(f.host, values =>
    applied.push({ ...values })
  );
  const root = form();
  preview.mount({}, root);
  input(root, "markerStyle", "footprints", "change");
  assert.equal(f.frames.size, 0);
  input(root, "opacity", "65");
  f.frame();
  assert.deepEqual(applied.at(-1), { opacity: 65 });
  preview.dispose();
});

test("GM caption policy previews all modes and cancel restores saved appearance", () => {
  const f = runtimeHost();
  f.host.game.user.isGM = true;
  const applied = [];
  const preview = new SettingsPreview(f.host, values =>
    applied.push({ ...values })
  );
  const root = form(),
    app = {};
  preview.mount(app, root);
  for (const mode of ["off", "contrast", "standard"]) {
    input(root, "captionStyle", mode, "change");
    f.frame();
    assert.equal(applied.at(-1).captionStyle, mode);
  }
  input(root, "captionStyle", "invalid", "change");
  assert.equal(f.frames.size, 0);
  preview.unmount(app);
  f.frame();
  assert.deepEqual(applied.at(-1), {});
});

test("player caption preview permits only standard and contrast while the GM allows captions", () => {
  const f = runtimeHost();
  let world = "standard";
  const get = f.host.game.settings.get;
  f.host.game.settings.get = (namespace, key) =>
    key === "captionStyle" ? world : get(namespace, key);
  const applied = [];
  const preview = new SettingsPreview(f.host, values =>
    applied.push({ ...values })
  );
  const root = form();
  preview.mount({}, root);
  for (const style of ["standard", "contrast"]) {
    input(root, "labels", style, "change");
    f.frame();
    assert.equal(applied.at(-1).labels, style);
  }
  for (const style of ["off", "invalid"])
    input(root, "labels", style, "change");
  input(root, "captionStyle", "off", "change");
  assert.equal(f.frames.size, 0);
  world = "off";
  input(root, "labels", "standard", "change");
  assert.equal(f.frames.size, 0);
  preview.dispose();
});

test("world caption and rotation preview is GM-only and uses checkbox state", () => {
  for (const isGM of [false, true]) {
    const f = runtimeHost();
    f.host.game.user.isGM = isGM;
    const applied = [];
    const preview = new SettingsPreview(f.host, values =>
      applied.push({ ...values })
    );
    const root = form();
    preview.mount({}, root);
    for (const key of ["showNames", "showRounds", "customMarkerRotate"]) {
      const field = { getAttribute: () => `probably-just-a-rat.${key}` };
      const event = new Event("change");
      Object.defineProperty(event, "target", {
        value: { closest: () => field, checked: true }
      });
      root.dispatchEvent(event);
    }
    if (isGM) {
      f.frame();
      assert.deepEqual(applied.at(-1), {
        showNames: true,
        showRounds: true,
        customMarkerRotate: true
      });
    } else assert.equal(f.frames.size, 0);
    preview.dispose();
  }
});
