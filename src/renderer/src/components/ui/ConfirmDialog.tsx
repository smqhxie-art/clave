import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'

interface ConfirmDialogProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  message: string
  confirmLabel?: string
}

export function ConfirmDialog({ isOpen, onConfirm, onCancel, title, message, confirmLabel }: ConfirmDialogProps) {
  const { t } = useTranslation()
  const effectiveConfirmLabel = confirmLabel ?? t('confirmDialog.defaultConfirmLabel')
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmRef.current?.focus(), 50)
    }
  }, [isOpen])

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 bg-white/5 backdrop-blur-sm z-50"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
                className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px]"
              >
                <div className="bg-surface-0 rounded-xl border border-border shadow-2xl overflow-hidden">
                  <div className="px-4 pt-4 pb-3 text-center">
                    <DialogPrimitive.Title className="text-[13px] font-semibold text-text-primary">
                      {title}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-1.5 text-xs text-text-secondary leading-relaxed">
                      {message}
                    </DialogPrimitive.Description>
                  </div>
                  <div className="border-t border-border-subtle flex">
                    <button
                      type="button"
                      onClick={onCancel}
                      className="flex-1 py-2.5 text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-100 transition-colors border-r border-border-subtle"
                    >
                      {t('confirmDialog.cancel')}
                    </button>
                    <button
                      ref={confirmRef}
                      type="button"
                      onClick={onConfirm}
                      className="flex-1 py-2.5 text-[13px] font-medium text-red-400 hover:text-red-300 hover:bg-surface-100 transition-colors outline-none"
                    >
                      {effectiveConfirmLabel}
                    </button>
                  </div>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
