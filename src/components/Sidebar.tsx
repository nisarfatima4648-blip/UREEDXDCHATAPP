'use client'

import { useState, useCallback } from 'react'
import {
  Group,
  MessageCircle,
  Plus,
  Mic,
  MicOff,
  Headphones,
  Settings,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/UserAvatar'
import { useAppStore, type ActiveView } from '@/lib/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { changePresence } from '@/lib/socket'

// ─── Types ─────────────────────────────────────────────────────────────────

type SidebarTab = 'groups' | 'dms'

interface SidebarProps {
  onOpenProfileSettings?: () => void
  onCreateGC?: () => void
  onStartDM?: () => void
}

// ─── Fallback palette for GC avatars ──────────────────────────────────────

const GC_PALETTE = [
  'bg-emerald-600',
  'bg-teal-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-violet-600',
  'bg-cyan-600',
  'bg-orange-600',
  'bg-pink-600',
  'bg-lime-600',
  'bg-slate-600',
]

function getGCFallbackColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  return GC_PALETTE[Math.abs(hash) % GC_PALETTE.length]
}

// ─── Sidebar Content (shared between desktop and mobile) ───────────────────

function SidebarContent({
  onOpenProfileSettings,
  onCreateGC,
  onStartDM,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('groups')
  const [micMuted, setMicMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)

  // Hook at top level (not inside callbacks!)
  const isMobile = useIsMobile()

  // Store
  const currentUser = useAppStore((s) => s.currentUser)
  const selectedGCId = useAppStore((s) => s.selectedGCId)
  const selectedDMConversationId = useAppStore((s) => s.selectedDMConversationId)
  const userGCs = useAppStore((s) => s.userGCs)
  const dmConversations = useAppStore((s) => s.dmConversations)
  const onlineUsers = useAppStore((s) => s.onlineUsers)
  const activeView = useAppStore((s) => s.activeView)
  const unreadCounts = useAppStore((s) => s.unreadCounts)
  const mentionCounts = useAppStore((s) => s.mentionCounts)

  // Aggregate notification totals per tab so badges are visible no matter which tab is active
  const gcMentionTotal = userGCs.reduce((sum, gc) => sum + (mentionCounts[gc.id] || 0), 0)
  const gcUnreadTotal = userGCs.reduce((sum, gc) => sum + (unreadCounts[gc.id] || 0), 0)
  const dmMentionTotal = dmConversations.reduce((sum, c) => sum + (mentionCounts[c.id] || 0), 0)
  const dmUnreadTotal = dmConversations.reduce((sum, c) => sum + (unreadCounts[c.id] || 0), 0)

  const selectGC = useAppStore((s) => s.selectGC)
  const selectDM = useAppStore((s) => s.selectDM)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)

  const handleSelectGC = useCallback(
    (gcId: string) => {
      selectGC(gcId)
      if (isMobile) setSidebarOpen(false)
    },
    [selectGC, setSidebarOpen, isMobile]
  )

  const handleSelectDM = useCallback(
    (conversationId: string) => {
      selectDM(conversationId)
      if (isMobile) setSidebarOpen(false)
    },
    [selectDM, setSidebarOpen, isMobile]
  )

  const handleNavClick = useCallback(
    (view: ActiveView) => {
      setActiveView(view)
      if (isMobile) setSidebarOpen(false)
    },
    [setActiveView, setSidebarOpen, isMobile]
  )

  const changeStatus = useCallback(
    (status: 'online' | 'idle' | 'dnd' | 'invisible') => {
      if (!currentUser) return
      // Update local store immediately
      const updated = { ...currentUser, status }
      useAppStore.getState().setCurrentUser(updated)
      // Broadcast via socket for other users
      changePresence(status)
      // Also persist to DB via API
      fetch(`/api/users/${currentUser.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).catch(() => {})
    },
    [currentUser]
  )

  const handleCreateGC = useCallback(() => {
    onCreateGC?.()
    if (isMobile) setSidebarOpen(false)
  }, [onCreateGC, setSidebarOpen, isMobile])

  const handleStartDM = useCallback(() => {
    onStartDM?.()
    if (isMobile) setSidebarOpen(false)
  }, [onStartDM, setSidebarOpen, isMobile])

  const statusLabel: Record<string, string> = {
    online: 'Online',
    idle: 'Idle',
    dnd: 'Do Not Disturb',
    invisible: 'Invisible',
    offline: 'Offline',
}

  const isStatusActive = (status: string) => currentUser?.status === status

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* ─── Top: App Logo ──────────────────────────────────────────── */}
      <div className="flex h-12 items-center px-3">
        <div className="flex items-center gap-2">
          <img
            src="/ureedxd-logo.png"
            alt="UREEDXD"
            className="h-8 w-8 rounded-lg object-cover"
          />
          <span className="hidden text-base font-bold text-sidebar-foreground sm:block">
            UREEDXD
          </span>
        </div>
      </div>

      <Separator className="bg-sidebar-border" />

      {/* ─── Tab Buttons ───────────────────────────────────────────── */}
      <div className="flex gap-1 px-2 pt-2 pb-1">
        <Button
          variant={activeTab === 'groups' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('groups')}
          className={cn(
            'flex-1 text-xs font-medium transition-colors relative',
            activeTab === 'groups'
              ? 'bg-sidebar-accent text-sidebar-foreground'
              : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent'
          )}
        >
          <Group className="mr-1.5 h-3.5 w-3.5" />
          Groups
          {/* Per-tab badge so GC notifications are visible even when on DMs tab */}
          {gcMentionTotal > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
              {gcMentionTotal > 99 ? '99+' : gcMentionTotal}
            </span>
          ) : gcUnreadTotal > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground px-1 text-[10px] font-bold text-white leading-none">
              {gcUnreadTotal > 99 ? '99+' : gcUnreadTotal}
            </span>
          ) : null}
        </Button>
        <Button
          variant={activeTab === 'dms' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('dms')}
          className={cn(
            'flex-1 text-xs font-medium transition-colors relative',
            activeTab === 'dms'
              ? 'bg-sidebar-accent text-sidebar-foreground'
              : 'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent'
          )}
        >
          <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
          DMs
          {/* Per-tab badge so DM notifications are visible even when on Groups tab */}
          {dmMentionTotal > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
              {dmMentionTotal > 99 ? '99+' : dmMentionTotal}
            </span>
          ) : dmUnreadTotal > 0 ? (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground px-1 text-[10px] font-bold text-white leading-none">
              {dmUnreadTotal > 99 ? '99+' : dmUnreadTotal}
            </span>
          ) : null}
        </Button>
      </div>

      {/* ─── Tab Content ────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 px-2">
        {activeTab === 'groups' ? (
          <div className="flex flex-col gap-0.5 pb-4 pt-1">
            {/* Create GC button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCreateGC}
                  className="w-full justify-start gap-2 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <Plus className="h-4 w-4" />
                  <span className="text-sm">Create Group</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Create a new group chat</TooltipContent>
            </Tooltip>

            <Separator className="my-1.5 bg-sidebar-border" />

            {/* GC List */}
            {userGCs.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No group chats yet
              </p>
            )}

            {userGCs.map((gc) => {
              const isSelected = selectedGCId === gc.id
              const fallbackColor = getGCFallbackColor(gc.name)
              const mentions = mentionCounts[gc.id] || 0
              const unreads = unreadCounts[gc.id] || 0

              return (
                <Tooltip key={gc.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleSelectGC(gc.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-all',
                        isSelected
                          ? 'bg-emerald-600/20 text-sidebar-foreground'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      )}
                    >
                      {gc.icon_url ? (
                        <div className="relative shrink-0">
                          <img
                            src={gc.icon_url}
                            alt={gc.name}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                          {(mentions > 0) && (
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                              {mentions > 99 ? '99+' : mentions}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="relative shrink-0">
                          <div
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white',
                              fallbackColor
                            )}
                          >
                            {gc.name.charAt(0).toUpperCase()}
                          </div>
                          {(mentions > 0) && (
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                              {mentions > 99 ? '99+' : mentions}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'truncate text-sm font-medium',
                            isSelected ? 'text-emerald-300' : ''
                          )}
                        >
                          {gc.name}
                        </p>
                      </div>
                      {unreads > 0 && mentions === 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted-foreground px-1.5 text-[10px] font-bold text-white leading-none">
                          {unreads > 99 ? '99+' : unreads}
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{gc.name}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 pb-4 pt-1">
            {/* New DM button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStartDM}
                  className="w-full justify-start gap-2 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
                >
                  <Search className="h-4 w-4" />
                  <span className="text-sm">New Message</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Find or start a conversation</TooltipContent>
            </Tooltip>

            <Separator className="my-1.5 bg-sidebar-border" />

            {/* DM List */}
            {dmConversations.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No conversations yet
              </p>
            )}

            {dmConversations.map((conv) => {
              const otherUser = conv.other_user
              const isSelected = selectedDMConversationId === conv.id
              const isOnline = otherUser
                ? onlineUsers.includes(otherUser.id)
                : false
              const mentions = mentionCounts[conv.id] || 0
              const unreads = unreadCounts[conv.id] || 0

              return (
                <Tooltip key={conv.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleSelectDM(conv.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-all',
                        isSelected
                          ? 'bg-emerald-600/20 text-sidebar-foreground'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      )}
                    >
                      <div className="relative shrink-0">
                        <UserAvatar
                          user={
                            otherUser
                              ? {
                                  ...otherUser,
                                  status: isOnline ? 'online' : 'offline',
                                }
                              : null
                          }
                          size="sm"
                          showStatus
                        />
                        {(mentions > 0) && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                            {mentions > 99 ? '99+' : mentions}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'truncate text-sm font-medium',
                            isSelected ? 'text-emerald-300' : ''
                          )}
                        >
                          {otherUser?.display_name || otherUser?.username || 'Unknown'}
                        </p>
                      </div>
                      {unreads > 0 && mentions === 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted-foreground px-1.5 text-[10px] font-bold text-white leading-none">
                          {unreads > 99 ? '99+' : unreads}
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {otherUser?.display_name || otherUser?.username || 'Unknown'}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* ─── Bottom User Panel ──────────────────────────────────────── */}
      <Separator className="bg-sidebar-border" />
      <div className="flex items-center gap-1.5 p-2">
        {/* Settings Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenProfileSettings?.()}
              className={cn(
                'h-8 w-8 shrink-0',
                'text-muted-foreground hover:text-sidebar-foreground'
              )}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">User Settings</TooltipContent>
        </Tooltip>

        {/* Mic */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setMicMuted(!micMuted)
                if (deafened) setDeafened(false)
              }}
              className={cn(
                'h-8 w-8 shrink-0',
                micMuted ? 'text-rose-400 hover:text-rose-300' : 'text-muted-foreground hover:text-sidebar-foreground'
              )}
            >
              {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {micMuted ? 'Unmute' : 'Mute'}
          </TooltipContent>
        </Tooltip>

        {/* Headphones */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setDeafened(!deafened)
                if (deafened) setMicMuted(false)
              }}
              className={cn(
                'h-8 w-8 shrink-0',
                deafened
                  ? 'text-rose-400 hover:text-rose-300'
                  : 'text-muted-foreground hover:text-sidebar-foreground'
              )}
            >
              <Headphones className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {deafened ? 'Undeafen' : 'Deafen'}
          </TooltipContent>
        </Tooltip>

        {/* User Info */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-sidebar-accent">
              <UserAvatar user={currentUser} size="sm" showStatus />
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-sidebar-foreground">
                  {currentUser?.display_name || currentUser?.username || 'User'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {currentUser?.status ? (statusLabel[currentUser.status] || currentUser.status) : 'Offline'}
                </p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-48 bg-popover border-border text-popover-foreground"
          >
            <DropdownMenuItem
              onClick={() => changeStatus('online')}
              className={cn(
                'cursor-pointer gap-2',
                isStatusActive('online') && 'text-emerald-400'
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Online
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => changeStatus('idle')}
              className={cn(
                'cursor-pointer gap-2',
                isStatusActive('idle') && 'text-amber-400'
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              Idle
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => changeStatus('dnd')}
              className={cn(
                'cursor-pointer gap-2',
                isStatusActive('dnd') && 'text-rose-400'
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              Do Not Disturb
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => changeStatus('invisible')}
              className={cn(
                'cursor-pointer gap-2',
                isStatusActive('invisible') && 'text-muted-foreground'
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />
              Invisible
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => onOpenProfileSettings?.()}
              className="cursor-pointer gap-2"
            >
              <Settings className="h-3.5 w-3.5" />
              Profile Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ─── Main Sidebar (Desktop + Mobile) ───────────────────────────────────────

export function Sidebar(props: SidebarProps) {
  const isMobile = useIsMobile()
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)

  // Mobile: render as Sheet overlay
  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-sidebar border-r-border"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarContent {...props} />
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop: fixed sidebar
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border">
      <SidebarContent {...props} />
    </aside>
  )
}