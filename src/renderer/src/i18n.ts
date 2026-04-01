import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN }
}

const savedLang = localStorage.getItem('clave-language') || 'en'

i18n.use(initReactI18next).init({
  resources,
  lng: savedLang,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false
  }
})

// Sync initial language to main process for native menu
window.electronAPI?.setMenuLanguage(savedLang)

export default i18n
