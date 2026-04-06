import assert from 'node:assert/strict'
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from './useTheme'

function run() {
  const validThemes: ThemePreference[] = ['light', 'dark', 'system']

  for (const theme of validThemes) {
    assert.equal(isThemePreference(theme), true)
  }

  for (const invalid of [undefined, null, '', 'blue', 'LIGHT', 123]) {
    assert.equal(isThemePreference(invalid), false)
  }

  assert.equal(THEME_STORAGE_KEY, 'chaoscode.theme')
  assert.equal(resolveTheme('light', 'dark'), 'light')
  assert.equal(resolveTheme('dark', 'light'), 'dark')
  assert.equal(resolveTheme('system', 'dark'), 'dark')
  assert.equal(resolveTheme('system', 'light'), 'light')

  console.log('useTheme helpers passed')
}

run()

