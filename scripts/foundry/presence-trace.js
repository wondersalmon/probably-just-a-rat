import { markerFillColor } from "../appearance.js";

/** A hollow cartographic pin with optional frozen movement orientation.
 * @param {import("../../types/foundry.js").FoundryHost} host
 * @param {Readonly<import("../../types/memory.js").Snapshot>} snapshot
 * @param {ReturnType<typeof import("../appearance.js").resolveAppearance>} appearance
 */
export function createPresenceTrace(host, snapshot, appearance) {
  const trace = new host.PIXI.Container();
  trace.name = "rat-presence-trace";
  trace.eventMode = "none";
  trace.interactiveChildren = false;
  trace.position.set(snapshot.width / 2, snapshot.height / 2);
  trace.scale.set(Math.min(snapshot.width, snapshot.height) / 100);
  trace.angle = appearance.customMarkerRotate
    ? (snapshot.movementAngle ?? 0)
    : 0;
  trace.alpha = appearance.opacity;
  const color = markerFillColor(appearance.grayscale);
  const pin = new host.PIXI.Graphics();
  pin.lineStyle({
    width: appearance.outline ? 1.8 : 0,
    color: parseInt(appearance.outlineColor.slice(1), 16),
    alpha: 1,
    join: host.PIXI.LINE_JOIN?.ROUND ?? "round"
  });
  pin
    .beginFill(color)
    .moveTo(0, 25)
    .bezierCurveTo(-4, 18, -19, 2, -19, -12)
    .bezierCurveTo(-19, -38, 19, -38, 19, -12)
    .bezierCurveTo(19, 2, 4, 18, 0, 25)
    .beginHole()
    .drawEllipse(0, -13, 9, 9)
    .endHole()
    .endFill();
  trace.addChild(pin);
  // Small ground stroke separates the remembered location from a token image.
  const ground = new host.PIXI.Graphics();
  ground
    .beginFill(color, 0.35)
    .drawRoundedRect(-8, 32, 16, 2.5, 1.25)
    .endFill();
  trace.addChild(ground);
  return trace;
}
