import assert from "node:assert/strict";
import test from "node:test";
import { resolveCaptionStyle } from "../scripts/appearance.js";

test("GM off disables captions regardless of a player's saved or previewed style", () => {
  for (const personal of ["world", "standard", "contrast", "off", true, false])
    assert.equal(resolveCaptionStyle("off", personal, false), "off");
});

test("players inherit the GM style until choosing standard or high contrast", () => {
  for (const world of ["standard", "contrast"]) {
    assert.equal(resolveCaptionStyle(world, "world", false), world);
    assert.equal(resolveCaptionStyle(world, "off", false), world);
    assert.equal(resolveCaptionStyle(world, "standard", false), "standard");
    assert.equal(resolveCaptionStyle(world, "contrast", false), "contrast");
  }
});

test("the GM previews the world caption style rather than a personal override", () => {
  assert.equal(resolveCaptionStyle("standard", "contrast", true), "standard");
  assert.equal(resolveCaptionStyle("contrast", "standard", true), "contrast");
});
