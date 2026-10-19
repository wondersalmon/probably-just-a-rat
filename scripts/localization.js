/** Native Foundry localization owns language selection and packaged translations.
 * @param {import("../types/foundry.js").FoundryHost} host @param {string} key
 */
export function localize(host, key) {
  return host.game.i18n.localize(key);
}

/** @param {import("../types/foundry.js").FoundryHost} host @param {string} key @param {Record<string, unknown>} values */
export function format(host, key, values) {
  return host.game.i18n.format(key, values);
}

/** Only an empty saved name represents an unknown creature; real names stay literal.
 * @param {import("../types/foundry.js").FoundryHost} host @param {string} name
 */
export function snapshotName(host, name) {
  return name || localize(host, "RAT.Unknown");
}
