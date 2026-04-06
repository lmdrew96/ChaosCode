import { useEffect, useLayoutEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'chaoscode.theme'

const THEME_PREFERENCE_VALUES: ThemePreference[] = ['light', 'dark', 'system']

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCE_VALUES.includes(value as ThemePreference)
}

export function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return isThemePreference(stored) ? stored : 'system'
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => getInitialPreference())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  const resolvedTheme = resolveTheme(preference, systemTheme)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.classList.toggle('light', resolvedTheme === 'light')
    root.style.colorScheme = resolvedTheme
    document.body.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  }, [preference])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const updateTheme = (event?: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme((event?.matches ?? media.matches) ? 'dark' : 'light')
    }

    updateTheme(media)

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updateTheme)
      return () => media.removeEventListener('change', updateTheme)
    }

    media.addListener(updateTheme)
    return () => media.removeListener(updateTheme)
  }, [])

  return {
    theme: preference,
    setTheme: setPreference,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
  }
}

