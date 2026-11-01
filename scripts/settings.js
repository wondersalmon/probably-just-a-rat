import { MODULE_ID, MEMORY_DEFAULTS } from "./constants.js";
import { DEFAULT_OUTLINE_COLOR } from "./appearance.js";
import {
  encounterMemory,
  isDaggerheart,
  memoryTextKey
} from "./system-profile.js";

/** @param {import("../types/foundry.js").SettingsService} settings @param {(key: string) => void} onAppearance
 * @param {any} [ColorField] @param {any} [FilePathField] @param {any} [NumberField]
 * @param {string} [systemId]
 */
export function registerSettings(
  settings,
  onAppearance,
  ColorField,
  FilePathField,
  NumberField,
  systemId
) {
  /** @type {Array<{key: string} & Pick<Parameters<import("../types/foundry.js").SettingsService["register"]>[2], "type" | "default" | "choices" | "range">>} */
  const definitions = [
    {
      key: "language",
      type: String,
      default: "foundry",
      choices: {
        foundry: "RAT.Language.Foundry",
        en: "RAT.Language.English",
        ru: "RAT.Language.Russian"
      }
    },
    {
      key: "markerStyle",
      type: String,
      default: "ghost",
      choices: {
        ghost: "RAT.MarkerStyle.Ghost",
        footprints: "RAT.MarkerStyle.Footprints",
        presence: "RAT.MarkerStyle.Presence",
        custom: "RAT.MarkerStyle.Custom"
      }
    },
    {
      key: "customMarkerImage",
      type: FilePathField
        ? new FilePathField({
            required: true,
            nullable: false,
            blank: true,
            categories: ["IMAGE"],
            initial: ""
          })
        : String,
      default: ""
    },
    {
      // Keep the saved key while sharing movement rotation across all marker styles.
      key: "customMarkerRotate",
      type: Boolean,
      default: false
    },
    {
      key: "opacity",
      type: Number,
      default: 50,
      range: { min: 30, max: 80, step: 5 }
    },
    {
      key: "grayscale",
      type: Number,
      default: 30,
      range: { min: 0, max: 100, step: 5 }
    },
    {
      key: "outline",
      type: Boolean,
      default: false
    },
    {
      key: "outlineColor",
      type: ColorField
        ? new ColorField({
            required: true,
            nullable: false,
            initial: DEFAULT_OUTLINE_COLOR
          })
        : String,
      default: DEFAULT_OUTLINE_COLOR
    },
    {
      key: "captionStyle",
      type: String,
      default: "standard",
      choices: {
        off: "RAT.Caption.Off",
        standard: "RAT.Caption.Standard",
        contrast: "RAT.Caption.Contrast"
      }
    },
    {
      key: "labels",
      type: String,
      default: "world",
      choices: {
        world: "RAT.Caption.World",
        standard: "RAT.Caption.Standard",
        contrast: "RAT.Caption.Contrast"
      }
    },
    {
      key: "sharePings",
      type: String,
      // Keep the existing key and string-cast Boolean values to preserve native saves.
      default: "true",
      choices: {
        false: "RAT.PingAudience.Local",
        true: "RAT.PingAudience.Shared"
      }
    }
  ];
  for (const definition of definitions) {
    const { key, ...config } = definition;
    settings.register(MODULE_ID, key, {
      ...config,
      name: `RAT.Settings.${key}.Name`,
      hint: `RAT.Settings.${key}.Hint`,
      scope: [
        "sharePings",
        "markerStyle",
        "customMarkerImage",
        "customMarkerRotate",
        "captionStyle"
      ].includes(key)
        ? "world"
        : "client",
      config: true,
      onChange: key === "sharePings" ? () => {} : () => onAppearance(key)
    });
  }
  settings.register(MODULE_ID, "showNames", {
    name: "RAT.Settings.showNames.Name",
    hint: "RAT.Settings.showNames.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => onAppearance("showNames")
  });
  settings.register(MODULE_ID, "showRounds", {
    name: memoryTextKey(systemId, "RAT.Settings.showRounds.Name"),
    hint: memoryTextKey(systemId, "RAT.Settings.showRounds.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => onAppearance("showRounds")
  });
  settings.register(MODULE_ID, "rememberHidden", {
    name: "RAT.Settings.rememberHidden.Name",
    hint: "RAT.Settings.rememberHidden.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => onAppearance("rememberHidden")
  });
  settings.register(MODULE_ID, "combatOnly", {
    name: "RAT.Settings.combatOnly.Name",
    hint: "RAT.Settings.combatOnly.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => onAppearance("combatOnly")
  });
  for (const [key, value] of [
    ["memoryRounds", MEMORY_DEFAULTS.combatRounds],
    ["memoryMinutes", MEMORY_DEFAULTS.seconds / 60]
  ])
    settings.register(MODULE_ID, String(key), {
      name: memoryTextKey(systemId, `RAT.Settings.${key}.Name`),
      hint: memoryTextKey(systemId, `RAT.Settings.${key}.Hint`),
      scope: "world",
      config: true,
      type: NumberField
        ? new NumberField({
            required: true,
            nullable: false,
            initial: value,
            // Integer cleaning can round fractions before validation. Validate
            // explicitly so that a requested fraction is rejected unchanged.
            integer: false,
            validate: /** @param {unknown} candidate */ candidate =>
              isMemoryDurationValid(String(key), candidate),
            validationError: memoryTextKey(
              systemId,
              `RAT.Settings.${key}.Validation`
            )
          })
        : Number,
      default: value,
      onChange: () => onAppearance(String(key))
    });
  if (isDaggerheart(systemId))
    settings.register(MODULE_ID, "daggerheartCombatMemory", {
      name: "RAT.Settings.daggerheartCombatMemory.Name",
      hint: "RAT.Settings.daggerheartCombatMemory.Hint",
      scope: "world",
      config: true,
      type: String,
      // Preserve the existing counter-based behavior and memoryRounds value.
      default: "steps",
      choices: {
        steps: "RAT.Daggerheart.Mode.Steps",
        encounter: "RAT.Daggerheart.Mode.Encounter"
      },
      onChange: () => onAppearance("daggerheartCombatMemory")
    });
}

/** Scene-specific exploration rule. No token data is read.
 * @param {any} scene
 */
export function sceneRetainsMemory(scene) {
  return sceneMemoryMode(scene) === "long";
}

/** Explicit modes override the legacy checkbox, which remains readable.
 * @param {any} scene @returns {"world" | "long" | "disabled"}
 */
export function sceneMemoryMode(scene) {
  const mode = scene?.getFlag?.(MODULE_ID, "memoryMode");
  if (["world", "long", "disabled"].includes(mode)) return mode;
  return scene?.getFlag?.(MODULE_ID, "overlandMemory") === true
    ? "long"
    : "world";
}

/** A shared predicate for native field and form validation; never coerces data.
 * @param {string} key @param {unknown} value
 */
export function isMemoryDurationValid(key, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return false;
  return key === "memoryRounds"
    ? Number.isInteger(value)
    : key === "memoryMinutes" && Number.isFinite(value * 60);
}

/** Read positive durations; malformed values fall back to defaults.
 * @param {import("../types/foundry.js").SettingsService} settings
 * @param {any} [scene]
 * @param {string} [systemId]
 */
export function memoryPolicy(settings, scene, systemId) {
  const rounds = settings.get(MODULE_ID, "memoryRounds");
  const minutes = settings.get(MODULE_ID, "memoryMinutes");
  return {
    retainUntilRediscovered: sceneRetainsMemory(scene),
    combatRounds: encounterMemory(settings, systemId)
      ? 0
      : isMemoryDurationValid("memoryRounds", rounds)
        ? Number(rounds)
        : MEMORY_DEFAULTS.combatRounds,
    seconds: isMemoryDurationValid("memoryMinutes", minutes)
      ? Number(minutes) * 60
      : MEMORY_DEFAULTS.seconds
  };
}

/** Preserve legacy alpha as a percentage and clamp saved values to the supported range.
 * @param {import("../types/foundry.js").SettingsService} settings
 */
export async function migrateOpacity(settings) {
  const value = settings.get(MODULE_ID, "opacity");
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    const percent = value <= 1 ? value * 100 : value;
    const clamped = Math.min(80, Math.max(30, Math.round(percent)));
    if (value !== clamped) await settings.set(MODULE_ID, "opacity", clamped);
  }
}

/** Native String settings cast saved booleans to strings before returning them.
 * @param {import("../types/foundry.js").SettingsService} settings
 */
export async function migrateCaptions(settings) {
  const value = settings.get(MODULE_ID, "labels");
  if (
    [true, "true", false, "false", "off"].includes(
      /** @type {boolean | string} */ (value)
    )
  )
    await settings.set(MODULE_ID, "labels", "world");
}
