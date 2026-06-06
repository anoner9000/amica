import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import isDev from '@/utils/isDev';
import { langs } from './langs';

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      debug: isDev,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      resources: langs,
    });
}

export default i18n;

export const t = i18n.t;
