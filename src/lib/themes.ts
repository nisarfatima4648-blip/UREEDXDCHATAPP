// ─── Theme Type ──────────────────────────────────────────────────────────────

export interface ThemeColors {
  background: string
  foreground: string
  card: string
  'card-foreground': string
  popover: string
  'popover-foreground': string
  primary: string
  'primary-foreground': string
  secondary: string
  'secondary-foreground': string
  muted: string
  'muted-foreground': string
  accent: string
  'accent-foreground': string
  destructive: string
  border: string
  input: string
  ring: string
  sidebar: string
  'sidebar-foreground': string
  'sidebar-primary': string
  'sidebar-primary-foreground': string
  'sidebar-accent': string
  'sidebar-accent-foreground': string
  'sidebar-border': string
  'sidebar-ring': string
}

export interface GradientConfig {
  colors: string[]
  angle: number
  intensity: number
}

export interface CustomTheme {
  colors: Record<string, string>
  gradient: GradientConfig
}

export interface ThemeDefinition {
  id: string
  name: string
  colors: ThemeColors
  gradient?: GradientConfig
  glassy?: boolean
}

// ─── Midnight (Default Dark - matches current .dark) ─────────────────────────

export const midnightTheme: ThemeDefinition = {
  id: 'midnight',
  name: 'Midnight',
  colors: {
    background: '#313338',
    foreground: '#dbdee1',
    card: '#2b2d31',
    'card-foreground': '#dbdee1',
    popover: '#2b2d31',
    'popover-foreground': '#dbdee1',
    primary: '#23a559',
    'primary-foreground': '#ffffff',
    secondary: '#35373c',
    'secondary-foreground': '#dbdee1',
    muted: '#35373c',
    'muted-foreground': '#949ba4',
    accent: '#35373c',
    'accent-foreground': '#dbdee1',
    destructive: '#f23f43',
    border: '#3f4147',
    input: '#383a40',
    ring: '#23a559',
    sidebar: '#2b2d31',
    'sidebar-foreground': '#dbdee1',
    'sidebar-primary': '#23a559',
    'sidebar-primary-foreground': '#ffffff',
    'sidebar-accent': '#35373c',
    'sidebar-accent-foreground': '#dbdee1',
    'sidebar-border': '#3f4147',
    'sidebar-ring': '#23a559',
  },
}

// ─── Daylight (Clean Light Theme) ────────────────────────────────────────────

export const daylightTheme: ThemeDefinition = {
  id: 'daylight',
  name: 'Daylight',
  colors: {
    background: '#ffffff',
    foreground: '#1e1f22',
    card: '#f2f3f5',
    'card-foreground': '#1e1f22',
    popover: '#ffffff',
    'popover-foreground': '#1e1f22',
    primary: '#5865f2',
    'primary-foreground': '#ffffff',
    secondary: '#e3e5e8',
    'secondary-foreground': '#1e1f22',
    muted: '#ebedef',
    'muted-foreground': '#5c5e66',
    accent: '#e3e5e8',
    'accent-foreground': '#1e1f22',
    destructive: '#f23f43',
    border: '#e3e5e8',
    input: '#ebedef',
    ring: '#5865f2',
    sidebar: '#f2f3f5',
    'sidebar-foreground': '#1e1f22',
    'sidebar-primary': '#5865f2',
    'sidebar-primary-foreground': '#ffffff',
    'sidebar-accent': '#e3e5e8',
    'sidebar-accent-foreground': '#1e1f22',
    'sidebar-border': '#e3e5e8',
    'sidebar-ring': '#5865f2',
  },
}

// ─── Glassy (Frosted Glass Effect) ───────────────────────────────────────────

export const glassyTheme: ThemeDefinition = {
  id: 'glassy',
  name: 'Glassy',
  glassy: true,
  gradient: { colors: ['#667eea', '#764ba2', '#f093fb'], angle: 135, intensity: 70 },
  colors: {
    background: 'rgba(30, 30, 46, 0.55)',
    foreground: '#cdd6f4',
    card: 'rgba(49, 50, 68, 0.45)',
    'card-foreground': '#cdd6f4',
    popover: 'rgba(49, 50, 68, 0.6)',
    'popover-foreground': '#cdd6f4',
    primary: '#89b4fa',
    'primary-foreground': '#1e1e2e',
    secondary: 'rgba(108, 112, 134, 0.3)',
    'secondary-foreground': '#cdd6f4',
    muted: 'rgba(108, 112, 134, 0.3)',
    'muted-foreground': '#a6adc8',
    accent: 'rgba(137, 180, 250, 0.2)',
    'accent-foreground': '#cdd6f4',
    destructive: '#f38ba8',
    border: 'rgba(205, 214, 244, 0.12)',
    input: 'rgba(49, 50, 68, 0.6)',
    ring: '#89b4fa',
    sidebar: 'rgba(30, 30, 46, 0.5)',
    'sidebar-foreground': '#cdd6f4',
    'sidebar-primary': '#89b4fa',
    'sidebar-primary-foreground': '#1e1e2e',
    'sidebar-accent': 'rgba(137, 180, 250, 0.15)',
    'sidebar-accent-foreground': '#cdd6f4',
    'sidebar-border': 'rgba(205, 214, 244, 0.1)',
    'sidebar-ring': '#89b4fa',
  },
}

// ─── Forest (Deep Greens & Earthy Tones) ─────────────────────────────────────

export const forestTheme: ThemeDefinition = {
  id: 'forest',
  name: 'Forest',
  colors: {
    background: '#1a2e1a',
    foreground: '#d4e7c5',
    card: '#1f3520',
    'card-foreground': '#d4e7c5',
    popover: '#1f3520',
    'popover-foreground': '#d4e7c5',
    primary: '#4ade80',
    'primary-foreground': '#0a1f0a',
    secondary: '#2a4a2a',
    'secondary-foreground': '#d4e7c5',
    muted: '#2a4a2a',
    'muted-foreground': '#8aab7a',
    accent: '#3a5a3a',
    'accent-foreground': '#d4e7c5',
    destructive: '#ef4444',
    border: '#2e502e',
    input: '#243f24',
    ring: '#4ade80',
    sidebar: '#162616',
    'sidebar-foreground': '#d4e7c5',
    'sidebar-primary': '#4ade80',
    'sidebar-primary-foreground': '#0a1f0a',
    'sidebar-accent': '#2a4a2a',
    'sidebar-accent-foreground': '#d4e7c5',
    'sidebar-border': '#2e502e',
    'sidebar-ring': '#4ade80',
  },
}

// ─── Cyberpunk (Neon Pinks, Cyans, Dark) ─────────────────────────────────────

export const cyberpunkTheme: ThemeDefinition = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  gradient: { colors: ['#0f0c29', '#302b63', '#24243e'], angle: 135, intensity: 100 },
  colors: {
    background: '#1a0a2e',
    foreground: '#e0d4ff',
    card: '#261244',
    'card-foreground': '#e0d4ff',
    popover: '#261244',
    'popover-foreground': '#e0d4ff',
    primary: '#ff2d95',
    'primary-foreground': '#ffffff',
    secondary: '#1e1245',
    'secondary-foreground': '#e0d4ff',
    muted: '#1e1245',
    'muted-foreground': '#9a8abf',
    accent: '#00f0ff',
    'accent-foreground': '#0a0a1a',
    destructive: '#ff4444',
    border: '#3a1a5e',
    input: '#2a1850',
    ring: '#ff2d95',
    sidebar: '#120824',
    'sidebar-foreground': '#c8b8e8',
    'sidebar-primary': '#ff2d95',
    'sidebar-primary-foreground': '#ffffff',
    'sidebar-accent': '#1a1040',
    'sidebar-accent-foreground': '#00f0ff',
    'sidebar-border': '#2e1258',
    'sidebar-ring': '#00f0ff',
  },
}

// ─── Futuristic (Purples, Blues, Sleek Dark) ─────────────────────────────────

export const futuristicTheme: ThemeDefinition = {
  id: 'futuristic',
  name: 'Futuristic',
  gradient: { colors: ['#0c0c1d', '#1a1a3e', '#0d1b2a'], angle: 160, intensity: 100 },
  colors: {
    background: '#12122a',
    foreground: '#c8d6e5',
    card: '#1a1a3e',
    'card-foreground': '#c8d6e5',
    popover: '#1a1a3e',
    'popover-foreground': '#c8d6e5',
    primary: '#7c5cfc',
    'primary-foreground': '#ffffff',
    secondary: '#1e1e42',
    'secondary-foreground': '#c8d6e5',
    muted: '#1e1e42',
    'muted-foreground': '#7f8fa6',
    accent: '#3d6bff',
    'accent-foreground': '#ffffff',
    destructive: '#ff5252',
    border: '#2a2a50',
    input: '#1e1e42',
    ring: '#7c5cfc',
    sidebar: '#0e0e24',
    'sidebar-foreground': '#a8b8d0',
    'sidebar-primary': '#7c5cfc',
    'sidebar-primary-foreground': '#ffffff',
    'sidebar-accent': '#1e1e42',
    'sidebar-accent-foreground': '#a8b8d0',
    'sidebar-border': '#252550',
    'sidebar-ring': '#7c5cfc',
  },
}

// ─── All Predefined Themes ───────────────────────────────────────────────────

export const predefinedThemes: ThemeDefinition[] = [
  midnightTheme,
  daylightTheme,
  glassyTheme,
  forestTheme,
  cyberpunkTheme,
  futuristicTheme,
]

export const themeMap = new Map<string, ThemeDefinition>(
  predefinedThemes.map((t) => [t.id, t])
)

// ─── Helper: apply theme CSS variables to document ───────────────────────────

export function applyThemeColors(colors: ThemeColors, element?: HTMLElement) {
  const el = element || document.documentElement
  for (const [key, value] of Object.entries(colors)) {
    el.style.setProperty(`--${key}`, value)
  }
}

export function removeThemeOverrides(element?: HTMLElement) {
  const el = element || document.documentElement
  const vars = [
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted',
    'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border',
    'input', 'ring', 'sidebar', 'sidebar-foreground', 'sidebar-primary',
    'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground',
    'sidebar-border', 'sidebar-ring',
  ]
  for (const v of vars) {
    el.style.removeProperty(`--${v}`)
  }
}

export function applyGradientBackground(gradient?: GradientConfig | null) {
  const body = document.body
  if (!gradient || gradient.colors.length === 0) {
    body.style.removeProperty('--theme-gradient')
    body.style.backgroundImage = ''
    return
  }
  const stops = gradient.colors
    .map((c, i) => `${c} ${(i / (gradient.colors.length - 1)) * 100}%`)
    .join(', ')
  const css = `linear-gradient(${gradient.angle}deg, ${stops})`
  body.style.backgroundImage = css
  body.style.setProperty('--theme-gradient', css)
}

export function clearGradientBackground() {
  document.body.style.backgroundImage = ''
  document.body.style.removeProperty('--theme-gradient')
}

// ─── HSL Color Utilities ─────────────────────────────────────────────────────

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { h: 0, s: 0, l: 50 }
  const r = parseInt(result[1], 16) / 255
  const g = parseInt(result[2], 16) / 255
  const b = parseInt(result[3], 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

// ─── Generate Random Theme ───────────────────────────────────────────────────

export function generateRandomTheme(): { colors: Record<string, string>; gradient: GradientConfig } {
  const h = () => Math.floor(Math.random() * 360)
  const hue = h()
  const hue2 = (hue + 40 + Math.floor(Math.random() * 80)) % 360
  const hue3 = (hue2 + 40 + Math.floor(Math.random() * 80)) % 360

  const bgHex = hslToHex(hue, 15, 12)
  const fgHex = hslToHex(hue, 10, 88)
  const primaryHex = hslToHex(hue2, 75, 60)
  const cardHex = hslToHex(hue, 15, 15)
  const secondaryHex = hslToHex(hue, 12, 20)
  const mutedHex = hslToHex(hue, 10, 25)
  const mutedFgHex = hslToHex(hue, 8, 60)
  const accentHex = hslToHex(hue3, 60, 55)
  const borderHex = hslToHex(hue, 12, 22)
  const inputHex = hslToHex(hue, 12, 18)

  return {
    colors: {
      background: bgHex,
      foreground: fgHex,
      card: cardHex,
      'card-foreground': fgHex,
      popover: cardHex,
      'popover-foreground': fgHex,
      primary: primaryHex,
      'primary-foreground': '#ffffff',
      secondary: secondaryHex,
      'secondary-foreground': fgHex,
      muted: mutedHex,
      'muted-foreground': mutedFgHex,
      accent: accentHex,
      'accent-foreground': fgHex,
      destructive: '#f23f43',
      border: borderHex,
      input: inputHex,
      ring: primaryHex,
      sidebar: bgHex,
      'sidebar-foreground': fgHex,
      'sidebar-primary': primaryHex,
      'sidebar-primary-foreground': '#ffffff',
      'sidebar-accent': secondaryHex,
      'sidebar-accent-foreground': fgHex,
      'sidebar-border': borderHex,
      'sidebar-ring': primaryHex,
    },
    gradient: {
      colors: [
        hslToHex(hue, 40, 8),
        hslToHex(hue2, 35, 10),
        hslToHex(hue3, 30, 7),
      ],
      angle: Math.floor(Math.random() * 360),
      intensity: 60 + Math.floor(Math.random() * 40),
    },
  }
}