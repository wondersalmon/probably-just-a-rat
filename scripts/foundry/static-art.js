/** Destroy only the filters owned by this marker, including BlurFilter passes.
 * @param {any[]} filters
 */
export function destroyFilters(filters) {
  for (const filter of filters) {
    filter.blurXFilter?.destroy();
    filter.blurYFilter?.destroy();
    filter.destroy();
  }
}

/** Own the allocation before rendering so an exception cannot orphan it.
 * @param {import("../../types/foundry.js").FoundryHost} host
 * @param {any} container
 * @param {{x: number, y: number, width: number, height: number, resolution: number}} region
 * @returns {any}
 */
export function renderOwnedTexture(host, container, region) {
  const { PIXI, canvas } = host;
  const { x, y, width, height, resolution } = region;
  const transform = container.transform;
  const texture = PIXI.RenderTexture.create({
    width,
    height,
    resolution,
    multisample: canvas.app.renderer.multisample ?? 0
  });
  try {
    container.transform = new PIXI.Transform();
    canvas.app.renderer.render(container, {
      renderTexture: texture,
      clear: true,
      transform: new PIXI.Matrix(1, 0, 0, 1, -x, -y),
      skipUpdateTransform: false,
      blit: true
    });
    return texture;
  } catch (error) {
    texture.destroy(true);
    throw error;
  } finally {
    container.transform = transform;
  }
}

/** Flatten frozen artwork once, never captions, native meshes or shared textures.
 * Returns an owned texture or retains the live artwork on unsupported/failed baking.
 * @param {import("../../types/foundry.js").FoundryHost} host
 * @param {any} container @param {any[]} filters
 * @returns {any}
 */
export function bakeFrozenArt(host, container, filters) {
  const { PIXI, canvas } = host;
  if (
    !PIXI.RenderTexture?.create ||
    !PIXI.Matrix ||
    !PIXI.Transform ||
    !canvas.app.renderer.render ||
    !container.getLocalBounds ||
    !container.removeChildren
  )
    return null;
  let texture = null;
  let sprite = null;
  try {
    const bounds = container.getLocalBounds();
    const padding = Math.max(
      16,
      ...filters.map(filter => Number(filter.padding) || 0)
    );
    const x = Math.floor(bounds.x - padding),
      y = Math.floor(bounds.y - padding);
    const width = Math.ceil(bounds.x + bounds.width + padding) - x;
    const height = Math.ceil(bounds.y + bounds.height + padding) - y;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0
    )
      return null;
    const resolution = Math.min(2, 512 / Math.max(width, height));
    const resolutions = filters.map(filter => [filter, filter.resolution]);
    try {
      for (const [filter, value] of resolutions)
        filter.resolution = Math.min(Number(value) || 1, resolution);
      texture = renderOwnedTexture(host, container, {
        x,
        y,
        width,
        height,
        resolution
      });
    } finally {
      for (const [filter, value] of resolutions) {
        if (value === undefined) delete filter.resolution;
        else filter.resolution = value;
      }
    }
    if (
      !texture ||
      texture.valid === false ||
      texture.baseTexture?.realWidth > 512 ||
      texture.baseTexture?.realHeight > 512
    )
      throw new Error("Invalid static-art texture");
    sprite = new PIXI.Sprite(texture);
    sprite.name = "rat-ghost-baked";
    sprite.eventMode = "none";
    sprite.position.set(x, y);
    sprite.width = width;
    sprite.height = height;
  } catch {
    sprite?.destroy({ texture: false, baseTexture: false });
    texture?.destroy(true);
    return null;
  }
  // Commit only after texture creation succeeded; a failure leaves the original visible.
  for (const child of container.removeChildren())
    child.destroy({ children: true, texture: false, baseTexture: false });
  destroyFilters(filters);
  filters.length = 0;
  container.addChild(sprite);
  return texture;
}
