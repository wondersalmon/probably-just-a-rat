/** @param {import("../../types/memory.js").ObservationContext} context */
export function contextKey(context) {
  const { sceneId, userId, levelId, sourceIds, mode, permissionKey } = context;
  if (!sceneId || !userId || !mode || !permissionKey || !sourceIds.length)
    throw new TypeError("A limited observation context is required.");
  return JSON.stringify([
    sceneId,
    userId,
    levelId,
    [...new Set(sourceIds)].sort(),
    mode,
    permissionKey
  ]);
}
