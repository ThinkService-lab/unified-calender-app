/**
 * Internationalization (i18n) module.
 * Requirements: 11.6
 */

export {
  createI18nService,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from './i18nService';
export type { I18nService, I18nServiceConfig, LocaleStorage } from './i18nService';
export type { SupportedLocale } from './locales';
