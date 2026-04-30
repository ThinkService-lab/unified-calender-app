/**
 * Design Token System — barrel export.
 */

export {
  lightTokens,
  darkTokens,
  useTokens,
  resolveEffectiveScheme,
} from './designTokens';

export type {
  DesignTokens,
  ColorTokens,
  TypographyTokens,
  SpacingTokens,
  RadiiTokens,
  ShadowTokens,
  ShadowStyle,
  FontWeightToken,
} from './designTokens';

export {
  parseHex,
  relativeLuminance,
  contrastRatio,
  auditTokenContrast,
  verifyWcagContrast,
  assertWcagContrast,
  WCAG_AA_TEXT_RATIO,
  WCAG_AA_UI_RATIO,
} from './contrastVerification';

export type { ContrastFinding } from './contrastVerification';
