/**
 * WCAG 2.1 AA color contrast ratio calculation and validation.
 * Requirements: 9.6
 *
 * Implements the WCAG 2.1 contrast ratio algorithm:
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/**
 * Parses a hex color string (#RRGGBB or #RGB) into [r, g, b] values (0-255).
 */
export function parseHexColor(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    return [r, g, b];
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return [r, g, b];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}

/**
 * Converts an sRGB color channel value (0-255) to its relative luminance component.
 * Per WCAG 2.1: linearize the sRGB value, then apply the luminance coefficient.
 */
function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/**
 * Calculates the relative luminance of a color.
 * Per WCAG 2.1: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 */
export function getRelativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Calculates the WCAG contrast ratio between two colors.
 * Returns a value between 1 and 21.
 *
 * @param fg - Foreground color as hex string (#RRGGBB)
 * @param bg - Background color as hex string (#RRGGBB)
 */
export function getContrastRatio(fg: string, bg: string): number {
  const [fgR, fgG, fgB] = parseHexColor(fg);
  const [bgR, bgG, bgB] = parseHexColor(bg);

  const fgLum = getRelativeLuminance(fgR, fgG, fgB);
  const bgLum = getRelativeLuminance(bgR, bgG, bgB);

  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns true if the contrast ratio meets WCAG 2.1 AA for normal text (≥ 4.5:1).
 */
export function meetsAAContrast(fg: string, bg: string): boolean {
  return getContrastRatio(fg, bg) >= 4.5;
}

/**
 * Returns true if the contrast ratio meets WCAG 2.1 AA for large text and UI components (≥ 3:1).
 */
export function meetsAALargeContrast(fg: string, bg: string): boolean {
  return getContrastRatio(fg, bg) >= 3.0;
}

/**
 * Validates all palette colors against a background and returns a report.
 */
export interface ContrastReport {
  color: string;
  ratio: number;
  meetsAAText: boolean;
  meetsAAUI: boolean;
}

export function validatePaletteContrast(
  palette: readonly string[],
  background: string = '#FFFFFF'
): ContrastReport[] {
  return palette.map((color) => {
    const ratio = getContrastRatio(color, background);
    return {
      color,
      ratio: Math.round(ratio * 100) / 100,
      meetsAAText: ratio >= 4.5,
      meetsAAUI: ratio >= 3.0,
    };
  });
}
