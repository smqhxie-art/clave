import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { FolderIcon } from '@heroicons/react/24/outline'

interface ExportClaveDialogProps {
  isOpen: boolean
  defaultFileName: string
  onExport: (folder: string, fileName: string, keepSynced: boolean) => void
  onCancel: () => void
}

export function ExportClaveDialog({
  isOpen,
  defaultFileName,
  onExport,
  onCancel
}: ExportClaveDialogProps) {
  const { t } = useTranslation()
  const [folder, setFolder] = useState<string | null>(null)
  const [fileName, setFileName] = useState(defaultFileName)
  const [keepSynced, setKeepSynced] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setFileName(defaultFileName)
      setKeepSynced(false)
      // Load downloads path as default
      window.electronAPI?.getDownloadsPath().then((p) => {
        setFolder((prev) => prev ?? p)
      })
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setFolder(null)
    }
  }, [isOpen, defaultFileName])

  const handleExport = () => {
    const name = fileName.trim()
    if (!name || !folder) return
    const finalName = name.endsWith('.clave') ? name : `${name}.clave`
    onExport(folder, finalName, keepSynced)
  }

  const handlePickFolder = async () => {
    const selected = await window.electronAPI.openFolderDialog()
    if (selected) setFolder(selected)
  }

  const folderName = folder ? folder.split('/').pop() || folder : null

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
                className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px]"
              >
                <div className="bg-surface-0 rounded-xl border border-border shadow-2xl overflow-hidden">
                  <div className="px-4 pt-4 pb-3">
                    <DialogPrimitive.Title className="text-[13px] font-semibold text-text-primary">
                      {t('exportClave.title')}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-1 text-xs text-text-secondary">
                      {t('exportClave.description')}
                    </DialogPrimitive.Description>

                    {/* Folder picker */}
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="mt-3 w-full h-8 px-3 rounded-lg bg-surface-100 border border-border-subtle flex items-center gap-2 text-xs hover:bg-surface-200 transition-colors group"
                      title={folder ?? t('exportClave.folderPicker.tooltip')}
                    >
                      <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-text-tertiary" />
                      <span className="flex-1 min-w-0 truncate text-left text-text-primary">
                        {folderName ?? t('exportClave.folderPicker.loading')}
                      </span>
                      <span className="text-[10px] text-text-tertiary group-hover:text-text-secondary flex-shrink-0">
                        {t('exportClave.folderPicker.change')}
                      </span>
                    </button>

                    {/* Filename input */}
                    <input
                      ref={inputRef}
                      type="text"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleExport()
                        }
                      }}
                      placeholder={t('exportClave.fileName.placeholder')}
                      className="mt-2 w-full h-8 px-3 rounded-lg bg-surface-100 border border-border-subtle text-xs text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-accent transition-colors"
                    />

                    {/* Keep synced toggle */}
                    <button
                      type="button"
                      onClick={() => setKeepSynced(!keepSynced)}
                      className="mt-3 w-full flex items-center gap-2.5 text-left"
                    >
                      <div className={`
                        w-8 h-[18px] rounded-full transition-colors flex-shrink-0 relative
                        ${keepSynced ? 'bg-accent' : 'bg-surface-200'}
                      `}>
                        <div className={`
                          absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform
                          ${keepSynced ? 'translate-x-[16px]' : 'translate-x-[2px]'}
                        `} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-text-primary">{t('exportClave.keepSynced.label')}</span>
                        <p className="text-[10px] text-text-tertiary leading-tight mt-0.5">
                          {t('exportClave.keepSynced.description')}
                        </p>
                      </div>
                    </button>
                  </div>

                  <div className="border-t border-border-subtle flex">
                    <button
                      type="button"
                      onClick={onCancel}
                      className="flex-1 py-2.5 text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-100 transition-colors border-r border-border-subtle"
                    >
                      {t('exportClave.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleExport}
                      className="flex-1 py-2.5 text-[13px] font-medium text-accent hover:brightness-110 hover:bg-surface-100 transition-colors outline-none"
                    >
                      {t('exportClave.export')}
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
