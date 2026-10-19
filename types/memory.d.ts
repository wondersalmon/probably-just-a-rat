export interface ObservationContext {
  sceneId: string;
  userId: string;
  levelId: string | null;
  sourceIds: string[];
  mode: string;
  permissionKey: string;
}
export interface SnapshotInput {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  levelId: string | null;
  texture: string | null;
  name: string;
  imageWidth?: number;
  imageHeight?: number;
  anchorX?: number;
  anchorY?: number;
}
export interface CombatStamp {
  id: string;
  round: number;
  turn: number | null;
}
export interface Snapshot extends SnapshotInput {
  observedAt: number;
  combat: Readonly<CombatStamp> | null;
}
export interface MemoryRecord {
  tokenId: string;
  sceneId: string;
  contextKey: string;
  state: "observed" | "remembered";
  snapshot: Readonly<Snapshot>;
  expiresFrom: number;
  combatAgeFrom: number | null;
}
export interface MemoryPolicy {
  combatRounds: number;
  seconds: number;
  clearOnCombatEnd: boolean;
}
export interface MemoryCheckpoint {
  contextKey: string;
  combat: CombatStamp | null;
  roundHighWater: number;
  records: Array<{
    tokenId: string;
    snapshot: Snapshot;
    ageMs: number;
    seenAgeMs: number;
    combatAgeFrom: number | null;
  }>;
}
