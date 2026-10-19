import { MODULE_ID } from "../constants.js";
import { localize } from "../localization.js";

/** Uses the native TokenConfig form and permission checks; writes only a candidate flag.
 * @param {import("../../types/foundry.js").FoundryHost} host @param {any} app @param {HTMLElement} element
 */
export function addTokenOverride(host, app, element) {
  if (!app.document?.isOwner || !host.game.user.can("TOKEN_CONFIGURE")) return;
  const tab =
    element.querySelector('[data-tab="identity"]') ??
    element.querySelector(".tab.active");
  if (!tab || tab.querySelector(".rat-token-override")) return;
  const group = host.document.createElement("div");
  group.className = "form-group rat-token-override";
  const label = group.appendChild(host.document.createElement("label"));
  label.textContent = localize(host, "RAT.Token.Label");
  const select = group.appendChild(host.document.createElement("select"));
  select.name = `flags.${MODULE_ID}.memory`;
  select.id = `${app.id}-rat-memory`;
  label.htmlFor = select.id;
  for (const value of ["default", "on", "off"]) {
    const option = select.appendChild(host.document.createElement("option"));
    option.value = value;
    option.textContent = localize(host, `RAT.Token.${value}`);
  }
  select.value = app.document.getFlag(MODULE_ID, "memory") ?? "default";
  const hint = group.appendChild(host.document.createElement("p"));
  hint.className = "hint";
  hint.textContent = localize(host, "RAT.Token.Hint");
  tab.append(group);
}
