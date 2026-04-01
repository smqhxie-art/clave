import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSessionStore } from '../../store/session-store'

const hasChosen = () => localStorage.getItem('clave-language-chosen') === '1'

export function LanguageWelcome() {
  const [visible, setVisible] = useState(() => !hasChosen())
  const setLanguage = useSessionStore((s) => s.setLanguage)

  if (!visible) return null

  const choose = (lang: 'en' | 'zh-CN') => {
    setLanguage(lang)
    localStorage.setItem('clave-language-chosen', '1')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface-0/80 backdrop-blur-xl"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
            className="flex flex-col items-center gap-8"
          >
            {/* Logo */}
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" className="text-accent">
              <rect width="32" height="32" rx="8" fill="currentColor" fillOpacity="0.1" />
              <path
                d="M8 16c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>

            {/* Title - shown in both languages so it's always understandable */}
            <div className="text-center">
              <h1 className="text-xl font-semibold text-text-primary mb-1">
                Choose your language
              </h1>
              <p className="text-sm text-text-tertiary">
                选择你的语言
              </p>
            </div>

            {/* Language cards */}
            <div className="flex gap-4">
              <button
                onClick={() => choose('en')}
                className="group w-44 rounded-xl border border-border-subtle bg-surface-50 px-6 py-5 text-center transition-all hover:border-accent hover:bg-surface-100 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="text-2xl mb-2">🇺🇸</div>
                <div className="text-sm font-semibold text-text-primary">English</div>
                <div className="text-[11px] text-text-tertiary mt-1">Use English interface</div>
              </button>

              <button
                onClick={() => choose('zh-CN')}
                className="group w-44 rounded-xl border border-border-subtle bg-surface-50 px-6 py-5 text-center transition-all hover:border-accent hover:bg-surface-100 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="text-2xl mb-2">🇨🇳</div>
                <div className="text-sm font-semibold text-text-primary">简体中文</div>
                <div className="text-[11px] text-text-tertiary mt-1">使用中文界面</div>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
