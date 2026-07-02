'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import ThemeInitializer from './ThemeInitializer'
import { InstallPrompt } from './InstallPrompt'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
    >
      <ThemeInitializer />
      {children}
      <InstallPrompt />
    </NextThemesProvider>
  )
}
