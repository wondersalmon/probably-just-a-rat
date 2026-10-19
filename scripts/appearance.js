export const DEFAULT_OUTLINE_COLOR = "#e0f0ff";

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

/** @param {{opacity: unknown, grayscale?: unknown, outline?: unknown, outlineColor?: unknown, labels: unknown}} values */
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
