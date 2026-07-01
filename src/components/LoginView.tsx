'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useAppStore } from '@/lib/store'
import { connectSocket } from '@/lib/socket'
import type { User } from '@/lib/database'

// ─── Types ─────────────────────────────────────────────────────────────────

type AuthMode = 'login' | 'register'

// ─── Loading Screen ────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-5"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-16 h-16 rounded-full border-4 border-emerald-500/30 border-t-emerald-500"
        />
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">UREEDXD</h1>
          <p className="mt-1 text-sm text-muted-foreground">Loading everything...</p>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────

export function LoginView() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [initializing, setInitializing] = useState(true)
  const initializedRef = useRef(false)

  // Login fields
  const [loginUsername, setLoginUsername] = useState('')

  // Register fields
  const [regUsername, setRegUsername] = useState('')
  const [regDisplayName, setRegDisplayName] = useState('')

  const setCurrentUser = useAppStore((s) => s.setCurrentUser)

  // ─── Auto-login: check localStorage for saved user ─────────────────────
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const savedUserId = localStorage.getItem('ureedxdchat_user_id')
    if (savedUserId) {
      // Try to auto-login
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedUserId }),
      })
        .then((res) => {
          if (res.ok) return res.json()
          throw new Error('not found')
        })
        .then((user: User) => {
          setCurrentUser(user)
          connectSocket(user.id)
        })
        .catch(() => {
          localStorage.removeItem('ureedxdchat_user_id')
        })
        .finally(() => setInitializing(false))
    } else {
      setInitializing(false)
    }
  }, [setCurrentUser])

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!loginUsername.trim()) return

      setLoading(true)
      setError('')

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: loginUsername.trim() }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Login failed')
          return
        }

        const user: User = await res.json()
        localStorage.setItem('ureedxdchat_user_id', user.id)
        setCurrentUser(user)
        connectSocket(user.id)
      } catch {
        setError('Network error. Please try again.')
      } finally {
        setLoading(false)
      }
    },
    [loginUsername, setCurrentUser]
  )

  const handleRegister = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!regUsername.trim() || !regDisplayName.trim()) return

      setLoading(true)
      setError('')

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: regUsername.trim(),
            displayName: regDisplayName.trim(),
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Registration failed')
          return
        }

        const user: User = await res.json()
        localStorage.setItem('ureedxdchat_user_id', user.id)
        setCurrentUser(user)
        connectSocket(user.id)
      } catch {
        setError('Network error. Please try again.')
      } finally {
        setLoading(false)
      }
    },
    [regUsername, regDisplayName, setCurrentUser]
  )

  const toggleMode = () => {
    setError('')
    setMode((prev) => (prev === 'login' ? 'register' : 'login'))
  }

  // ─── Show loading screen while initializing ────────────────────────────
  if (initializing) return <LoadingScreen />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-background via-card to-card/80 opacity-80" />

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="rounded-xl bg-[#2a2a4a] p-8 shadow-2xl border border-white/5">
            {/* Logo / Title */}
            <div className="mb-6 flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600/20 shadow-lg overflow-hidden">
                <img src="/ureedxd-logo.png" alt="UREEDXD" className="h-full w-full object-cover rounded-2xl" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  UREEDXD
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Chat with your friends and communities
                </p>
              </div>
            </div>

            <Separator className="mb-6 bg-white/10" />

            {/* Mode Toggle */}
            <div className="mb-6 flex rounded-lg bg-white/5 p-1">
              <button
                onClick={() => { setMode('login'); setError('') }}
                className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                  mode === 'login'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Login
              </button>
              <button
                onClick={() => { setMode('register'); setError('') }}
                className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                  mode === 'register'
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Register
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-4 rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3"
              >
                <p className="text-sm text-rose-400">{error}</p>
              </motion.div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    Username
                  </label>
                  <Input
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                    autoComplete="username"
                    autoFocus
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading || !loginUsername.trim()}
                  className="mt-2 h-11 bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  {loading ? 'Entering...' : 'Enter'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    Username
                  </label>
                  <Input
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="Choose a username"
                    className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                    autoComplete="username"
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    Display Name
                  </label>
                  <Input
                    value={regDisplayName}
                    onChange={(e) => setRegDisplayName(e.target.value)}
                    placeholder="Your display name"
                    className="border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                    autoComplete="off"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={
                    loading ||
                    !regUsername.trim() ||
                    !regDisplayName.trim()
                  }
                  className="mt-2 h-11 bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  {loading ? 'Creating Account...' : 'Create Account'}
                </Button>
              </form>
            )}

            <Separator className="my-5 bg-white/10" />

            <p className="text-center text-sm text-slate-400">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={toggleMode}
                    className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                  >
                    Register
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={toggleMode}
                    className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                  >
                    Login
                  </button>
                </>
              )}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}