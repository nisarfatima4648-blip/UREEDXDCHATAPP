'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  X,
  Download,
  Share,
  PlusSquare,
  Smartphone,
  Monitor,
  Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Platform Detection ─────────────────────────────────────────────────────

interface PlatformInfo {
  isIOS: boolean
  isAndroid: boolean
  isStandalone: boolean
  isDesktop: boolean
}

function detectPlatform(): PlatformInfo {
  if (typeof window === 'undefined') {
    return { isIOS: false, isAndroid: false, isStandalone: false, isDesktop: false }
  }

  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/.test(ua)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://')

  return {
    isIOS,
    isAndroid,
    isStandalone,
    isDesktop: !isIOS && !isAndroid,
  }
}

// ─── LocalStorage Keys ──────────────────────────────────────────────────────

const DISMISS_KEY = 'ureedxd_install_dismissed'
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

function isDismissed(): boolean {
  try {
    const ts = localStorage.getItem(DISMISS_KEY)
    if (!ts) return false
    return Date.now() - parseInt(ts, 10) < DISMISS_DURATION
  } catch {
    return false
  }
}

function setDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {}
}

// ─── Component ──────────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)
  const [platform, setPlatform] = useState<PlatformInfo>({
    isIOS: false,
    isAndroid: false,
    isStandalone: false,
    isDesktop: false,
  })
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    setMounted(true)
    const p = detectPlatform()
    setPlatform(p)

    // Don't show if already installed (standalone mode)
    if (p.isStandalone) return

    // Don't show if dismissed recently
    if (isDismissed()) return

    // ─── Capture beforeinstallprompt event (Chrome/Edge/Android) ────────
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      // Show after a short delay (don't be aggressive)
      setTimeout(() => setShow(true), 3000)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall)

    // ─── iOS: no beforeinstallprompt event, show manually ───────────────
    if (p.isIOS && !p.isStandalone) {
      const timer = setTimeout(() => {
        if (!isDismissed()) setShow(true)
      }, 5000)
      return () => {
        clearTimeout(timer)
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setShow(false)
        setDismissed()
      }
      setDeferredPrompt(null)
    }
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setShow(false)
    setDismissed()
  }, [])

  if (!mounted || !show) return null

  // ─── iOS: Show "Add to Home Screen" instructions ─────────────────────
  if (platform.isIOS) {
    return createPortal(
      <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="relative w-full max-w-sm rounded-2xl bg-[#1e1f22] border border-white/10 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Smartphone className="size-5 text-emerald-400" />
              <h2 className="text-sm font-bold text-white">Install UREEDXD</h2>
            </div>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-white transition-colors p-1 rounded-md hover:bg-white/5"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <img src="/ureedxd-logo.png" alt="UREEDXD" className="size-12 rounded-xl object-cover" />
              <div>
                <p className="text-sm font-semibold text-white">UREEDXD — Voice & Text Chat</p>
                <p className="text-xs text-muted-foreground">Add to Home Screen for voice chat</p>
              </div>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              To use voice chat and calls, install UREEDXD as an app. Voice features require native microphone access which is only available in the installed app.
            </p>

            {/* Steps */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                  <Share className="size-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white">Tap the Share button</p>
                  <p className="text-[11px] text-muted-foreground">It's at the bottom of the screen (box with up arrow)</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                  <PlusSquare className="size-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white">Select "Add to Home Screen"</p>
                  <p className="text-[11px] text-muted-foreground">Scroll down and tap the option</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                  <Volume2 className="size-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-white">Open from Home Screen & allow mic</p>
                  <p className="text-[11px] text-muted-foreground">Voice chat will work after granting permission</p>
                </div>
              </div>
            </div>

            {/* Mic permission note */}
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <Volume2 className="size-3.5 text-amber-400 shrink-0" />
              <p className="text-[11px] text-amber-300">
                Microphone access is blocked in in-app browsers. Install to the Home Screen to enable voice.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/5 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground hover:text-white"
              onClick={handleDismiss}
            >
              Maybe later
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              onClick={handleDismiss}
            >
              <Share className="size-3.5" />
              Got it
            </Button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // ─── Desktop / Android: Show "Install App" button ────────────────────
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[200] animate-in slide-in-from-bottom-4 duration-300">
      <div className="relative w-80 rounded-xl bg-[#1e1f22] border border-white/10 shadow-2xl overflow-hidden">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-2 right-2 z-10 text-muted-foreground hover:text-white transition-colors p-1 rounded-md hover:bg-white/5"
        >
          <X className="size-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 p-4 pb-3">
          <img src="/ureedxd-logo.png" alt="UREEDXD" className="size-10 rounded-lg object-cover" />
          <div>
            <p className="text-sm font-bold text-white">Install UREEDXD</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {platform.isDesktop ? (
                <><Monitor className="size-3" /> Desktop app</>
              ) : (
                <><Smartphone className="size-3" /> Android app</>
              )}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 pb-3">
          <p className="text-xs text-zinc-400 leading-relaxed mb-3">
            Install the app for faster access, push notifications, and full voice chat support with microphone access.
          </p>

          {/* Feature list */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Volume2 className="size-2.5" /> Voice Chat
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Smartphone className="size-2.5" /> Offline Ready
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Download className="size-2.5" /> Fast Launch
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 pt-2 border-t border-white/5">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-muted-foreground hover:text-white text-xs"
            onClick={handleDismiss}
          >
            Not now
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 text-xs"
            onClick={handleInstall}
          >
            <Download className="size-3.5" />
            Install App
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
