import { renderOwnedTexture } from "./static-art.js";
import { normalizeOutlineColor, DEFAULT_OUTLINE_COLOR } from "../appearance.js";

/** Ignore alpha shading inside the creature and fill enclosed transparent holes.
 * @param {Uint8ClampedArray} rgba @param {number} width @param {number} height
 */
export function silhouetteAlpha(rgba, width, height) {
  const count = width * height;
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) mask[i] = rgba[i * 4 + 3] >= 40 ? 1 : 0;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  /** @param {number} start @param {number} value */
  const flood = (start, value) => {
    let head = 0,
      tail = 1;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++],
        x = i % width;
      for (const next of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width
      ]) {
        if (next < 0 || next >= count || seen[next] || mask[next] !== value)
          continue;
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
    return Array.from(queue.subarray(0, tail));
  };
  /** @type {number[][]} */
  const components = [];
  for (let i = 0; i < count; i++)
    if (mask[i] && !seen[i]) components.push(flood(i, 1));
  const largest = components.reduce(
    (n, component) => Math.max(n, component.length),
    0
  );
  mask.fill(0);
  for (const component of components)
    if (component.length >= Math.max(3, largest * 0.015))
      for (const i of component) mask[i] = 1;
  seen.fill(0);
  for (let i = 0; i < count; i++)
    if (
      (i < width ||
        i >= count - width ||
        i % width === 0 ||
        i % width === width - 1) &&
      !mask[i] &&
      !seen[i]
    )
      flood(i, 0);
  return Uint8Array.from(mask, (value, i) => (value || !seen[i] ? 255 : 0));
}

/** Derive only from our frozen texture, never from a live or hidden token.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {any} texture
 */
export function createSilhouette(host, texture) {
  const sprite = new host.PIXI.Sprite(texture);
  let copy = null;
  try {
    // PIXI Extract accepts RenderTexture or DisplayObject, but not the ordinary
    // Texture returned by PNG restoration. Normalize both paths into our own,
    // bounded RenderTexture before reading pixels.
    const { width, height } = texture;
    copy = renderOwnedTexture(host, sprite, {
      x: 0,
      y: 0,
      width,
      height,
      resolution: Math.min(1, 256 / Math.max(width, height))
    });
    const source = host.canvas.app.renderer.extract.canvas(copy);
    const canvas = host.document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const alpha = silhouetteAlpha(image.data, canvas.width, canvas.height);
    for (let i = 0; i < alpha.length; i++) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = alpha[i];
    }
    context.putImageData(image, 0, 0);
    return new host.PIXI.Texture(new host.PIXI.BaseTexture(canvas));
  } catch {
    return null;
  } finally {
    copy?.destroy(true);
    sprite.destroy({ texture: false, baseTexture: false });
  }
}

const fragment = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 inputClamp;
uniform float opacity;
uniform vec3 outlineColor;
float alphaAt(vec2 offset) {
  return texture2D(uSampler, clamp(vTextureCoord + offset * inputSize.zw, inputClamp.xy, inputClamp.zw)).a / opacity;
}
void main() {
  float center = alphaAt(vec2(0.0));
  float inner = 0.0;
  float outer = 0.0;
  for (int i = 0; i < 12; i++) {
    float angle = float(i) * 0.5235987756;
    vec2 direction = vec2(cos(angle), sin(angle));
    inner = max(inner, alphaAt(direction * 1.25));
    outer = max(outer, alphaAt(direction * 2.5));
  }
  float alpha = clamp(outer - center, 0.0, 1.0) * opacity;
  vec3 color = mix(vec3(0.025, 0.035, 0.05), outlineColor, clamp(inner - center, 0.0, 1.0));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

/** @param {any} PIXI @param {number} opacity @param {string} [color] */
export function createOutlineFilter(
  PIXI,
  opacity,
  color = DEFAULT_OUTLINE_COLOR
) {
  const hex = parseInt(normalizeOutlineColor(color).slice(1), 16);
  const filter = new PIXI.Filter(undefined, fragment, {
    opacity,
    outlineColor: [
      (hex >> 16) / 255,
      ((hex >> 8) & 255) / 255,
      (hex & 255) / 255
    ]
  });
  filter.padding = 4;
  return filter;
}
