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
