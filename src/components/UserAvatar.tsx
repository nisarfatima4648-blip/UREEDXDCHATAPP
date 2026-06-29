'use client'

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useState, useRef } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────

interface UserAvatarProps {
  user: { avatar_url?: string | null; username: string; status?: string } | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  showStatus?: boolean
  className?: string
}

// ─── Constants ─────────────────────────────────────────────────────────────

const SIZE_MAP: Record<string, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 80,
}

const STATUS_SIZE_MAP: Record<string, number> = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 20,
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-500',
  dnd: 'bg-rose-500',
  invisible: 'bg-slate-500',
  offline: 'bg-slate-500',
}

const FALLBACK_PALETTE = [
  'bg-slate-600',
  'bg-teal-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-violet-600',
  'bg-cyan-600',
  'bg-orange-600',
  'bg-pink-600',
  'bg-lime-600',
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function getUsernameHash(username: string): number {
  let hash = 0
  for (let i = 0; i < username.length; i++) {
    const char = username.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash)
}

function getFallbackColor(username: string): string {
  const hash = getUsernameHash(username)
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length]
}

// ─── Component ────────────────────────────────────────────────────────────

export function UserAvatar({
  user,
  size = 'md',
  showStatus = true,
  className,
}: UserAvatarProps) {
  const pixelSize = SIZE_MAP[size]
  const statusSize = STATUS_SIZE_MAP[size]
  const username = user?.username ?? '?'
  const status = user?.status ?? 'offline'
  const fallbackColor = getFallbackColor(username)
  const borderColor = status === 'dnd' ? 'ring-2 ring-rose-500' : ''
  const [imgLoaded, setImgLoaded] = useState(!!user?.avatar_url)
  const prevUrl = useRef(user?.avatar_url)

  // Reset loaded state when URL changes
  if (user?.avatar_url !== prevUrl.current) {
    prevUrl.current = user?.avatar_url
    if (!user?.avatar_url) setImgLoaded(false)
  }

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: pixelSize, height: pixelSize }}>
      <Avatar
        className={cn('rounded-full', borderColor)}
        style={{ width: pixelSize, height: pixelSize }}
      >
        {user?.avatar_url && (
          <AvatarImage
            src={user.avatar_url}
            alt={username}
            className="object-cover"
            onLoad={() => setImgLoaded(true)}
          />
        )}
        <AvatarFallback
          className={cn(
            'rounded-full font-semibold text-white select-none',
            fallbackColor,
            size === 'xs' && 'text-[10px]',
            size === 'sm' && 'text-xs',
            size === 'md' && 'text-sm',
            size === 'lg' && 'text-base',
            size === 'xl' && 'text-2xl',
            // Keep showing previous state while new image loads
            !imgLoaded && user?.avatar_url && 'invisible'
          )}
        >
          {username.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {showStatus && status !== 'offline' && status !== 'invisible' && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-background',
            STATUS_COLORS[status]
          )}
          style={{ width: statusSize, height: statusSize }}
        />
      )}
    </div>
  )
}
