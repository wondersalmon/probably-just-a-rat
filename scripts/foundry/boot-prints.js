import { markerFillColor } from "../appearance.js";

/** Draw a closed rubber lug, keeping the gaps open at small canvas scales.
 * @param {any} graphics @param {number[][]} points @param {number} color
 */
function treadBlock(graphics, points, color) {
  graphics.beginFill(color, 0.94).moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) graphics.lineTo(x, y);
  graphics.lineTo(points[0][0], points[0][1]).endFill();
}

/** Draw a fixed pair of mirrored boot prints using only saved footprint dimensions.
 * Optional orientation uses only the last continuously observed movement, frozen with the snapshot.
 * @param {import("../../types/foundry.js").FoundryHost} host
 * @param {Readonly<import("../../types/memory.js").Snapshot>} snapshot
 * @param {ReturnType<typeof import("../appearance.js").resolveAppearance>} appearance
 */
export function createBootPrints(host, snapshot, appearance) {
  const prints = new host.PIXI.Container();
  prints.name = "rat-boot-prints";
  prints.eventMode = "none";
  prints.interactiveChildren = false;
  prints.position.set(snapshot.width / 2, snapshot.height / 2);
  prints.scale.set(Math.min(snapshot.width, snapshot.height) / 100);
  prints.angle = appearance.customMarkerRotate
    ? (snapshot.movementAngle ?? 0)
    : 0;
  prints.alpha = appearance.opacity;
  const color = markerFillColor(appearance.grayscale);
  const outline = parseInt(appearance.outlineColor.slice(1), 16);
  for (const [x, y, angle, mirror] of [
    [-17, -9, -8, -1],
    [17, 9, 8, 1]
  ]) {
    const boot = new host.PIXI.Container();
    boot.position.set(x, y);
    boot.angle = angle;
    boot.scale.x = mirror;
    // Asymmetric toe box, narrow instep and separate heel of a walking boot.
    const sole = new host.PIXI.Graphics();
    sole.lineStyle(appearance.outline ? 1.8 : 0, outline, 1);
    sole
      .beginFill(color, 0.13)
      .moveTo(-3, -34)
      .bezierCurveTo(-12, -34, -14, -27, -13, -18)
      .bezierCurveTo(-13, -9, -10, -3, -8, 3)
      .bezierCurveTo(-6, 7, -7, 10, -7, 12)
      .lineTo(7, 12)
      .bezierCurveTo(7, 5, 10, 0, 12, -7)
      .bezierCurveTo(16, -19, 13, -31, 5, -33)
      .bezierCurveTo(2, -34, -1, -34, -3, -34)
      .endFill()
      .beginFill(color, 0.13)
      .moveTo(-7, 17)
      .lineTo(7, 17)
      .lineTo(8, 28)
      .bezierCurveTo(8, 35, -8, 35, -8, 28)
      .lineTo(-7, 17)
      .endFill();
    boot.addChild(sole);
    const tread = new host.PIXI.Graphics();
    // Curved toe cap, split tread bars and a clean central drainage channel.
    tread
      .beginFill(color, 0.9)
      .moveTo(-9, -25)
      .bezierCurveTo(-8, -33, 7, -33, 10, -25)
      .lineTo(6, -23)
      .bezierCurveTo(3, -28, -3, -28, -6, -23)
      .lineTo(-9, -25)
      .endFill();
    for (const [row, width] of [
      [-19, 10],
      [-11, 10.5],
      [-3, 8],
      [5, 5.5]
    ]) {
      for (const side of [-1, 1]) {
        treadBlock(
          tread,
          [
            [side * 1.4, row - 1],
            [side * (width - 1), row - 4],
            [side * width, row - 0.5],
            [side * (width - 1), row + 1],
            [side * 1.4, row + 3.5]
          ],
          color
        );
      }
    }
    // Two heel bars share the same split as the forefoot.
    for (const row of [21, 28])
      for (const side of [-1, 1])
        treadBlock(
          tread,
          [
            [side * 1.4, row - 2],
            [side * 5.5, row - 2.5],
            [side * 6, row + 1.5],
            [side * 1.4, row + 2]
          ],
          color
        );
    boot.addChild(tread);
    prints.addChild(boot);
  }
  return prints;
}
