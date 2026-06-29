'use client'

import { useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  MessageSquareIcon,
  PencilIcon,
  AlertCircleIcon,
  CalendarIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { User } from '@/lib/database'

// ─── Props ─────────────────────────────────────────────────────────────────

interface UserProfileCardProps {
  userId: string
  children: React.ReactNode
  currentUser?: User | null
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; dotClass: string; badgeClass: string }
> = {
  online: {
    label: 'Online',
    dotClass: 'bg-emerald-500',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  idle: {
    label: 'Idle',
    dotClass: 'bg-amber-500',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  dnd: {
    label: 'Do Not Disturb',
    dotClass: 'bg-rose-500',
    badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  },
  invisible: {
    label: 'Invisible',
    dotClass: 'bg-gray-500',
    badgeClass: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-gray-500',
    badgeClass: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  },
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

const BANNER_PALETTE = [
  'bg-gradient-to-br from-slate-700 to-slate-900',
  'bg-gradient-to-br from-teal-700 to-teal-950',
  'bg-gradient-to-br from-emerald-700 to-emerald-950',
  'bg-gradient-to-br from-amber-700 to-amber-950',
  'bg-gradient-to-br from-rose-700 to-rose-950',
  'bg-gradient-to-br from-violet-700 to-violet-950',
  'bg-gradient-to-br from-cyan-700 to-cyan-950',
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getFallbackColor(username: string): string {
  return FALLBACK_PALETTE[hashString(username) % FALLBACK_PALETTE.length]
}

function getBannerGradient(userId: string): string {
  return BANNER_PALETTE[hashString(userId) % BANNER_PALETTE.length]
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const isCurrentYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(isCurrentYear ? {} : { year: 'numeric' }),
  })
}

// ─── Component ─────────────────────────────────────────────────────────────

export function UserProfileCard({ userId, children, currentUser }: UserProfileCardProps) {
  const loggedInUser = useAppStore((s) => s.currentUser)
  const selectDM = useAppStore((s) => s.selectDM)
  const addDMConversation = useAppStore((s) => s.addDMConversation)
  const dmConversations = useAppStore((s) => s.dmConversations)

  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<User | null>(currentUser ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messaging, setMessaging] = useState(false)

  // Track the last fetched userId so we know when to refetch
  const lastFetchedId = useRef<string | null>(currentUser ? userId : null)

  const isOwnProfile = loggedInUser?.id === userId

  // Derive the displayed user: prefer prop, then fetched
  const displayUser = currentUser ?? user

  // Fetch user data — called from event handlers, not effects
  const fetchUser = useCallback(async (targetUserId: string) => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(targetUserId)}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('User not found')
        } else {
          setError('Failed to load profile')
        }
        setUser(null)
        return
      }
      const data: User = await res.json()
      setUser(data)
    } catch {
      setError('Failed to load profile')
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Handle popover open/close — fetch data on open, reset on close
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)

      if (nextOpen) {
        // If we already have fresh data for this user (from prop or recent fetch), reuse it
        if (currentUser) {
          setUser(currentUser)
          setError(null)
          setLoading(false)
        } else if (lastFetchedId.current !== userId) {
          // Different user than last time — fetch fresh
          setUser(null)
          setError(null)
          fetchUser(userId).then(() => {
            lastFetchedId.current = userId
          })
        } else if (!user) {
          // Same user but no data yet (e.g. previous fetch failed)
          setError(null)
          fetchUser(userId)
        }
        // If same user and data exists, just show it — no refetch needed
      } else {
        // Reset loading state when closing so next open can re-trigger
        if (!currentUser) {
          setLoading(false)
        }
      }
    },
    [currentUser, userId, user, fetchUser]
  )

  const handleMessage = async () => {
    if (!displayUser || messaging) return
    setMessaging(true)

    try {
      // Check if a DM conversation already exists
      const existing = dmConversations.find(
        (dm) => dm.other_user_id === displayUser.id
      )

      if (existing) {
        selectDM(existing.id)
      } else {
        // Create a new DM conversation
        const res = await fetch('/api/dms/conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otherUserId: displayUser.id }),
        })
        if (res.ok) {
          const conversation = await res.json()
          addDMConversation(conversation)
          selectDM(conversation.id)
        }
      }

      setOpen(false)
    } catch {
      // Silently fail — user can retry
    } finally {
      setMessaging(false)
    }
  }

  const statusKey = displayUser?.status ?? 'offline'
  const statusInfo = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.offline

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent
        className="w-[320px] p-0 overflow-hidden rounded-lg bg-popover text-popover-foreground border border-border"
        side="right"
        sideOffset={8}
        align="start"
      >
        {/* ── Banner ──────────────────────────────────────────────────────── */}
        <div className="relative h-[60px] w-full overflow-hidden">
          {displayUser?.banner_url ? (
            <img
              src={displayUser.banner_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={cn(
                'h-full w-full',
                getBannerGradient(userId)
              )}
            />
          )}
        </div>

        {/* ── Avatar (overlapping banner) ──────────────────────────────────── */}
        <div className="relative flex justify-center">
          <div className="absolute -top-8">
            {loading ? (
              <Skeleton className="size-16 rounded-full border-[6px] border-popover" />
            ) : displayUser ? (
              <div className="relative size-16 rounded-full border-[6px] border-popover">
                <Avatar className="size-full rounded-full">
                  {displayUser.avatar_url && (
                    <AvatarImage
                      src={displayUser.avatar_url}
                      alt={displayUser.username}
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback
                    className={cn(
                      'rounded-full font-bold text-white text-2xl select-none',
                      getFallbackColor(displayUser.username)
                    )}
                  >
                    {displayUser.username.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        <div className="px-4 pt-12 pb-4">
          {loading && (
            <div className="space-y-3">
              <div className="flex justify-center">
                <Skeleton className="h-5 w-32 rounded" />
              </div>
              <div className="flex justify-center">
                <Skeleton className="h-3.5 w-24 rounded" />
              </div>
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-9 w-full rounded" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-2 py-4 text-destructive">
              <AlertCircleIcon className="size-8" />
              <p className="text-sm">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchUser(userId)}
                className="text-xs"
              >
                Retry
              </Button>
            </div>
          )}

          {displayUser && !loading && !error && (
            <>
              {/* Display name + status badge */}
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold leading-tight text-foreground">
                    {displayUser.display_name || displayUser.username}
                  </h3>
                  <span
                    className={cn(
                      'inline-block size-2.5 rounded-full shrink-0',
                      statusInfo.dotClass
                    )}
                  />
                </div>

                {/* Username */}
                <p className="text-sm text-muted-foreground">
                  @{displayUser.username}
                </p>
              </div>

              {/* Custom Status */}
              {displayUser.custom_status && (
                <div className="mt-2 flex justify-center">
                  <Badge
                    variant="outline"
                    className={cn('text-xs font-normal', statusInfo.badgeClass)}
                  >
                    {displayUser.custom_status}
                  </Badge>
                </div>
              )}

              {/* Divider */}
              <div className="my-3">
                <Separator className="bg-border" />
              </div>

              {/* Bio */}
              {displayUser.bio ? (
                <div className="mb-3">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                    {displayUser.bio}
                  </p>
                </div>
              ) : (
                <p className="mb-3 text-center text-sm text-muted-foreground italic">
                  This user hasn&apos;t written a bio yet.
                </p>
              )}

              {/* Member Since */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarIcon className="size-3.5 shrink-0" />
                <span>Member since {formatDate(displayUser.created_at)}</span>
              </div>

              {/* Action Button */}
              <div className="mt-3">
                {isOwnProfile ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => setOpen(false)}
                  >
                    <PencilIcon className="size-3.5" />
                    Edit Profile
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={handleMessage}
                    disabled={messaging}
                  >
                    <MessageSquareIcon className="size-3.5" />
                    {messaging ? 'Opening...' : 'Message'}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}