/**
 * Unit + contrast tests for the Design Token System.
 *
 * Covers Tasks 1.3, 1.4, 1.5 from the competitive-ui-overhaul spec:
 *   • Structural validation of both token sets.
 *   • Dark / light mode parity of colour keys (Property 2).
 *   • WCAG 2.1 AA contrast verification (Property 1).
 *   • Spacing scale is a 4px multiple grid.
 *
 * These are deliberately required (not `*`-optional) — Task 1.2 claims
 * WCAG AA compliance and dark-mode coverage, so the claim must be
 * mechanized to prevent silent palette drift.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7
 */

import {
  lightTokens,
  darkTokens,
  resolveEffectiveScheme,
  type DesignTokens,
} from '../designTokens';
import {
  parseHex,
  contrastRatio,
  verifyWcagContrast,
  auditTokenContrast,
  WCAG_AA_TEXT_RATIO,
  WCAG_AA_UI_RATIO,
} from '../contrastVerification';

// ─── Structural tests ────────────────────────────────────────────────────────

describe('Design Token System — structure', () => {
  const sets: Array<[string, DesignTokens]> = [
    ['lightTokens', lightTokens],
    ['darkTokens', darkTokens],
  ];

  test.each(sets)('%s has all required top-level groups', (_, tokens) => {
    expect(tokens).toHaveProperty('colors');
    expect(tokens).toHaveProperty('typography');
    expect(tokens).toHaveProperty('spacing');
    expect(tokens).toHaveProperty('radii');
    expect(tokens).toHaveProperty('shadows');
  });

  test.each(sets)('%s colors: event palette has ≥15 distinct hex values', (label, tokens) => {
    const palette = tokens.colors.eventPalette;
    expect(palette.length).toBeGreaterThanOrEqual(15);
    const unique = new Set(palette.map((c) => c.toUpperCase()));
    expect(unique.size).toBe(palette.length);
    for (const swatch of palette) {
      // Throws if malformed — that alone is the assertion.
      expect(() => parseHex(swatch)).not.toThrow();
    }
    // Silence unused-var lint in test.each
    void label;
  });

  test('typography scale exposes all six named sizes', () => {
    const sizeKeys: Array<keyof DesignTokens['typography']['sizes']> = [
      'caption',
      'body',
      'subheading',
      'heading',
      'title',
      'display',
    ];
    for (const key of sizeKeys) {
      expect(typeof lightTokens.typography.sizes[key]).toBe('number');
      expect(lightTokens.typography.sizes[key]).toBeGreaterThan(0);
    }
  });

  test('typography weights are valid React Native fontWeight literals', () => {
    const validWeights = new Set([
      'normal',
      'bold',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
      'ultralight',
      'thin',
      'light',
      'medium',
      'regular',
      'semibold',
      'heavy',
      'black',
    ]);
    for (const weight of Object.values(lightTokens.typography.weights)) {
      expect(validWeights.has(String(weight))).toBe(true);
    }
  });

  test('spacing scale values are all multiples of the 4px base unit', () => {
    const { spacing } = lightTokens;
    expect(spacing.base).toBe(4);
    const values = [
      spacing.xs,
      spacing.sm,
      spacing.md,
      spacing.lg,
      spacing.xl,
      spacing['2xl'],
      spacing['3xl'],
      spacing['4xl'],
    ];
    // 8 named tokens (xs..4xl) — matches Req 1.3
    expect(values).toHaveLength(8);
    for (const value of values) {
      expect(value % spacing.base).toBe(0);
    }
  });

  test('radii tokens expose the expected named set', () => {
    const { radii } = lightTokens;
    expect(radii.none).toBe(0);
    expect(radii.sm).toBeGreaterThan(0);
    expect(radii.md).toBeGreaterThan(radii.sm);
    expect(radii.lg).toBeGreaterThan(radii.md);
    expect(radii.full).toBeGreaterThanOrEqual(9999);
  });

  test('shadows tokens include none/sm/md/lg variants', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokens.shadows).toHaveProperty('none');
      expect(tokens.shadows).toHaveProperty('sm');
      expect(tokens.shadows).toHaveProperty('md');
      expect(tokens.shadows).toHaveProperty('lg');
      expect(tokens.shadows.none.elevation).toBe(0);
      expect(tokens.shadows.lg.elevation).toBeGreaterThan(tokens.shadows.md.elevation);
    }
  });
});

// ─── Dark / light parity (Property 2) ────────────────────────────────────────

describe('Design Token System — dark/light parity', () => {
  test('darkTokens.colors exposes the same keys as lightTokens.colors', () => {
    const lightKeys = Object.keys(lightTokens.colors).sort();
    const darkKeys = Object.keys(darkTokens.colors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  test('every dark-mode colour token is a valid hex string or palette array', () => {
    for (const [key, value] of Object.entries(darkTokens.colors)) {
      if (key === 'eventPalette') {
        expect(Array.isArray(value)).toBe(true);
        for (const swatch of value as readonly string[]) {
          expect(() => parseHex(swatch)).not.toThrow();
        }
      } else {
        expect(() => parseHex(value as string)).not.toThrow();
      }
    }
  });

  test('spacing / radii / typography are identical across themes (shared modules)', () => {
    expect(darkTokens.spacing).toEqual(lightTokens.spacing);
    expect(darkTokens.radii).toEqual(lightTokens.radii);
    expect(darkTokens.typography).toEqual(lightTokens.typography);
  });
});

// ─── Contrast primitives ─────────────────────────────────────────────────────

describe('Contrast verification primitives', () => {
  test('parseHex handles #RRGGBB', () => {
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255]);
    expect(parseHex('#000000')).toEqual([0, 0, 0]);
    expect(parseHex('#B8361B')).toEqual([0xb8, 0x36, 0x1b]);
  });

  test('parseHex handles shorthand #RGB', () => {
    expect(parseHex('#FFF')).toEqual([255, 255, 255]);
    expect(parseHex('#000')).toEqual([0, 0, 0]);
  });

  test('parseHex rejects malformed input', () => {
    expect(() => parseHex('not-a-colour')).toThrow(/Invalid hex colour/);
    expect(() => parseHex('#ZZZZZZ')).toThrow(/Invalid hex colour/);
    expect(() => parseHex('#12345')).toThrow(/Invalid hex colour/);
  });

  test('contrastRatio of black on white is 21:1 (spec maximum)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  test('contrastRatio is symmetric (order-independent)', () => {
    const a = contrastRatio('#B8361B', '#FCFAF7');
    const b = contrastRatio('#FCFAF7', '#B8361B');
    expect(a).toBeCloseTo(b, 5);
  });

  test('contrastRatio of identical colours is 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});

// ─── Full WCAG AA audit (Property 1) ─────────────────────────────────────────

describe('Design Token System — WCAG 2.1 AA contrast (Property 1)', () => {
  test('verifyWcagContrast returns no failing pairings', () => {
    const failing = verifyWcagContrast();
    if (failing.length > 0) {
      // Emit a detailed failure message so CI output points directly
      // at the offending pairing instead of a bare `.toEqual([])`.
      const lines = failing
        .map(
          (f) =>
            `  ${f.id}: fg=${f.foreground} bg=${f.background} ratio=${f.ratio.toFixed(2)} < ${f.required.toFixed(1)}`,
        )
        .join('\n');
      throw new Error(`${failing.length} contrast pairings failed:\n${lines}`);
    }
    expect(failing).toEqual([]);
  });

  test('every light-palette swatch clears the 3:1 UI threshold on surface', () => {
    for (const swatch of lightTokens.colors.eventPalette) {
      const ratio = contrastRatio(swatch, lightTokens.colors.surface);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_UI_RATIO);
    }
  });

  test('every dark-palette swatch clears the 3:1 UI threshold on surface', () => {
    for (const swatch of darkTokens.colors.eventPalette) {
      const ratio = contrastRatio(swatch, darkTokens.colors.surface);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_UI_RATIO);
    }
  });

  test('text-on-primary{,Light,Dark} all clear the 4.5:1 text threshold', () => {
    for (const [label, tokens] of [
      ['light', lightTokens],
      ['dark', darkTokens],
    ] as const) {
      const { colors } = tokens;
      expect(contrastRatio(colors.textOnPrimary, colors.primary)).toBeGreaterThanOrEqual(
        WCAG_AA_TEXT_RATIO,
      );
      expect(
        contrastRatio(colors.textOnPrimaryLight, colors.primaryLight),
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_RATIO);
      expect(
        contrastRatio(colors.textOnPrimaryDark, colors.primaryDark),
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_RATIO);
      // Silence unused-var lint
      void label;
    }
  });

  test('audit report covers every event-palette entry twice (ui + text)', () => {
    const lightFindings = auditTokenContrast(lightTokens, 'light');
    const paletteFindings = lightFindings.filter((f) => f.id.includes('eventPalette['));
    // 15 swatches × 2 checks (ui.on.surface + text.on.background) = 30
    expect(paletteFindings).toHaveLength(lightTokens.colors.eventPalette.length * 2);
  });
});

// ─── resolveEffectiveScheme ──────────────────────────────────────────────────

describe('resolveEffectiveScheme', () => {
  test('explicit light preference always returns light', () => {
    expect(resolveEffectiveScheme('light', 'dark')).toBe('light');
    expect(resolveEffectiveScheme('light', 'light')).toBe('light');
    expect(resolveEffectiveScheme('light', null)).toBe('light');
  });

  test('explicit dark preference always returns dark', () => {
    expect(resolveEffectiveScheme('dark', 'light')).toBe('dark');
    expect(resolveEffectiveScheme('dark', 'dark')).toBe('dark');
    expect(resolveEffectiveScheme('dark', null)).toBe('dark');
  });

  test('system preference follows the OS value', () => {
    expect(resolveEffectiveScheme('system', 'dark')).toBe('dark');
    expect(resolveEffectiveScheme('system', 'light')).toBe('light');
  });

  test('system preference defaults to light when OS is null', () => {
    expect(resolveEffectiveScheme('system', null)).toBe('light');
  });
});
