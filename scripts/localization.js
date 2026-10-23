import { MODULE_ID } from "./constants.js";

/** Explicit language overrides stay local to this module and this client.
 * @type {WeakMap<object, {language: string, dictionary: Record<string, string> | null, revision: number}>}
 */
const languages = new WeakMap();
/** @type {Map<string, Promise<Record<string, string>>>} */
const dictionaries = new Map();

/** @param {import("../types/foundry.js").FoundryHost} host */
export async function configureLocalization(host) {
  const value = host.game.settings.get(MODULE_ID, "language");
  const language = value === "en" || value === "ru" ? value : "foundry";
  const previous = languages.get(host);
  const state = {
    language,
    dictionary: /** @type {Record<string, string> | null} */ (null),
    revision: (previous?.revision ?? 0) + 1
  };
  languages.set(host, state);
  if (language === "foundry") return;
  let pending = dictionaries.get(language);
  if (!pending) {
    pending = fetch(new URL("../lang/" + language + ".json", import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error("Module translation unavailable");
        return response.json();
      })
      .then(data => {
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid module translation");
        return data;
      });
    dictionaries.set(language, pending);
  }
  try {
    const dictionary = await pending;
    if (languages.get(host) === state) state.dictionary = dictionary;
  } catch (error) {
    if (dictionaries.get(language) === pending) dictionaries.delete(language);
    throw error;
  }
}

/** @param {import("../types/foundry.js").FoundryHost} host */
export function disposeLocalization(host) {
  languages.delete(host);
}

/** Use the selected module language, or delegate to native Foundry localization.
 * @param {import("../types/foundry.js").FoundryHost} host @param {string} key
 */
export function localize(host, key) {
  return languages.get(host)?.dictionary?.[key] ?? host.game.i18n.localize(key);
}

/** @param {import("../types/foundry.js").FoundryHost} host @param {string} key @param {Record<string, unknown>} values */
export function format(host, key, values) {
  const translated = languages.get(host)?.dictionary?.[key];
  if (translated === undefined) return host.game.i18n.format(key, values);
  return translated.replace(/\{([^}]+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match
  );
}

/** Only an empty saved name represents an unknown creature; real names stay literal.
 * @param {import("../types/foundry.js").FoundryHost} host @param {string} name
 */
export function snapshotName(host, name) {
  return name || localize(host, "RAT.Unknown");
}
