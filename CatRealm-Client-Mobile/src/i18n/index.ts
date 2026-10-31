import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import es from './es.json';
import ja from './ja.json';
import ru from './ru.json';
import tourEn from './tour-en.json';
import tourEs from './tour-es.json';
import tourJa from './tour-ja.json';
import tourRu from './tour-ru.json';
import { detectAppLanguage } from './languages';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...en, appTour: tourEn } },
    es: { translation: { ...es, appTour: tourEs } },
    ru: { translation: { ...ru, appTour: tourRu } },
    ja: { translation: { ...ja, appTour: tourJa } },
  },
  lng: detectAppLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
