import { MODULE_ID } from "../constants.js";

/** Isolated native v14 boundary. External engine objects are intentionally opaque. */
export class VisibilityAdapter {
  /** @param {import("../../types/foundry.js").FoundryHost} host */
  constructor(host) {
    this.host = host;
  }
  lastVisibilityReason = "unchecked";

  /** @param {string} reason */
  reject(reason) {
    this.lastVisibilityReason = reason;
    return false;
  }

  context() {
    const { canvas, game } = this.host;
    if (
      !canvas?.ready ||
      !canvas.scene ||
      !canvas.level ||
      !game.user ||
      !canvas.visibility?.tokenVision
    )
      return null;
    if (game.settings.get(MODULE_ID, "combatOnly") && !this.combat())
      return null;
    if (
      typeof canvas.visibility._createVisibilityTestConfig !== "function" ||
      !canvas.app?.ticker?.add ||
      !this.host.PIXI?.Container
    )
      throw new Error("Required Foundry v14 canvas API is unavailable.");
    const sources = [...canvas.effects.visionSources.entries()].filter(
      ([_id, source]) => {
        const token = source.object;
        return (
          source.active &&
          !source.isPreview &&
          token &&
          !token.isPreview &&
          !token.document.hidden &&
          token.document.level === canvas.level.id &&
          (game.user.isGM
            ? token.controlled
            : token.actor?.testUserPermission(game.user, "OBSERVER"))
        );
      }
    );
    if (!sources.length) return null;
    return {
      sceneId: canvas.scene.id,
      userId: game.user.id,
      levelId: canvas.level.id,
      sourceIds: sources.map(([id]) => String(id)),
      mode: JSON.stringify(
        sources
          .map(([id, source]) => [id, source.visionMode?.id ?? "basic"])
          .sort()
      ),
      permissionKey: JSON.stringify([
        game.user.role,
        game.user.isGM,
        sources
          .map(([id, source]) => [id, source.object.document.isOwner])
          .sort()
      ]),
      sources: sources.map(([_id, source]) => source)
    };
  }

  /** @param {any} token */
  candidate(token) {
    const doc = token.document;
    if (token.isPreview || doc.parent?.id !== this.host.canvas.scene?.id)
      return false;
    const override = doc.getFlag(MODULE_ID, "memory");
    if (override === "off") return false;
    if (override === "on") return true;
    return doc.disposition === this.host.CONST.TOKEN_DISPOSITIONS.HOSTILE;
  }

  /** Confirm native visual detection at the displayed geometry, not the document destination.
   * @param {any} token @param {NonNullable<ReturnType<VisibilityAdapter["context"]>>} context
   */
  visible(token, context) {
    const { canvas, CONFIG } = this.host;
    const doc = token.document;
    const mesh = token.mesh;
    if (doc.hidden) return this.reject("hidden");
    if (doc.level !== context.levelId) return this.reject("other-level");
    if (token.isPreview) return this.reject("preview");
    if (token.isFilteredOut) return this.reject("filtered");
    if (!token.visible) return this.reject("token-not-visible");
    if (!mesh?.visible) return this.reject("mesh-not-visible");
    if (!mesh.renderable) return this.reject("mesh-not-renderable");
    if (mesh.alpha === 0) return this.reject("transparent-mesh");
    const { x, y } = token.position;
    // During asynchronous redraw or native animation updates, refuse an inconsistent representation.
    if (
      Math.abs(mesh.position.x - (x + token.w / 2)) > 0.01 ||
      Math.abs(mesh.position.y - (y + token.h / 2)) > 0.01
    )
      return this.reject("mesh-position-mismatch");
    const points = doc.getVisibilityTestPoints({
      x,
      y,
      elevation: mesh.elevation
    });
    const config = canvas.visibility._createVisibilityTestConfig(points, {
      object: token,
      tolerance: 0
    });
    const rect = canvas.dimensions.sceneRect;
    const inBuffer = points.every(
      /** @param {any} point */ point => !rect.contains(point.x, point.y)
    );
    // Deliberately exclude special detection, sound and light sources granting omniscient vision.
    for (const source of context.sources) {
      if (source.isBlinded || inBuffer === rect.contains(source.x, source.y))
        continue;
      for (const id of ["basicSight", "lightPerception"]) {
        const mode = source.object.document.detectionModes[id];
        const detector = CONFIG.Canvas.detectionModes[id];
        if (mode && detector?.testVisibility(source, mode, config) === true) {
          this.lastVisibilityReason = "observed";
          return true;
        }
      }
    }
    return this.reject("visual-detection-failed");
  }

  /** Call only following visible(). @param {any} token */
  snapshot(token) {
    const mesh = token.mesh;
    const texture = mesh.texture ?? token.texture;
    const resource = texture?.baseTexture?.resource;
    const source = resource?.source;
    // PIXI Assets prefers ImageBitmap; its URL lives on the loaded resource, not the bitmap.
    const observedSrc =
      source?.currentSrc ||
      source?.src ||
      resource?.src ||
      resource?.url ||
      null;
    const animated =
      source?.tagName === "VIDEO" ||
      /\.(?:gif|webm|mp4|m4v)(?:[?#]|$)/i.test(observedSrc ?? "");
    // Native ring UVs shrink the subject inside an enlarged mesh. A plain Sprite
    // needs the inverse UV scale and its matching anchor to retain the visible size.
    const ringScale = token.hasDynamicRing
      ? token.ring?.textureScaleAdjustment
      : 1;
    const subjectScale =
      Number.isFinite(ringScale) && ringScale > 0 ? ringScale : 1;
    return {
      x: token.position.x,
      y: token.position.y,
      width: token.w,
      height: token.h,
      rotation: mesh.angle,
      scaleX: Math.sign(mesh.scale.x) || 1,
      scaleY: Math.sign(mesh.scale.y) || 1,
      imageWidth: (Math.abs(mesh.width) || token.w) / subjectScale,
      imageHeight: (Math.abs(mesh.height) || token.h) / subjectScale,
      anchorX: 0.5 + (mesh.anchor.x - 0.5) * subjectScale,
      anchorY: 0.5 + (mesh.anchor.y - 0.5) * subjectScale,
      levelId: token.document.level,
      texture: animated || !texture?.valid ? null : observedSrc,
      name:
        this.host.game.settings.get(MODULE_ID, "showNames") &&
        (this.host.game.user.isGM ||
          token.document.disposition !==
            this.host.CONST.TOKEN_DISPOSITIONS.SECRET) &&
        token.document.name
          ? String(token.document.name)
          : ""
    };
  }

  combat() {
    const combat = this.host.game.combat;
    return combat?.started &&
      (combat.scene === null || combat.scene?.id === this.host.canvas.scene?.id)
      ? { id: combat.id, round: combat.round, turn: combat.turn ?? null }
      : null;
  }
}
