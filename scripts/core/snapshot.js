/**
 * Accept only an adapter-confirmed visual snapshot, never a TokenDocument.
 * Explicit fields keep Actor state and unknown document fields out of memory.
 * @param {import("../../types/memory.js").SnapshotInput} input
 * @param {number} observedAt
 * @param {import("../../types/memory.js").CombatStamp | null} combat
 * @param {number} [movementAngle] Clockwise degrees from up; independent of token artwork rotation.
 * @returns {Readonly<import("../../types/memory.js").Snapshot>}
 */
export function freezeSnapshot(input, observedAt, combat, movementAngle = 0) {
  const {
    x,
    y,
    width,
    height,
    rotation,
    scaleX,
    scaleY,
    levelId,
    texture,
    name
  } = input;
  const {
    imageWidth = width,
    imageHeight = height,
    anchorX = 0.5,
    anchorY = 0.5
  } = input;
  if (
    ![
      x,
      y,
      width,
      height,
      rotation,
      scaleX,
      scaleY,
      imageWidth,
      imageHeight,
      anchorX,
      anchorY,
      movementAngle
    ].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    typeof name !== "string" ||
    (texture !== null && typeof texture !== "string") ||
    (levelId !== null && typeof levelId !== "string")
  )
    throw new TypeError("Invalid visual snapshot.");
  return Object.freeze({
    x,
    y,
    width,
    height,
    rotation,
    scaleX,
    scaleY,
    levelId,
    texture,
    name,
    imageWidth,
    imageHeight,
    anchorX,
    anchorY,
    movementAngle: ((movementAngle % 360) + 360) % 360,
    observedAt,
    combat: combat ? Object.freeze({ ...combat }) : null
  });
}
