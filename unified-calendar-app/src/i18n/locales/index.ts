/**
 * Locale translations registry.
 * Requirements: 11.6
 */

import en from './en';
import es from './es';
import fr from './fr';
import de from './de';
import ja from './ja';
import ko from './ko';
import zhCN from './zh-CN';
import pt from './pt';
import it from './it';
import ar from './ar';

export type SupportedLocale = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'ko' | 'zh-CN' | 'pt' | 'it' | 'ar';

export const translations: Record<SupportedLocale, Record<string, string>> = {
  en,
  es,
  fr,
  de,
  ja,
  ko,
  'zh-CN': zhCN,
  pt,
  it,
  ar,
};

export default translations;
