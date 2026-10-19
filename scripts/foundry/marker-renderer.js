import { MODULE_ID } from "../constants.js";
import { resolveAppearance } from "../appearance.js";
import { createSilhouette, createOutlineFilter } from "./silhouette-outline.js";
import { isSavedImage } from "../local-memory-cache.js";
import { localize, format, snapshotName } from "../localization.js";
import {
  bakeFrozenArt,
  destroyFilters,
  renderOwnedTexture
} from "./static-art.js";

/** Local graphics only, without Documents, interaction managers or source registration. */
export class MarkerRenderer {
  /** @param {import("../../types/foundry.js").FoundryHost} host
   * @param {import("../core/memory-store.js").MemoryStore | null} [store]
   */
  constructor(host, store = null) {
    this.host = host;
    this.store = store;
  }
  /** @type {any} */
  root = null;
  /** @type {any} */
  mask = null;
  /** @type {Map<string, {texture: any, original: any, src: string, savedImage?: string | null, silhouette?: any}>} */
  textures = new Map();
  /** @type {Map<string, {container: any, snapshot: any, record: Readonly<import("../../types/memory.js").MemoryRecord>, captionText: string, caption: any, filters: any[], bakedTexture: any}>} */
  markers = new Map();
  /** @type {Map<string, {x: number, y: number, width: number, height: number}>} */
  visibleBounds = new Map();
  maskDirty = true;
  /** @type {{x: number, y: number, width: number, height: number} | null} */
  maskRect = null;
  /** @type {Partial<{opacity: number, grayscale: number, outline: boolean, outlineColor: string}>} */
  preview = {};

  appearance() {
    return resolveAppearance({
      opacity: this.host.game.settings.get(MODULE_ID, "opacity"),
      grayscale: this.host.game.settings.get(MODULE_ID, "grayscale"),
      outline: this.host.game.settings.get(MODULE_ID, "outline"),
      outlineColor: this.host.game.settings.get(MODULE_ID, "outlineColor"),
      labels: this.host.game.settings.get(MODULE_ID, "labels"),
      ...this.preview
    });
  }

  /** @param {Partial<{opacity: number, grayscale: number, outline: boolean, outlineColor: string}>} values */
  setPreview(values) {
    if (
      this.preview.opacity === values.opacity &&
      this.preview.grayscale === values.grayscale &&
      this.preview.outline === values.outline &&
      this.preview.outlineColor === values.outlineColor
    )
      return false;
    this.preview = { ...values };
    this.rebuild();
    return true;
  }

  /** Freeze occlusion bounds only for a visually confirmed real token.
   * @param {any} token @param {boolean} visible
   */
  trackVisibility(token, visible) {
    const id = token.document.id;
    if (!visible) {
      this.forgetVisibility(id);
      return;
    }
    const bounds = token.mesh.getBounds();
    const { PIXI, canvas } = this.host;
    const a = canvas.interface.toLocal(new PIXI.Point(bounds.x, bounds.y));
    const b = canvas.interface.toLocal(
      new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height)
    );
    const next = {
      x: a.x,
      y: a.y,
      width: b.x - a.x,
      height: b.y - a.y
    };
    const previous = this.visibleBounds.get(id);
    if (
      previous &&
      previous.x === next.x &&
      previous.y === next.y &&
      previous.width === next.width &&
      previous.height === next.height
    )
      return;
    this.visibleBounds.set(id, next);
    this.maskDirty = true;
  }

  /** @param {string} id */
  forgetVisibility(id) {
    if (this.visibleBounds.delete(id)) this.maskDirty = true;
  }

  mount() {
    if (this.root) return;
    const { PIXI, canvas } = this.host;
    this.mask = new PIXI.Graphics();
    this.root = new PIXI.Container();
    this.root.name = "probably-just-a-rat-memory";
    this.root.eventMode = this.mask.eventMode = "none";
    this.root.interactiveChildren = false;
    canvas.interface.addChildAt(this.mask, 0);
    canvas.interface.addChildAt(this.root, 1);
    this.root.mask = this.mask;
    this.maskDirty = true;
  }

  /** Own a static copy made while observed. Never reload an image on loss of sight.
   * @param {string} id @param {any} token @param {import("../../types/memory.js").SnapshotInput} snapshot
   */
  capture(id, token, snapshot) {
    const observedTexture = token.mesh?.texture ?? token.texture;
    const existing = this.textures.get(id);
    if (
      existing &&
      existing.original === observedTexture &&
      existing.src === snapshot.texture
    )
      return;
    this.releaseTexture(id);
    if (!snapshot.texture || !observedTexture?.valid) return;
    const { PIXI } = this.host;
    const sprite = new PIXI.Sprite(observedTexture);
    try {
      const { width, height } = observedTexture;
      if (![width, height].every(n => Number.isFinite(n) && n > 0))
        throw new Error("Invalid observed image dimensions");
      const resolution = Math.min(1, 256 / Math.max(width, height));
      const texture = renderOwnedTexture(this.host, sprite, {
        x: 0,
        y: 0,
        width,
        height,
        resolution
      });
      this.textures.set(id, {
        texture,
        original: observedTexture,
        src: snapshot.texture
      });
    } catch {
      // A geometry-only marker is safer than borrowing a changing or unavailable image.
      this.textures.set(id, {
        texture: null,
        original: observedTexture,
        src: snapshot.texture
      });
    } finally {
      sprite.destroy({ texture: false, baseTexture: false });
    }
  }

  /** @param {string} id */
  releaseTexture(id) {
    // Destroy the marker before the owned texture it uses.
    this.removeMarker(id);
    this.textures.get(id)?.silhouette?.destroy(true);
    this.textures.get(id)?.texture?.destroy(true);
    this.textures.delete(id);
  }
  /** @param {string} id */
  removeMarker(id) {
    // Captions own their PIXI.Text texture; destroy it separately from the cached image sprite.
    this.markers.get(id)?.caption?.destroy({
      children: true,
      texture: true,
      baseTexture: true
    });
    this.markers.get(id)?.container.destroy({
      children: true,
      texture: false,
      baseTexture: false
    });
    this.markers.get(id)?.bakedTexture?.destroy(true);
    destroyFilters(this.markers.get(id)?.filters ?? []);
    this.markers.delete(id);
  }

  /** @param {Readonly<import("../../types/memory.js").MemoryRecord>} record */
  create(record) {
    const { PIXI } = this.host;
    const s = record.snapshot;
    const container = new PIXI.Container();
    container.eventMode = "none";
    container.interactiveChildren = false;
    container.position.set(s.x, s.y);
    const appearance = this.appearance();
    const centerX = s.width / 2;
    const centerY = s.height / 2;
    /** @type {any[]} */
    const filters = [];
    const entry = this.textures.get(record.tokenId);
    const texture = entry?.texture;
    if (texture) {
      if (appearance.outline && entry) {
        if (entry.silhouette === undefined)
          entry.silhouette = createSilhouette(this.host, texture);
        if (entry.silhouette) {
          const outline = this.imageSprite(entry.silhouette, s);
          outline.name = "rat-ghost-outline";
          outline.alpha = appearance.opacity;
          const filter = createOutlineFilter(
            PIXI,
            appearance.opacity,
            appearance.outlineColor
          );
          outline.filters = [filter];
          filters.push(filter);
          container.addChild(outline);
        }
      }
      const sprite = this.imageSprite(texture, s);
      sprite.name = "rat-ghost-image";
      sprite.alpha = appearance.opacity;
      if (appearance.grayscale > 0) {
        const ColorMatrix =
          PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
        const color = new ColorMatrix();
        color.saturate(-appearance.grayscale, false);
        filters.push(color);
        sprite.filters = [color];
      }
      container.addChild(sprite);
    } else {
      const silhouette = new PIXI.Graphics();
      silhouette.name = "rat-ghost-fallback";
      if (appearance.outline)
        silhouette.lineStyle(
          1.5,
          parseInt(appearance.outlineColor.slice(1), 16),
          appearance.opacity
        );
      silhouette
        .beginFill(0xd0d0d0, appearance.opacity)
        .drawEllipse(centerX, centerY, s.width * 0.3, s.height * 0.4)
        .endFill();
      container.addChild(silhouette);
    }
    // Freeze color processing once; captions can update without rebuilding the image.
    const bakedTexture = bakeFrozenArt(this.host, container, filters);
    const caption = this.createCaption(record, appearance);
    if (caption) container.addChild(caption);
    this.root.addChild(container);
    this.markers.set(record.tokenId, {
      container,
      snapshot: s,
      record,
      captionText: this.caption(record),
      caption,
      filters,
      bakedTexture
    });
  }

  /** @param {Readonly<import("../../types/memory.js").MemoryRecord>} record
   * @param {ReturnType<typeof resolveAppearance>} appearance
   */
  createCaption(record, appearance) {
    const { PIXI } = this.host;
    const { snapshot } = record;
    let caption = null;
    if (appearance.labels) {
      caption = new PIXI.Container();
      caption.name = "rat-ghost-caption";
      const text = new PIXI.Text(this.caption(record), {
        fontFamily: "Arial, sans-serif",
        fontSize: appearance.highContrast ? 12 : 11,
        fontWeight: appearance.highContrast ? "600" : "normal",
        fill: appearance.highContrast ? 0xffffff : 0xe0e6ee,
        stroke: appearance.highContrast ? 0x000000 : 0x171c24,
        strokeThickness: appearance.highContrast ? 3 : 2,
        align: "center",
        wordWrap: true,
        wordWrapWidth: Math.max(100, Math.min(180, snapshot.width * 1.5)),
        breakWords: true
      });
      const width =
        (text.width || Math.min(180, this.caption(record).length * 6.5)) + 12;
      const height = (text.height || 14) + 6;
      const background = new PIXI.Graphics();
      if (appearance.highContrast) background.lineStyle(1, 0xffffff, 0.85);
      background
        .beginFill(
          appearance.highContrast ? 0x080808 : 0x171c24,
          appearance.highContrast ? 1 : 0.65
        )
        .drawRoundedRect(-width / 2, 0, width, height, 4)
        .endFill();
      text.anchor.set(0.5, 0);
      text.position.set(0, 3);
      caption.addChild(background);
      caption.addChild(text);
      caption.position.set(snapshot.width / 2, snapshot.height + 6);
    }
    return caption;
  }

  refreshCaptions() {
    const appearance = this.appearance();
    for (const marker of this.markers.values()) {
      marker.caption?.destroy({
        children: true,
        texture: true,
        baseTexture: true
      });
      marker.caption = this.createCaption(marker.record, appearance);
      marker.captionText = this.caption(marker.record);
      if (marker.caption) marker.container.addChild(marker.caption);
    }
  }

  /** @param {any} texture @param {Readonly<import("../../types/memory.js").Snapshot>} s */
  imageSprite(texture, s) {
    const sprite = new this.host.PIXI.Sprite(texture);
    sprite.anchor.set(s.anchorX ?? 0.5, s.anchorY ?? 0.5);
    sprite.width = s.imageWidth ?? s.width;
    sprite.height = s.imageHeight ?? s.height;
    sprite.scale.x *= s.scaleX;
    sprite.scale.y *= s.scaleY;
    sprite.position.set(s.width / 2, s.height / 2);
    sprite.angle = s.rotation;
    return sprite;
  }

  /** Encode only our immutable texture copy, never the current hidden token image. @param {string} id */
  savedImage(id) {
    const entry = this.textures.get(id);
    if (entry?.savedImage !== undefined) return entry.savedImage;
    if (!entry?.texture) return null;
    try {
      const data = this.host.canvas.app.renderer.extract
        .canvas(entry.texture)
        .toDataURL("image/png");
      entry.savedImage = isSavedImage(data) ? data : null;
    } catch {
      entry.savedImage = null;
    }
    return entry.savedImage;
  }

  /** Decode only a local saved PNG into an independent owned texture. @param {string} data */
  async decodeImage(data) {
    if (!isSavedImage(data)) return null;
    const image = this.host.document.createElement("img");
    image.src = data;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 256 ||
      image.naturalHeight > 256
    )
      return null;
    return new this.host.PIXI.Texture(new this.host.PIXI.BaseTexture(image));
  }

  /** @param {string} id @param {any} texture @param {string} data */
  restoreImage(id, texture, data) {
    this.releaseTexture(id);
    this.textures.set(id, {
      texture,
      original: null,
      src: "",
      savedImage: data
    });
  }

  /** @param {Pick<import("../../types/memory.js").MemoryRecord, "snapshot"> & Partial<Pick<import("../../types/memory.js").MemoryRecord, "combatAgeFrom">>} record */
  label(record) {
    const rounds = this.store?.roundsSinceLoss(record);
    return this.host.game.settings.get(MODULE_ID, "showRounds") &&
      typeof rounds === "number"
      ? format(this.host, "RAT.RoundsSinceLoss", { rounds })
      : localize(this.host, "RAT.LastPosition");
  }

  /** Name is only the immutable, permission-checked observed name. @param {Pick<import("../../types/memory.js").MemoryRecord, "snapshot"> & Partial<Pick<import("../../types/memory.js").MemoryRecord, "combatAgeFrom">>} record */
  caption(record) {
    return this.host.game.settings.get(MODULE_ID, "showNames")
      ? `${snapshotName(this.host, record.snapshot.name)}\n${this.label(record)}`
      : this.label(record);
  }

  /** @param {Array<Readonly<import("../../types/memory.js").MemoryRecord>>} records */
  sync(records) {
    this.mount();
    const ids = new Set(records.map(record => record.tokenId));
    for (const id of this.textures.keys())
      if (!ids.has(id)) this.releaseTexture(id);
    const remembered = new Set(
      records
        .filter(record => record.state === "remembered")
        .map(record => record.tokenId)
    );
    for (const id of this.markers.keys())
      if (!remembered.has(id)) this.removeMarker(id);
    for (const record of records) {
      if (record.state !== "remembered") continue;
      const existing = this.markers.get(record.tokenId);
      if (existing?.snapshot === record.snapshot) {
        if (existing.captionText !== this.caption(record))
          this.refreshCaptions();
        continue;
      }
      this.removeMarker(record.tokenId);
      this.create(record);
    }
    this.updateMask();
  }

  updateMask() {
    const { canvas } = this.host;
    const rect = canvas.dimensions.rect;
    if (
      !this.maskDirty &&
      this.maskRect &&
      this.maskRect.x === rect.x &&
      this.maskRect.y === rect.y &&
      this.maskRect.width === rect.width &&
      this.maskRect.height === rect.height
    )
      return;
    this.mask
      .clear()
      .beginFill(0xffffff)
      .drawRect(rect.x, rect.y, rect.width, rect.height);
    // The overlay is above fog but below HUD. Cut out actual visible token meshes so
    // remembered graphics never paint over a real token; no hidden geometry is read.
    for (const bounds of this.visibleBounds.values()) {
      this.mask
        .beginHole()
        .drawRect(bounds.x, bounds.y, bounds.width, bounds.height)
        .endHole();
    }
    this.mask.endFill();
    this.maskRect = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
    this.maskDirty = false;
  }

  rebuild() {
    for (const id of this.markers.keys()) this.removeMarker(id);
  }
  clear() {
    for (const id of this.markers.keys()) this.removeMarker(id);
    for (const id of this.textures.keys()) this.releaseTexture(id);
    this.visibleBounds.clear();
    this.root?.destroy({ children: true, texture: false, baseTexture: false });
    this.mask?.destroy();
    this.root = this.mask = null;
    this.maskRect = null;
    this.maskDirty = true;
  }
}
