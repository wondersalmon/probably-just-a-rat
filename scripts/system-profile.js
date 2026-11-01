import { MODULE_ID } from "./constants.js";

/** @param {string | undefined} systemId */
export function isDaggerheart(systemId) {
  return systemId === "daggerheart";
}

/** Keep native combat counters and saved durations; only Daggerheart adds an expiry choice.
 * @param {import("../types/foundry.js").SettingsService} settings
 * @param {string | undefined} systemId @param {unknown} [draft]
 */
export function encounterMemory(settings, systemId, draft) {
  return (
    isDaggerheart(systemId) &&
    (draft ?? settings.get(MODULE_ID, "daggerheartCombatMemory")) ===
      "encounter"
  );
}

/** System terminology is scoped to Rat; native Foundry localization is untouched.
 * @param {string | undefined} systemId @param {string} key
 */
export function memoryTextKey(systemId, key) {
  if (!isDaggerheart(systemId)) return key;
  /** @type {Record<string, string>} */
  const keys = {
    "RAT.Settings.memoryRounds.Name": "RAT.Daggerheart.MemorySteps.Name",
    "RAT.Settings.memoryRounds.Hint": "RAT.Daggerheart.MemorySteps.Hint",
    "RAT.Settings.memoryRounds.Validation":
      "RAT.Daggerheart.MemorySteps.Validation",
    "RAT.Settings.showRounds.Name": "RAT.Daggerheart.ShowSteps.Name",
    "RAT.Settings.showRounds.Hint": "RAT.Daggerheart.ShowSteps.Hint",
    "RAT.RoundsSinceLoss": "RAT.Daggerheart.StepsSinceLoss",
    "RAT.Settings.Preview.Rounds": "RAT.Daggerheart.Preview.Steps",
    "RAT.Scene.Effective.world": "RAT.Daggerheart.Scene.WorldSteps"
  };
  return keys[key] ?? key;
}
