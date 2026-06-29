'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import ThemeInitializer from './ThemeInitializer'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
    >
      <ThemeInitializer />
      {children}
    </NextThemesProvider>
  )
}