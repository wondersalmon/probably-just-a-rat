import { MODULE_ID, MEMORY_DEFAULTS } from "./constants.js";
import { DEFAULT_OUTLINE_COLOR } from "./appearance.js";

/** @param {import("../types/foundry.js").SettingsService} settings @param {(key: string) => void} onAppearance
 * @param {any} [ColorField]
 */
export function registerSettings(settings, onAppearance, ColorField) {
  /** @type {Array<{key: string} & Pick<Parameters<import("../types/foundry.js").SettingsService["register"]>[2], "type" | "default" | "choices" | "range">>} */
  const definitions = [
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
      key: "labels",
      type: String,
      default: "standard",
      choices: {
        off: "RAT.Caption.Off",
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
      scope: key === "sharePings" ? "world" : "client",
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
    name: "RAT.Settings.showRounds.Name",
    hint: "RAT.Settings.showRounds.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => onAppearance("showRounds")
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
      name: `RAT.Settings.${key}.Name`,
      hint: `RAT.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      type: Number,
      default: value,
      onChange: () => onAppearance(String(key))
    });
}

/** Read positive durations; malformed values fall back to defaults.
 * @param {import("../types/foundry.js").SettingsService} settings
 */
export function memoryPolicy(settings) {
  const rounds = settings.get(MODULE_ID, "memoryRounds");
  const minutes = settings.get(MODULE_ID, "memoryMinutes");
  return {
    combatRounds:
      typeof rounds === "number" && Number.isInteger(rounds) && rounds > 0
        ? rounds
        : MEMORY_DEFAULTS.combatRounds,
    seconds:
      typeof minutes === "number" &&
      Number.isFinite(minutes * 60) &&
      minutes > 0
        ? minutes * 60
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
  if (value === true || value === "true")
    await settings.set(MODULE_ID, "labels", "standard");
  else if (value === false || value === "false")
    await settings.set(MODULE_ID, "labels", "off");
}
