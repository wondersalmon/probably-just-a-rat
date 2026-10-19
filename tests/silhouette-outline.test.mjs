import assert from "node:assert/strict";
import test from "node:test";
import { silhouetteAlpha } from "../scripts/foundry/silhouette-outline.js";

test("outline mask fills internal transparency, preserves alpha-shaded body and removes tiny isolated specks", () => {
  const width = 32;
  const rgba = new Uint8ClampedArray(width * width * 4);
  for (let y = 5; y < 27; y++)
    for (let x = 7; x < 25; x++)
      rgba[(y * width + x) * 4 + 3] = x < 15 ? 255 : 75;
  for (let y = 12; y < 19; y++)
    for (let x = 12; x < 19; x++) rgba[(y * width + x) * 4 + 3] = 0;
  rgba[(2 * width + 2) * 4 + 3] = 255;
  const alpha = silhouetteAlpha(rgba, width, width);
  assert.equal(alpha[15 * width + 15], 255);
  assert.equal(alpha[15 * width + 21], 255);
  assert.equal(alpha[2 * width + 2], 0);
  assert.equal(alpha[15 * width + 5], 0);
  assert.equal(alpha[5 * width + 7], 255);
  assert.ok(
    silhouetteAlpha(new Uint8ClampedArray(64), 4, 4).every(value => value === 0)
  );
});
