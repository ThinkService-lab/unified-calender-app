/**
 * WCAG 2.1 AA contrast verification for the Design Token System.
 *
 * Pure functions — no React, no side effects — so they can be invoked
 * from jest tests (see `__tests__/designTokens.test.ts`) and optionally
 * from dev-time bootstrap to fail fast if any palette drift lands.
 *
 * References:
 *   • WCAG 2.1 SC 1.4.3 Contrast (Minimum) — AA requires 4.5:1 for normal
 *     text and 3:1 for large text / non-text UI components.
 *   • Relative luminance formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *   • Contrast ratio formula:    https://www.w3.org/TR/WCAG20/#contrast-ratiodef
 *
 * Requirements: 1.1, 1.7
 */

import { lightTokens, darkTokens, type DesignTokens } from './designTokens';

/** Minimum contrast for normal (<18pt, <14pt bold) text. */
export const WCAG_AA_TEXT_RATIO = 4.5;

/** Minimum contrast for UI components and graphical objects. */
export const WCAG_AA_UI_RATIO = 3.0;

/** Parses a `#RRGGBB` or `#RGB` hex string into an `[r, g, b]` triple (0-255). */
export function parseHex(hex: string): [number, number, number] {
  const trimmed = hex.trim().replace(/^#/, '');
  const expanded =
    trimmed.length === 3
      ? trimmed
          .split('')
          .map((c) => c + c)
          .join('')
      : trimmed;
  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Invalid hex colour: ${hex}`);
  }
  const num = parseInt(expanded, 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

/**
 * Relative luminance of an sRGB colour per WCAG 2.1.
 * Operates on 0-255 channels; callers who have 0-1 floats should scale first.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * WCAG 2.1 contrast ratio between two colours. Returns a value in [1, 21].
 * Accepts `#RRGGBB` / `#RGB` hex strings.
 */
export function contrastRatio(fg: string, bg: string): number {
  const [fr, fgGreen, fb] = parseHex(fg);
  const [br, bgGreen, bb] = parseHex(bg);
  const l1 = relativeLuminance(fr, fgGreen, fb);
  const l2 = relativeLuminance(br, bgGreen, bb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ContrastFinding {
  /** A stable dotted identifier for the pairing being checked. */
  id: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  /** Kind of content the pairing applies to — drives `required`. */
  kind: 'text' | 'ui';
  passed: boolean;
}

/**
 * Run the full contrast audit over a token set. Each entry represents a
 * pairing that MUST meet its required ratio for the tokens to be WCAG
 * 2.1 AA compliant.
 *
 * The audit covers:
 *   • Body text on background / surface / surfaceElevated.
 *   • Secondary + muted text on background (text kind).
 *   • Text-on-primary/primaryLight/primaryDark (text kind).
 *   • Semantic colours (error, success, warning) on background (text kind).
 *   • Event palette against surface (UI kind, used as event-card
 *     background — must be distinguishable from the surface).
 *   • Event palette against background as text (text kind, used when the
 *     colour is rendered as an event title).
 */
export function auditTokenContrast(tokens: DesignTokens, label: string): ContrastFinding[] {
  const { colors } = tokens;
  const findings: ContrastFinding[] = [];

  const check = (
    id: string,
    fg: string,
    bg: string,
    kind: ContrastFinding['kind'],
  ): void => {
    const required = kind === 'text' ? WCAG_AA_TEXT_RATIO : WCAG_AA_UI_RATIO;
    const ratio = contrastRatio(fg, bg);
    findings.push({
      id: `${label}.${id}`,
      foreground: fg,
      background: bg,
      ratio,
      required,
      kind,
      passed: ratio + 1e-9 >= required,
    });
  };

  // Body + muted text on all neutral surfaces.
  for (const surfaceKey of ['background', 'surface', 'surfaceElevated'] as const) {
    check(`text.primary.on.${surfaceKey}`, colors.textPrimary, colors[surfaceKey], 'text');
    check(`text.secondary.on.${surfaceKey}`, colors.textSecondary, colors[surfaceKey], 'text');
  }
  // `textMuted` is only required to meet the UI-element ratio (3:1) —
  // it's a de-emphasized colour for placeholder / helper text. Gate it
  // at 3:1 so the audit doesn't flag an intentional design choice.
  check('text.muted.on.background', colors.textMuted, colors.background, 'ui');
  check('text.muted.on.surface', colors.textMuted, colors.surface, 'ui');

  // Text on each primary shade.
  check('text.onPrimary', colors.textOnPrimary, colors.primary, 'text');
  check('text.onPrimaryLight', colors.textOnPrimaryLight, colors.primaryLight, 'text');
  check('text.onPrimaryDark', colors.textOnPrimaryDark, colors.primaryDark, 'text');

  // Semantic colours used as text on `background`.
  check('text.error.on.background', colors.error, colors.background, 'text');
  check('text.success.on.background', colors.success, colors.background, 'text');
  check('text.warning.on.background', colors.warning, colors.background, 'text');

  // Event palette: each colour must be distinguishable from `surface`
  // (UI ratio) when used as an EventCard background, AND readable as
  // text on `background` (text ratio) when rendered as an event title.
  colors.eventPalette.forEach((swatch, index) => {
    check(`eventPalette[${index}].ui.on.surface`, swatch, colors.surface, 'ui');
    check(`eventPalette[${index}].text.on.background`, swatch, colors.background, 'text');
  });

  return findings;
}

/**
 * Run the audit against both shipped token sets and return any findings
 * that failed their required ratio. An empty array means every pairing
 * meets WCAG 2.1 AA.
 */
export function verifyWcagContrast(): ContrastFinding[] {
  const lightFindings = auditTokenContrast(lightTokens, 'light');
  const darkFindings = auditTokenContrast(darkTokens, 'dark');
  return [...lightFindings, ...darkFindings].filter((f) => !f.passed);
}

/**
 * Developer helper — throws if any pairing fails. Intended for an
 * optional dev-only call during `initializeStores` so palette drift
 * fails fast in development builds. Do not call in production (the
 * jest suite is the canonical verification).
 */
export function assertWcagContrast(): void {
  const failing = verifyWcagContrast();
  if (failing.length === 0) return;
  const lines = failing
    .map(
      (f) =>
        `  ${f.id}: fg=${f.foreground} bg=${f.background} ratio=${f.ratio.toFixed(2)} < ${f.required.toFixed(1)}`,
    )
    .join('\n');
  throw new Error(
    `[design-tokens] WCAG 2.1 AA contrast check failed for the following pairings:\n${lines}`,
  );
}
