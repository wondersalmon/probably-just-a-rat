import { localize } from "../localization.js";
import { renderOwnedTexture } from "./static-art.js";

/** One GM-selected image shared by this client's markers, with an owned static copy. */
export class CustomMarkerImage {
  /** @param {import("../../types/foundry.js").FoundryHost} host @param {() => void} changed */
  constructor(host, changed) {
    this.host = host;
    this.changed = changed;
  }
  src = "";
  generation = 0;
  /** @type {any} */
  texture = null;
  /** @type {any} */
  silhouette = undefined;

  /** Loading uses only the GM-selected path, never a token image or hidden token data.
   * @param {string} src
   */
  use(src) {
    if (this.src === src) return;
    this.clear();
    this.src = src;
    if (src) void this.load(src, this.generation);
  }

  /** @param {string} src @param {number} generation */
  async load(src, generation) {
    try {
      const loadTexture = this.host.foundry?.canvas?.loadTexture;
      if (!loadTexture) throw new Error("Texture loader unavailable");
      const shared = await loadTexture(src);
      if (generation !== this.generation) return;
      if (
        !shared?.valid ||
        ![shared.width, shared.height].every(n => Number.isFinite(n) && n > 0)
      )
        throw new Error("Invalid marker image");
      const sprite = new this.host.PIXI.Sprite(shared);
      try {
        this.texture = renderOwnedTexture(this.host, sprite, {
          x: 0,
          y: 0,
          width: shared.width,
          height: shared.height,
          resolution: Math.min(1, 256 / Math.max(shared.width, shared.height))
        });
      } finally {
        sprite.destroy({ texture: false, baseTexture: false });
      }
    } catch {
      if (generation === this.generation && this.host.game.user.isGM)
        this.host.ui.notifications.warn(
          localize(this.host, "RAT.CustomImageFailed")
        );
    }
    if (generation === this.generation) this.changed();
  }

  clear() {
    this.generation++;
    this.src = "";
    this.silhouette?.destroy(true);
    this.texture?.destroy(true);
    this.silhouette = undefined;
    this.texture = null;
  }
}
