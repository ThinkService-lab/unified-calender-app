/**
 * Design Token System — single source of truth for the app's visual identity.
 *
 * Tokens are centralized here so UI components import colour, typography,
 * spacing, radii and shadow values instead of hardcoding them. This powers
 * dark mode, future theming, and consistent styling across the app.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */

import { useMemo } from 'react';
import { Platform, type TextStyle } from 'react-native';
import {
  useColorSchemePreference,
  useResolvedSystemScheme,
  type ColorScheme,
  type ResolvedSystemScheme,
} from '../../stores/uiPreferencesStore';

// ─── Shadow primitive ────────────────────────────────────────────────────────

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  /** Android elevation */
  elevation: number;
}

// ─── Token groups ────────────────────────────────────────────────────────────

export interface ColorTokens {
  /**
   * At least 15 distinct event colours — each meeting WCAG 2.1 AA contrast
   * ratios (≥4.5:1 for text, ≥3:1 for UI elements) against the paired
   * background for this token set. See `verifyWcagContrast` in
   * `contrastVerification.ts` for the runtime check.
   */
  eventPalette: readonly string[];
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Text colour to use on top of `primary`. */
  textOnPrimary: string;
  /** Text colour to use on top of `primaryLight`. */
  textOnPrimaryLight: string;
  /** Text colour to use on top of `primaryDark`. */
  textOnPrimaryDark: string;
  border: string;
  borderLight: string;
  error: string;
  success: string;
  warning: string;
  /** Current time indicator colour. */
  nowIndicator: string;
}

/**
 * Font weight tokens. The values must be valid `TextStyle['fontWeight']`
 * literals so consumers can assign them directly to `StyleSheet` props
 * without TypeScript narrowing errors.
 */
export type FontWeightToken = NonNullable<TextStyle['fontWeight']>;

export interface TypographyTokens {
  fontFamily: { primary: string; mono: string };
  sizes: {
    caption: number;
    body: number;
    subheading: number;
    heading: number;
    title: number;
    display: number;
  };
  lineHeights: {
    caption: number;
    body: number;
    subheading: number;
    heading: number;
    title: number;
    display: number;
  };
  weights: {
    regular: FontWeightToken;
    medium: FontWeightToken;
    semibold: FontWeightToken;
    bold: FontWeightToken;
  };
}

export interface SpacingTokens {
  /** 4px base unit — all other spacing tokens are multiples of this value. */
  base: 4;
  xs: 4;
  sm: 8;
  md: 12;
  lg: 16;
  xl: 24;
  '2xl': 32;
  '3xl': 48;
  '4xl': 64;
}

export interface RadiiTokens {
  none: 0;
  sm: 4;
  md: 8;
  lg: 16;
  full: 9999;
}

export interface ShadowTokens {
  none: ShadowStyle;
  sm: ShadowStyle;
  md: ShadowStyle;
  lg: ShadowStyle;
}

export interface DesignTokens {
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radii: RadiiTokens;
  shadows: ShadowTokens;
}

// ─── Shared token definitions ────────────────────────────────────────────────

/**
 * Typography scale — identical across light and dark themes. Uses the system
 * font stack on each platform so text renders crisply without shipping custom
 * font files.
 */
const typography: TypographyTokens = {
  fontFamily: {
    primary: Platform.select({
      ios: 'System',
      android: 'sans-serif',
      default:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    }) as string,
    mono: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    }) as string,
  },
  sizes: {
    caption: 10,
    body: 14,
    subheading: 16,
    heading: 20,
    title: 24,
    display: 32,
  },
  lineHeights: {
    caption: 14,
    body: 20,
    subheading: 22,
    heading: 26,
    title: 30,
    display: 40,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
};

/** 4px base spacing scale — eight named tokens all multiples of `base`. */
const spacing: SpacingTokens = {
  base: 4,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
};

const radii: RadiiTokens = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 16,
  full: 9999,
};

const lightShadows: ShadowTokens = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
};

const darkShadows: ShadowTokens = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 8,
  },
};

// ─── Event colour palettes ───────────────────────────────────────────────────
//
// Each palette holds 15 distinct colours chosen so that:
//   • Light palette colours have ≥4.5:1 contrast against the light background
//     (#FCFAF7) when used as text colour, and ≥3:1 against white surfaces
//     when used as UI elements.
//   • Dark palette colours have ≥4.5:1 contrast against the dark background
//     (#16181C) when used as text colour, and ≥3:1 as UI elements.
// Enforced by `verifyWcagContrast` in `contrastVerification.ts` — run on
// every jest suite via `designTokens.test.ts` so any drift fails CI.

const LIGHT_EVENT_PALETTE: readonly string[] = [
  '#B8361B', // terracotta
  '#A84C1F', // burnt sienna
  '#8F5A00', // amber
  '#705B0C', // olive
  '#3F7130', // fern
  '#0E6E55', // teal
  '#007085', // ocean
  '#1F5EA8', // cobalt
  '#3646B0', // indigo
  '#6137B0', // violet
  '#8D2E9E', // orchid
  '#A52270', // magenta
  '#AD2454', // rose
  '#4C4F55', // slate
  '#6B4A2B', // umber
];

const DARK_EVENT_PALETTE: readonly string[] = [
  '#FF8A6A', // terracotta
  '#FFA06A', // burnt sienna
  '#FFC560', // amber
  '#D6C060', // olive
  '#7FD273', // fern
  '#58D6B6', // teal
  '#5AD1E6', // ocean
  '#7FB4FF', // cobalt
  '#9BA6FF', // indigo
  '#C79AFF', // violet
  '#E690F0', // orchid
  '#FF8FC0', // magenta
  '#FF8AA6', // rose
  '#C5C9D1', // slate
  '#D6B088', // umber
];

// ─── Token sets ──────────────────────────────────────────────────────────────
//
// Text-on-primary choices per shade:
//   Light:
//     primary       #B8361B (dark red) → white text (contrast ≈ 6.6:1 ✔)
//     primaryLight  #E5684C (salmon)   → dark text  (#1A1C20, contrast ≈ 5.2:1 ✔)
//                                        white on this shade is ≈ 3.0:1 — fails 4.5:1
//     primaryDark   #7A2410 (maroon)   → white text (contrast ≈ 10.5:1 ✔)
//
//   Dark:
//     primary       #FF8A6A (peach)    → dark bg text (#16181C, contrast ≈ 7.8:1 ✔)
//     primaryLight  #FFB49A (light peach) → dark bg text (contrast ≈ 11.4:1 ✔)
//     primaryDark   #CC6A4F (rust)     → dark bg text (#16181C, contrast ≈ 4.7:1 ✔)
//                                        white on this shade is only ≈ 3.7:1 — fails 4.5:1
//                                        (dark-theme primaries are all *light* peachy
//                                        shades, so dark text is the consistent choice)

export const lightTokens: DesignTokens = {
  colors: {
    eventPalette: LIGHT_EVENT_PALETTE,
    primary: '#B8361B',
    primaryLight: '#E5684C',
    primaryDark: '#7A2410',
    secondary: '#1F5EA8',
    accent: '#A84C1F',
    background: '#FCFAF7',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    textPrimary: '#1A1C20',
    textSecondary: '#4A4E57',
    textMuted: '#6B7280',
    textOnPrimary: '#FFFFFF',
    // Primary-light is a pale salmon — white text on it fails 4.5:1.
    // Use the same near-black as `textPrimary` to keep contrast ≈ 5.2:1.
    textOnPrimaryLight: '#1A1C20',
    textOnPrimaryDark: '#FFFFFF',
    border: '#D9D5CC',
    borderLight: '#EDEAE2',
    error: '#B3261E',
    success: '#0F7A3A',
    warning: '#8F5A00',
    nowIndicator: '#B8361B',
  },
  typography,
  spacing,
  radii,
  shadows: lightShadows,
};

export const darkTokens: DesignTokens = {
  colors: {
    eventPalette: DARK_EVENT_PALETTE,
    primary: '#FF8A6A',
    primaryLight: '#FFB49A',
    primaryDark: '#CC6A4F',
    secondary: '#7FB4FF',
    accent: '#FFA06A',
    background: '#16181C',
    surface: '#1F2229',
    surfaceElevated: '#272A32',
    textPrimary: '#F4F5F7',
    textSecondary: '#C5C9D1',
    textMuted: '#8A8F99',
    textOnPrimary: '#16181C',
    textOnPrimaryLight: '#16181C',
    textOnPrimaryDark: '#16181C',
    border: '#353943',
    borderLight: '#2A2D35',
    error: '#FF8A80',
    success: '#7FD273',
    warning: '#FFC560',
    nowIndicator: '#FF8A6A',
  },
  typography,
  spacing,
  radii,
  shadows: darkShadows,
};

// ─── useTokens hook ──────────────────────────────────────────────────────────

/**
 * Resolves a `ColorScheme` preference against the current OS colour scheme
 * and returns `'light'` or `'dark'`.
 *
 * Exported so the WCAG verification module and tests can derive the
 * effective scheme without duplicating the rule.
 */
export function resolveEffectiveScheme(
  preference: ColorScheme,
  systemScheme: ResolvedSystemScheme,
): 'light' | 'dark' {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemScheme === 'dark' ? 'dark' : 'light';
}

/**
 * Hook that returns the active design token set.
 *
 * Pulls both the user's colour-scheme preference AND the store-mirrored
 * OS colour scheme from `useUIPreferencesStore`. The store owns the single
 * global `Appearance.addChangeListener` — this hook does NOT install its
 * own listener, so OS theme changes flow through one source of truth and
 * propagate within one render cycle (well under the 500ms budget in
 * Req 1.8).
 */
export function useTokens(): DesignTokens {
  const preference = useColorSchemePreference();
  const systemScheme = useResolvedSystemScheme();

  return useMemo(() => {
    const effective = resolveEffectiveScheme(preference, systemScheme);
    return effective === 'dark' ? darkTokens : lightTokens;
  }, [preference, systemScheme]);
}
