/**
 * I18nService — internationalization and localization.
 *
 * - Supports 10 languages: en, es, fr, de, ja, ko, zh-CN, pt, it, ar
 * - Translation function with parameter interpolation: t(key, params)
 * - Pluralization support via key suffixes (_zero, _one, _other)
 * - RTL support for Arabic locale
 * - Falls back to English when a key is missing in the current locale
 * - Defaults to 'en' locale (or auto-detects from device/system)
 * - Persists locale preference via configurable storage adapter
 *
 * Requirements: 11.6
 */

import { translations, type SupportedLocale } from './locales';

/** RTL locales — Arabic is the only RTL language in our supported set. */
const RTL_LOCALES: ReadonlySet<string> = new Set<string>(['ar']);

/** The 10 supported locales as a readonly tuple (matches design interface). */
export const SUPPORTED_LOCALES = [
  'en', 'es', 'fr', 'de', 'ja', 'ko', 'zh-CN', 'pt', 'it', 'ar',
] as const;

/** Default locale when none is set and detection fails. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

export interface I18nService {
  /** The 10 supported locales. */
  readonly supportedLocales: readonly [
    'en', 'es', 'fr', 'de', 'ja', 'ko', 'zh-CN', 'pt', 'it', 'ar'
  ];

  /** Get the current active locale. */
  getCurrentLocale(): string;

  /** Set the active locale. Throws if the locale is not supported. Persists if storage configured. */
  setLocale(locale: string): void;

  /**
   * Translate a key with optional parameter interpolation and pluralization.
   * Parameters are replaced using `{{paramName}}` syntax.
   * Pluralization: if params contains `count`, looks for key_zero, key_one, key_other suffixes.
   * Falls back to English if the key is missing in the current locale.
   * Returns the raw key if not found in any locale.
   */
  t(key: string, params?: Record<string, string | number>): string;

  /** Whether the current locale uses right-to-left text direction. */
  isRTL(): boolean;
}

/** Storage adapter for persisting locale preference across app restarts. */
export interface LocaleStorage {
  getLocale(): string | null;
  setLocale(locale: string): void;
}

export interface I18nServiceConfig {
  /** Initial locale. If not provided, auto-detects from device or falls back to 'en'. */
  initialLocale?: string;
  /** Optional function to detect the device/system locale. */
  detectLocale?: () => string | null;
  /** Optional storage adapter for persisting locale preference. */
  storage?: LocaleStorage;
}

/**
 * Check whether a locale string is one of the supported locales.
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Attempt to match a device locale string (e.g., 'zh-Hans-CN', 'pt-BR', 'en-US')
 * to one of our supported locales.
 */
function matchLocale(deviceLocale: string): SupportedLocale | null {
  // Normalize: replace underscores with hyphens
  const normalized = deviceLocale.replace(/_/g, '-');

  // Exact match
  if (isSupportedLocale(normalized)) return normalized;

  // zh-Hans* or zh-CN* → zh-CN
  if (normalized.startsWith('zh')) return 'zh-CN';

  // Try base language (first segment before hyphen)
  const base = normalized.split('-')[0];
  if (isSupportedLocale(base)) return base;

  return null;
}

/**
 * Resolve the plural form key for a given count.
 * Supports: _zero, _one, _other (covers most Western languages + CJK).
 * For languages with complex plural rules (Arabic), _other is used for counts > 1.
 */
function getPluralKey(key: string, count: number): string {
  if (count === 0) return `${key}_zero`;
  if (count === 1) return `${key}_one`;
  return `${key}_other`;
}

/**
 * Interpolate `{{paramName}}` placeholders in a translation string.
 */
function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (_match, paramName: string) => {
    const value = params[paramName];
    return value !== undefined ? String(value) : `{{${paramName}}}`;
  });
}

/**
 * Look up a key in a locale's translations.
 */
function lookup(locale: SupportedLocale, key: string): string | undefined {
  const localeTranslations = translations[locale];
  if (localeTranslations && key in localeTranslations) {
    return localeTranslations[key];
  }
  return undefined;
}

/**
 * Creates an I18nService instance.
 */
export function createI18nService(config?: I18nServiceConfig): I18nService {
  let currentLocale: SupportedLocale = DEFAULT_LOCALE;

  // Resolve initial locale: explicit config > persisted > device detection > default
  if (config?.initialLocale) {
    if (isSupportedLocale(config.initialLocale)) {
      currentLocale = config.initialLocale;
    } else {
      throw new Error(
        `Unsupported locale: "${config.initialLocale}". Supported locales: ${SUPPORTED_LOCALES.join(', ')}`,
      );
    }
  } else {
    // Try persisted locale first
    const persisted = config?.storage?.getLocale();
    if (persisted && isSupportedLocale(persisted)) {
      currentLocale = persisted;
    } else {
      // Try device locale detection
      const detected = config?.detectLocale?.();
      if (detected) {
        const matched = matchLocale(detected);
        if (matched) {
          currentLocale = matched;
        }
      }
    }
  }

  function getCurrentLocale(): string {
    return currentLocale;
  }

  function setLocale(locale: string): void {
    if (!isSupportedLocale(locale)) {
      throw new Error(
        `Unsupported locale: "${locale}". Supported locales: ${SUPPORTED_LOCALES.join(', ')}`,
      );
    }
    currentLocale = locale;
    // Persist the preference
    config?.storage?.setLocale(locale);
  }

  function t(key: string, params?: Record<string, string | number>): string {
    // Pluralization: if params has a numeric `count`, try plural-suffixed keys first
    if (params && typeof params.count === 'number') {
      const pluralKey = getPluralKey(key, params.count);

      // Try plural key in current locale
      const pluralValue = lookup(currentLocale, pluralKey);
      if (pluralValue !== undefined) {
        return interpolate(pluralValue, params);
      }

      // Try plural key in English fallback
      if (currentLocale !== 'en') {
        const enPluralValue = lookup('en', pluralKey);
        if (enPluralValue !== undefined) {
          return interpolate(enPluralValue, params);
        }
      }

      // Fall through to non-plural key lookup
    }

    // Try current locale
    const value = lookup(currentLocale, key);
    if (value !== undefined) {
      return interpolate(value, params);
    }

    // Fallback to English
    if (currentLocale !== 'en') {
      const enValue = lookup('en', key);
      if (enValue !== undefined) {
        return interpolate(enValue, params);
      }
    }

    // Key not found in any locale — return the raw key
    return key;
  }

  function isRTL(): boolean {
    return RTL_LOCALES.has(currentLocale);
  }

  return {
    supportedLocales: SUPPORTED_LOCALES,
    getCurrentLocale,
    setLocale,
    t,
    isRTL,
  };
}
