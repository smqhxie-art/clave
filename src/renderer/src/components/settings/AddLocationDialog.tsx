import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocationStore } from '../../store/location-store'
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

type Step = 'credentials' | 'test' | 'summary'

interface AddLocationDialogProps {
  onClose: () => void
}

export function AddLocationDialog({ onClose }: AddLocationDialogProps) {
  const { t } = useTranslation()
  const addLocation = useLocationStore((s) => s.addLocation)

  const [step, setStep] = useState<Step>('credentials')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authMethod, setAuthMethod] = useState<'key' | 'password' | 'agent'>('key')
  const [privateKeyPath, setPrivateKeyPath] = useState('~/.ssh/id_ed25519')
  const [password, setPassword] = useState('')
  const [autoConnect, setAutoConnect] = useState(true)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; openclawVersion?: string; openclawPort?: number; openclawToken?: string } | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const [createdLocationId, setCreatedLocationId] = useState<string | null>(null)

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)

    // Create location first so we have credentials stored for test
    const loc = await addLocation(
      {
        name: name || host,
        type: 'remote',
        host,
        port: parseInt(port) || 22,
        username,
        authMethod,
        privateKeyPath: authMethod === 'key' ? privateKeyPath : undefined,
        autoConnect
      },
      authMethod === 'password' ? password : undefined
    )
    setCreatedLocationId(loc.id)

    const result = await window.electronAPI.locationTestConnection(loc.id)
    setTestResult(result)
    // Save detected OpenClaw config to location
    if (result.success && (result.openclawPort || result.openclawToken)) {
      await window.electronAPI.locationUpdate(loc.id, {
        openclawVersion: result.openclawVersion,
        openclawPort: result.openclawPort,
        openclawToken: result.openclawToken
      })
    }
    setTesting(false)
  }, [name, host, port, username, authMethod, privateKeyPath, password, autoConnect, addLocation])

  const handleInstallPlugin = useCallback(async () => {
    if (!createdLocationId) return
    setInstalling(true)
    setInstallError(null)
    const installResult = await window.electronAPI.locationInstallPlugin(createdLocationId)
    setInstalling(false)
    if (!installResult.success) {
      setInstallError(installResult.error || t('addLocation.status.installFailed'))
      return
    }
    // Re-test to detect openclaw
    const result = await window.electronAPI.locationTestConnection(createdLocationId)
    setTestResult(result)
  }, [createdLocationId])

  const handleFinish = useCallback(async () => {
    // Update autoConnect setting
    if (createdLocationId) {
      await window.electronAPI.locationUpdate(createdLocationId, { autoConnect })
      // Connect immediately if autoConnect is enabled
      if (autoConnect) {
        try {
          await window.electronAPI.sshConnect(createdLocationId)
          // Connect OpenClaw if detected
          if (testResult?.openclawPort) {
            try {
              await window.electronAPI.agentConnect(createdLocationId)
              await window.electronAPI.agentList(createdLocationId)
            } catch { /* ok */ }
          }
        } catch { /* will show as error in locations list */ }
        // Reload locations to reflect connected status
        useLocationStore.getState().loadLocations()
      }
    }
    onClose()
  }, [onClose, createdLocationId, autoConnect, testResult])

  const handleRemoveOnCancel = useCallback(async () => {
    if (createdLocationId) {
      await window.electronAPI.locationRemove(createdLocationId)
      // Reload locations to reflect removal
      useLocationStore.getState().loadLocations()
    }
    onClose()
  }, [createdLocationId, onClose])

  const credentialsValid = host.trim() && username.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleRemoveOnCancel}>
      <div
        className="bg-surface-0 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-border-subtle"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h3 className="text-base font-semibold text-text-primary">{t('addLocation.title')}</h3>
          <button
            onClick={handleRemoveOnCancel}
            className="p-1 rounded-lg hover:bg-surface-200 text-text-tertiary hover:text-text-primary transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 py-3 bg-surface-100/50">
          {(['credentials', 'test', 'summary'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                step === s ? 'bg-accent text-white' : i < ['credentials', 'test', 'summary'].indexOf(step) ? 'bg-green-500 text-white' : 'bg-surface-200 text-text-tertiary'
              }`}>
                {i + 1}
              </div>
              {i < 2 && <div className="w-8 h-px bg-border-subtle" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {step === 'credentials' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.name')}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('addLocation.placeholder.name')}
                  className="w-full text-sm bg-surface-100 rounded-lg px-3 py-2 outline-none border border-border-subtle focus:border-accent text-text-primary placeholder:text-text-tertiary"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.host')}</label>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder={t('addLocation.placeholder.host')}
                    className="w-full text-sm bg-surface-100 rounded-lg px-3 py-2 outline-none border border-border-subtle focus:border-accent text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.port')}</label>
                  <input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full text-sm bg-surface-100 rounded-lg px-3 py-2 outline-none border border-border-subtle focus:border-accent text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.username')}</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('addLocation.placeholder.username')}
                  className="w-full text-sm bg-surface-100 rounded-lg px-3 py-2 outline-none border border-border-subtle focus:border-accent text-text-primary placeholder:text-text-tertiary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.authMethod')}</label>
                <div className="flex gap-2">
                  {(['key', 'password', 'agent'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAuthMethod(m)}
                      className={`flex-1 text-xs font-medium py-2 rounded-lg border transition-colors ${
                        authMethod === m
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border-subtle bg-surface-100 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {m === 'key' ? t('addLocation.authMethod.key') : m === 'password' ? t('addLocation.authMethod.password') : t('addLocation.authMethod.agent')}
                    </button>
                  ))}
                </div>
              </div>
              {authMethod === 'key' && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.privateKeyPath')}</label>
                  <input
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    className="w-full text-sm bg-surface-100 rounded-lg px-3 py-2 outline-none border border-border-subtle focus:border-accent text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              )}
              {authMethod === 'password' && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">{t('addLocation.label.password')}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-sm bg-surface-100 rounded-lg px-3 py-2 outline-none border border-border-subtle focus:border-accent text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              )}
            </>
          )}

          {step === 'test' && (
            <div className="text-center py-4">
              {testing ? (
                <div className="flex flex-col items-center gap-3">
                  <ArrowPathIcon className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-sm text-text-secondary">{t('addLocation.status.testing')}</p>
                </div>
              ) : testResult ? (
                <div className="flex flex-col items-center gap-3">
                  {testResult.success ? (
                    <>
                      <CheckCircleIcon className="w-10 h-10 text-green-500" />
                      <p className="text-sm font-medium text-text-primary">{t('addLocation.status.success')}</p>
                      {testResult.openclawVersion ? (
                        <p className="text-xs text-text-secondary">
                          {t('addLocation.status.openclawDetected', { version: testResult.openclawVersion, port: testResult.openclawPort })}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-text-tertiary">{t('addLocation.status.openclawNotFound')}</p>
                          <button
                            onClick={handleInstallPlugin}
                            disabled={installing}
                            className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                          >
                            {installing ? t('addLocation.button.installing') : t('addLocation.button.installPlugin')}
                          </button>
                          {installError && (
                            <p className="text-xs text-red-400 mt-1">{installError}</p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <ExclamationCircleIcon className="w-10 h-10 text-red-500" />
                      <p className="text-sm font-medium text-text-primary">{t('addLocation.status.failed')}</p>
                      <p className="text-xs text-text-tertiary">{testResult.error}</p>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-text-secondary">{t('addLocation.status.promptTest')}</p>
              )}
            </div>
          )}

          {step === 'summary' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <CheckCircleIcon className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-text-primary">{name || host}</p>
                  <p className="text-xs text-text-tertiary">{username}@{host}:{port}</p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoConnect}
                  onChange={(e) => setAutoConnect(e.target.checked)}
                  className="rounded border-border-subtle"
                />
                <span className="text-sm text-text-secondary">{t('addLocation.option.autoConnect')}</span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-subtle bg-surface-100/30">
          <button
            onClick={step === 'credentials' ? handleRemoveOnCancel : () => setStep(step === 'test' ? 'credentials' : 'test')}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            {step === 'credentials' ? t('addLocation.button.cancel') : t('addLocation.button.back')}
          </button>
          {step === 'credentials' && (
            <button
              onClick={() => { handleTest(); setStep('test') }}
              disabled={!credentialsValid}
              className="text-sm px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {t('addLocation.button.testConnection')}
            </button>
          )}
          {step === 'test' && (
            <button
              onClick={() => setStep('summary')}
              disabled={!testResult?.success}
              className="text-sm px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {t('addLocation.button.continue')}
            </button>
          )}
          {step === 'summary' && (
            <button
              onClick={handleFinish}
              className="text-sm px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 transition-opacity"
            >
              {t('addLocation.button.done')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
