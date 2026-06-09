import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import {
  DEFAULT_LANGUAGE,
  I18N_NAMESPACES,
  STORAGE_KEYS,
  SUPPORTED_LANGUAGES,
} from '../../config/constants'

import arAuth from '@/locales/ar/auth.json'
import arCommon from '@/locales/ar/common.json'
import arDashboard from '@/locales/ar/dashboard.json'
import arMaterials from '@/locales/ar/materials.json'
import arProjects from '@/locales/ar/projects.json'
import arQuotations from '@/locales/ar/quotations.json'
import arSpaces from '@/locales/ar/spaces.json'
import arUsers from '@/locales/ar/users.json'
import enAuth from '@/locales/en/auth.json'
import enCommon from '@/locales/en/common.json'
import enDashboard from '@/locales/en/dashboard.json'
import enMaterials from '@/locales/en/materials.json'
import enProjects from '@/locales/en/projects.json'
import enQuotations from '@/locales/en/quotations.json'
import enSpaces from '@/locales/en/spaces.json'
import enUsers from '@/locales/en/users.json'

/**
 * Phase 1 bundles all translations. Namespaces are split per feature so they
 * can be lazy-loaded from a backend later without touching call sites.
 */
export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    users: enUsers,
    projects: enProjects,
    spaces: enSpaces,
    materials: enMaterials,
    quotations: enQuotations,
  },
  ar: {
    common: arCommon,
    auth: arAuth,
    dashboard: arDashboard,
    users: arUsers,
    projects: arProjects,
    spaces: arSpaces,
    materials: arMaterials,
    quotations: arQuotations,
  },
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: DEFAULT_LANGUAGE,
    // Map region-tagged Arabic (ar-SA, ar-EG, …) onto our single 'ar' bundle.
    nonExplicitSupportedLngs: true,
    ns: [...I18N_NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEYS.language,
      caches: ['localStorage'],
    },
  })

export default i18n
