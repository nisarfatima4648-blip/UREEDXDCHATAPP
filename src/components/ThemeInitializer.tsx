'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import {
  themeMap,
  type CustomTheme,
  applyThemeColors,
  removeThemeOverrides,
  applyGradientBackground,
  clearGradientBackground,
} from '@/lib/themes'

/**
 * Reads persisted theme from localStorage on mount and applies CSS variables.
 * Place this component inside Providers so it runs on every page.
 */
export default function ThemeInitializer() {
  const activeThemeId = useAppStore((s) => s.activeThemeId)
  const customTheme = useAppStore((s) => s.customTheme)
  const setActiveThemeId = useAppStore((s) => s.setActiveThemeId)
  const setCustomTheme = useAppStore((s) => s.setCustomTheme)

  // Restore from localStorage on first mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedId = localStorage.getItem('discord-theme-id')
    const savedCustom = localStorage.getItem('discord-custom-theme')

    if (savedId && savedId !== 'midnight') {
      if (savedId === 'custom' && savedCustom) {
        try {
          const parsed = JSON.parse(savedCustom) as CustomTheme
          setCustomTheme(parsed)
        } catch {
          setActiveThemeId(savedId)
        }
      } else if (themeMap.has(savedId)) {
        setActiveThemeId(savedId)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply theme CSS whenever activeThemeId or customTheme changes
  useEffect(() => {
    if (typeof document === 'undefined') return

    document.documentElement.classList.remove('theme-glassy')

    if (activeThemeId === 'custom' && customTheme) {
      applyThemeColors(customTheme.colors as any)
      applyGradientBackground(customTheme.gradient)
    } else {
      const theme = themeMap.get(activeThemeId)
      if (theme) {
        applyThemeColors(theme.colors)
        if (theme.gradient) {
          applyGradientBackground(theme.gradient)
        } else {
          clearGradientBackground()
        }
        if (theme.glassy) {
          document.documentElement.classList.add('theme-glassy')
        }
      } else {
        removeThemeOverrides()
        clearGradientBackground()
      }
    }
  }, [activeThemeId, customTheme])

  return null
}