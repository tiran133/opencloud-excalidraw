import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { MainMenu, useI18n } from '@excalidraw/excalidraw'
import './PreferencesMenu.css'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { AppState } from '@excalidraw/excalidraw/types'
import { translateExtensionLabel } from '../i18n'
import { pickPreferencesState, prefsEqual } from '../preferencesState'
import type { PreferencesState } from '../preferencesState'
export { pickPreferencesState, prefsEqual }
export type { PreferencesState }

interface PreferencesMenuProps {
  excalidrawAPI: ExcalidrawImperativeAPI
  prefsState: PreferencesState
  readOnly?: boolean
}

const CheckIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const EmptyIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" />

const SettingsIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    role="img"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ width: 20, height: 20 }}
  >
    <path d="M7.98 1.546a1 1 0 0 1 .97-.754h2.1a1 1 0 0 1 .97.754l.244.996a.9.9 0 0 0 .553.601c.11.044.218.093.325.145a.9.9 0 0 0 .807-.017l.907-.486a1 1 0 0 1 1.2.16l1.485 1.486a1 1 0 0 1 .161 1.199l-.486.907a.9.9 0 0 0-.017.808c.052.106.1.214.145.324a.9.9 0 0 0 .601.553l.996.244a1 1 0 0 1 .754.97v2.1a1 1 0 0 1-.754.97l-.996.244a.9.9 0 0 0-.6.553 5 5 0 0 1-.146.325.9.9 0 0 0 .017.807l.486.907a1 1 0 0 1-.16 1.2l-1.486 1.485a1 1 0 0 1-1.199.161l-.907-.486a.9.9 0 0 0-.808-.017 5 5 0 0 1-.324.145.9.9 0 0 0-.553.601l-.244.996a1 1 0 0 1-.97.754h-2.1a1 1 0 0 1-.97-.754l-.244-.996a.9.9 0 0 0-.553-.6 5 5 0 0 1-.325-.146.9.9 0 0 0-.807.017l-.907.486a1 1 0 0 1-1.2-.16L2.459 15.39a1 1 0 0 1-.16-1.199l.485-.907a.9.9 0 0 0 .017-.808 5 5 0 0 1-.145-.324.9.9 0 0 0-.601-.553l-.996-.244a1 1 0 0 1-.754-.97v-2.1a1 1 0 0 1 .754-.97l.996-.244a.9.9 0 0 0 .6-.553 5 5 0 0 1 .146-.325.9.9 0 0 0-.017-.807l-.486-.907a1 1 0 0 1 .16-1.2L3.945 2.46a1 1 0 0 1 1.199-.16l.907.485a.9.9 0 0 0 .808.017 5 5 0 0 1 .324-.145.9.9 0 0 0 .553-.601z" />
    <circle cx="10" cy="10" r="3" />
  </svg>
)

const ChevronRight = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

function CheckboxItem({
  label,
  checked,
  shortcut,
  onToggle,
  disabled
}: {
  label: string
  checked: boolean
  shortcut?: string
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      className="preferences-submenu__item"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) {
          onToggle()
        }
      }}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <span className="preferences-submenu__icon">{checked ? <CheckIcon /> : <EmptyIcon />}</span>
      <span className="preferences-submenu__label">{label}</span>
      {shortcut && <span className="preferences-submenu__shortcut">{shortcut}</span>}
    </button>
  )
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ??
      navigator.userAgent
  )
const ctrlKey = isMac ? '⌘' : 'Ctrl'
const altKey = isMac ? '⌥' : 'Alt'

export default function PreferencesMenu({
  excalidrawAPI,
  prefsState,
  readOnly = false
}: PreferencesMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [portalPos, setPortalPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const { t, langCode } = useI18n()

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 200)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const handleEnter = useCallback(() => {
    cancelClose()
    setOpen(true)
  }, [cancelClose])

  const handleLeave = useCallback(() => {
    scheduleClose()
  }, [scheduleClose])

  useEffect(() => {
    return () => cancelClose()
  }, [cancelClose])

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPortalPos({
        top: rect.top,
        left: rect.right + 4
      })
    }
  }, [])

  useEffect(() => {
    if (open) {
      updatePosition()
    }
  }, [open, updatePosition])

  const toggle = (updates: Partial<AppState>) => {
    excalidrawAPI.updateScene({ appState: updates as AppState })
  }

  const isDark = prefsState.theme === 'dark'

  const submenuContent = open
    ? ReactDOM.createPortal(
        <div
          className={`preferences-submenu-portal${isDark ? ' theme--dark' : ''}`}
          style={{ top: portalPos.top, left: portalPos.left }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CheckboxItem
            label={t('toolBar.lock', undefined, 'Tool lock')}
            checked={prefsState.activeTool_locked}
            shortcut="Q"
            onToggle={() => {
              const appState = excalidrawAPI.getAppState()
              toggle({
                activeTool: {
                  ...appState.activeTool,
                  locked: !appState.activeTool.locked
                }
              })
            }}
          />
          <CheckboxItem
            label={t('buttons.objectsSnapMode', undefined, 'Snap to objects')}
            checked={prefsState.objectsSnapModeEnabled}
            shortcut={`${altKey}+S`}
            onToggle={() => toggle({ objectsSnapModeEnabled: !prefsState.objectsSnapModeEnabled })}
          />
          <CheckboxItem
            label={t('labels.toggleGrid', undefined, 'Toggle grid')}
            checked={prefsState.gridModeEnabled}
            shortcut={`${ctrlKey}+'`}
            onToggle={() => toggle({ gridModeEnabled: !prefsState.gridModeEnabled })}
          />
          <CheckboxItem
            label={t('buttons.zenMode', undefined, 'Zen mode')}
            checked={prefsState.zenModeEnabled}
            shortcut={`${altKey}+Z`}
            onToggle={() => toggle({ zenModeEnabled: !prefsState.zenModeEnabled })}
          />
          <CheckboxItem
            label={t('labels.viewMode', undefined, 'View mode')}
            checked={prefsState.viewModeEnabled}
            shortcut={`${altKey}+R`}
            onToggle={() => toggle({ viewModeEnabled: !prefsState.viewModeEnabled })}
            disabled={readOnly}
          />
          <CheckboxItem
            label={t('stats.fullTitle', undefined, 'Canvas & Shape properties')}
            checked={prefsState.statsOpen}
            shortcut={`${altKey}+/`}
            onToggle={() => toggle({ stats: { open: !prefsState.statsOpen, panels: 0 } })}
          />
        </div>,
        document.body
      )
    : null

  return (
    <>
      <MainMenu.ItemCustom onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <div className="preferences-trigger" ref={triggerRef}>
          <span className="preferences-trigger__icon">
            <SettingsIcon />
          </span>
          <span className="preferences-trigger__label">
            {translateExtensionLabel(langCode, 'Preferences')}
          </span>
          <span className="preferences-trigger__chevron">
            <ChevronRight />
          </span>
        </div>
      </MainMenu.ItemCustom>
      {submenuContent}
    </>
  )
}
