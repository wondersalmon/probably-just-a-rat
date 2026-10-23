export const DEFAULT_OUTLINE_COLOR = "#e0f0ff";

/** Desaturate procedural artwork using the same channel average as PIXI's saturate(-amount).
 * Outlines keep their independently selected color.
 * @param {number} grayscale
 */
export function markerFillColor(grayscale) {
  const channels = [224, 193, 138];
  const average = channels.reduce((sum, value) => sum + value, 0) / 3;
  return channels.reduce(
    (color, value) =>
      (color << 8) | Math.round(value + (average - value) * grayscale),
    0
  );
}

/** @param {unknown} value */
export function normalizeOutlineColor(value) {
  const raw =
    typeof value === "object" && value && "css" in value
      ? String(value.css)
      : String(value ?? "");
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw))
    return `#${[...raw.slice(1)].map(char => char + char).join("")}`.toLowerCase();
  return DEFAULT_OUTLINE_COLOR;
}

/** @param {{markerStyle?: unknown, customMarkerImage?: unknown, customMarkerRotate?: unknown, opacity: unknown, grayscale?: unknown, outline?: unknown, outlineColor?: unknown, labels: unknown}} values */
export function resolveAppearance(values) {
  const raw = Number(values.opacity);
  // Read legacy alpha safely while the asynchronous client migration is pending.
  const percent = Number.isFinite(raw)
    ? raw >= 0 && raw <= 1
      ? raw * 100
      : raw
    : 50;
  const grayscale = Number(values.grayscale);
  return {
    markerStyle: ["footprints", "presence", "custom"].includes(
      String(values.markerStyle)
    )
      ? String(values.markerStyle)
      : "ghost",
    customMarkerImage:
      typeof values.customMarkerImage === "string"
        ? values.customMarkerImage.trim()
        : "",
    customMarkerRotate:
      values.customMarkerRotate === true ||
      values.customMarkerRotate === "true",
    opacity: Math.min(80, Math.max(30, percent)) / 100,
    labels: ![false, "false", "off"].includes(
      /** @type {boolean | string} */ (values.labels)
    ),
    highContrast: values.labels === "contrast",
    outline: values.outline === true || values.outline === "true",
    outlineColor: normalizeOutlineColor(values.outlineColor),
    grayscale: Number.isFinite(grayscale)
      ? Math.min(100, Math.max(0, grayscale)) / 100
      : 0.3
  };
}

/** The GM can disable captions globally; players can only choose a readable style.
 * @param {unknown} worldStyle @param {unknown} personalStyle @param {boolean} isGM
 * @returns {"off" | "standard" | "contrast"}
 */
export function resolveCaptionStyle(worldStyle, personalStyle, isGM) {
  const world =
    worldStyle === "off"
      ? "off"
      : worldStyle === "contrast"
        ? "contrast"
        : "standard";
  if (world === "off" || isGM) return world;
  return personalStyle === "standard" || personalStyle === "contrast"
    ? personalStyle
    : world;
}
