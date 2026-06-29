'use client'

import { useMemo, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Volume2Icon, MessageSquareIcon, UserMinusIcon, ShieldBanIcon, CrownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GCMember, User, VoiceSession } from '@/lib/database'

// ─── Status indicator colors ────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-500',
  dnd: 'bg-red-500',
  invisible: 'bg-zinc-500',
  offline: 'bg-zinc-600',
}

// ─── Inline avatar with status dot ─────────────────────────────────────────

function MemberAvatar({ user, className }: { user?: User; className?: string }) {
  const onlineUsers = useAppStore((s) => s.onlineUsers)
  const isOnline = user ? onlineUsers.includes(user.id) : false
  const statusColor = user
    ? statusColors[user.status === 'invisible' ? 'offline' : user.status] || statusColors.offline
    : statusColors.offline

  return (
    <div className={cn('relative shrink-0', className)}>
      <Avatar className="size-8">
        {user?.avatar_url && <AvatarImage src={user.avatar_url} alt={user.display_name} />}
        <AvatarFallback className="text-xs bg-zinc-600 text-zinc-200">
          {user?.display_name?.charAt(0)?.toUpperCase() || '?'}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 block size-3 rounded-full ring-2 ring-[#2f3136]',
          isOnline ? statusColor : 'bg-zinc-600'
        )}
      />
    </div>
  )
}

// ─── Member popover actions ─────────────────────────────────────────────────

function MemberActions({ member, onClose }: { member: GCMember; onClose: () => void }) {
  const currentUser = useAppStore((s) => s.currentUser)
  const selectedGCId = useAppStore((s) => s.selectedGCId)
  const gcMembers = useAppStore((s) => s.gcMembers)

  const myMember = selectedGCId
    ? gcMembers[selectedGCId]?.find((m) => m.user_id === currentUser?.id)
    : null

  const isOwner = myMember?.role === 'owner'
  const canKick = isOwner || myMember?.can_kick
  const canBan = isOwner || myMember?.can_ban

  const isSelf = member.user_id === currentUser?.id
  const isTargetOwner = member.role === 'owner'

  const handleMessage = () => {
    onClose()
  }

  const handleKick = async () => {
    if (!selectedGCId || isTargetOwner || isSelf) return
    try {
      await fetch(`/api/gcs/${selectedGCId}/members/${member.user_id}`, { method: 'DELETE' })
    } catch {}
    onClose()
  }

  const handleBan = async () => {
    if (!selectedGCId || isTargetOwner || isSelf) return
    try {
      await fetch(`/api/gcs/${selectedGCId}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user_id }),
      })
    } catch {}
    onClose()
  }

  const handleTransfer = async () => {
    if (!selectedGCId || !isOwner) return
    try {
      await fetch(`/api/gcs/${selectedGCId}/transfer-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOwnerId: member.user_id }),
      })
    } catch {}
    onClose()
  }

  return (
    <div className="flex flex-col gap-1 p-1">
      <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={handleMessage}>
        <MessageSquareIcon className="size-4" />
        Message
      </Button>
      {canKick && !isSelf && !isTargetOwner && (
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-amber-400 hover:text-amber-300" onClick={handleKick}>
          <UserMinusIcon className="size-4" />
          Kick
        </Button>
      )}
      {canBan && !isSelf && !isTargetOwner && (
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-red-400 hover:text-red-300" onClick={handleBan}>
          <ShieldBanIcon className="size-4" />
          Ban
        </Button>
      )}
      {isOwner && !isSelf && !isTargetOwner && (
        <>
          <Separator className="my-1" />
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-amber-400 hover:text-amber-300" onClick={handleTransfer}>
            <CrownIcon className="size-4" />
            Transfer Ownership
          </Button>
        </>
      )}
    </div>
  )
}

// ─── Member row ─────────────────────────────────────────────────────────────

function MemberRow({ member }: { member: GCMember }) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5">
          <MemberAvatar user={member.user} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-zinc-100">
                {member.user?.display_name || 'Unknown'}
              </span>
              {member.role === 'owner' && (
                <CrownIcon className="size-3.5 shrink-0 text-amber-400" />
              )}
              {member.role === 'admin' && (
                <ShieldBanIcon className="size-3.5 shrink-0 text-emerald-400" />
              )}
            </div>
            {member.user?.custom_status && (
              <p className="truncate text-xs text-zinc-400">{member.user.custom_status}</p>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" side="left" align="start">
        <MemberActions member={member} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

// ─── Main MemberPanel ───────────────────────────────────────────────────────

export default function MemberPanel() {
  const isMobile = useIsMobile()
  const selectedGCId = useAppStore((s) => s.selectedGCId)
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)
  const userGCs = useAppStore((s) => s.userGCs)
  const gcMembers = useAppStore((s) => s.gcMembers)
  const voiceParticipants = useAppStore((s) => s.voiceParticipants)

  const gc = userGCs.find((g) => g.id === selectedGCId)
  const members = selectedGCId ? gcMembers[selectedGCId] || [] : []
  const voice = selectedGCId ? voiceParticipants[selectedGCId] || [] : []

  const { owners, admins, regularMembers } = useMemo(() => {
    const owners: GCMember[] = []
    const admins: GCMember[] = []
    const regularMembers: GCMember[] = []
    for (const m of members) {
      if (m.role === 'owner') owners.push(m)
      else if (m.role === 'admin') admins.push(m)
      else regularMembers.push(m)
    }
    return { owners, admins, regularMembers }
  }, [members])

  // Don't render on mobile or when no GC selected
  if (isMobile || !selectedGCId || !rightPanelOpen) return null

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l border-[#1f2023] bg-[#2f3136]">
      {/* GC Header */}
      <div className="px-3 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-zinc-100">{gc?.name || 'Group Chat'}</h2>
        <p className="text-xs text-zinc-400">{members.length} Members</p>
      </div>

      <Separator className="bg-[#1f2023]" />

      <ScrollArea className="flex-1">
        {/* Voice Participants */}
        {voice.length > 0 && (
          <div className="px-2 pt-3 pb-1">
            <div className="flex items-center gap-1.5 px-1">
              <Volume2Icon className="size-3.5 text-emerald-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Voice Connected — {voice.length}
              </span>
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
              {voice.map((v) => {
                const member = members.find((m) => m.user_id === v.user_id)
                return (
                  <div key={v.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                    <MemberAvatar user={v.user || member?.user} className="size-6 [&_svg]:size-6 [&>div]:size-6" />
                    <span className="truncate text-sm text-zinc-200">
                      {v.user?.display_name || member?.user?.display_name || 'Unknown'}
                    </span>
                    <Volume2Icon className="ml-auto size-3 text-emerald-400" />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Owners */}
        {owners.length > 0 && (
          <div className="px-2 pt-3">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Owner — {owners.length}
            </h3>
            <div className="mt-1 flex flex-col gap-0.5">
              {owners.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </div>
          </div>
        )}

        {/* Admins */}
        {admins.length > 0 && (
          <div className="px-2 pt-3">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Admins — {admins.length}
            </h3>
            <div className="mt-1 flex flex-col gap-0.5">
              {admins.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </div>
          </div>
        )}

        {/* Members */}
        {regularMembers.length > 0 && (
          <div className="px-2 pt-3 pb-4">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Members — {regularMembers.length}
            </h3>
            <div className="mt-1 flex flex-col gap-0.5">
              {regularMembers.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </aside>
  )
}