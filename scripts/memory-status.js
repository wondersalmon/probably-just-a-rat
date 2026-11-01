import { MODULE_ID } from "./constants.js";
import { memoryPolicy, sceneMemoryMode } from "./settings.js";
import {
  encounterMemory,
  isDaggerheart,
  memoryTextKey
} from "./system-profile.js";
import { format, localize } from "./localization.js";

/** Only saved policy, without scene identity, targets or preview state.
 * @param {import('../types/foundry.js').FoundryHost} host
 * @param {"world" | "long" | "disabled"} [mode]
 */
export function memoryRules(host, mode = sceneMemoryMode(host.canvas?.scene)) {
  const { settings, system } = host.game;
  const policy = memoryPolicy(settings, undefined, system?.id);
  return Object.freeze({
    mode,
    lifetime:
      mode === "long"
        ? "long"
        : encounterMemory(settings, system?.id)
          ? "encounter"
          : isDaggerheart(system?.id)
            ? "steps"
            : "rounds",
    rounds: policy.combatRounds,
    minutes: policy.seconds / 60,
    combatOnly:
      mode !== "long" && Boolean(settings.get(MODULE_ID, "combatOnly")),
    keepHidden:
      mode === "long" || Boolean(settings.get(MODULE_ID, "rememberHidden"))
  });
}

/** Shared compact and detailed text for the panel and SceneConfig.
 * @param {import('../types/foundry.js').FoundryHost} host
 * @param {ReturnType<typeof memoryRules>} rules
 */
export function memoryRulesText(host, rules) {
  if (rules.mode !== "world")
    return {
      summary: localize(host, `RAT.Rules.${rules.mode}`),
      detail: localize(host, `RAT.Scene.Effective.${rules.mode}`)
    };
  const values = {
    rounds: rules.rounds,
    minutes: rules.minutes,
    hidden: localize(
      host,
      rules.keepHidden
        ? "RAT.Scene.Effective.KeepHidden"
        : "RAT.Scene.Effective.RemoveHidden"
    ),
    activity: localize(
      host,
      rules.combatOnly
        ? "RAT.Scene.Effective.CombatOnly"
        : "RAT.Scene.Effective.AnyTime"
    )
  };
  const key =
    rules.lifetime === "encounter"
      ? "RAT.Daggerheart.Scene.WorldEncounter"
      : memoryTextKey(host.game.system?.id, "RAT.Scene.Effective.world");
  const lifetime = format(host, `RAT.Rules.${rules.lifetime}`, values);
  return {
    summary: rules.combatOnly
      ? format(host, "RAT.Rules.combatOnly", { lifetime })
      : format(host, "RAT.Rules.anyTime", { lifetime, minutes: rules.minutes }),
    detail: format(host, key, values)
  };
}

/** Export only explicitly allowed metadata. Never serialize raw diagnostics or documents.
 * @param {import('../types/foundry.js').FoundryHost} host
 * @param {string} state
 * @param {ReturnType<typeof memoryRules>} rules
 */
export function supportReport(host, state, rules) {
  if (!host.game.user?.isGM) return null;
  const metadata = (/** @type {unknown} */ value) =>
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,79}$/.test(value)
      ? value
      : "unknown";
  const choice = (
    /** @type {string} */ value,
    /** @type {string[]} */ options
  ) => (options.includes(value) ? value : "unknown");
  return JSON.stringify(
    {
      reportVersion: 1,
      foundry: {
        generation: Number.isInteger(host.game.release?.generation)
          ? host.game.release.generation
          : null,
        version: metadata(host.game.version)
      },
      rat: metadata(host.game.modules.get(MODULE_ID)?.version),
      system: {
        id: metadata(host.game.system?.id),
        version: metadata(host.game.system?.version)
      },
      state: choice(state, [
        "active",
        "no-scene",
        "disabled",
        "token-vision",
        "combat-only",
        "select-token",
        "no-source",
        "blinded",
        "unsupported",
        "suspended"
      ]),
      rules: {
        mode: choice(rules.mode, ["world", "long", "disabled"]),
        lifetime: choice(rules.lifetime, [
          "rounds",
          "steps",
          "encounter",
          "long"
        ]),
        rounds:
          Number.isInteger(rules.rounds) && rules.rounds >= 0
            ? rules.rounds
            : null,
        minutes:
          Number.isFinite(rules.minutes) && rules.minutes > 0
            ? rules.minutes
            : null,
        combatOnly: rules.combatOnly === true,
        keepHidden: rules.keepHidden === true
      }
    },
    null,
    2
  );
}
