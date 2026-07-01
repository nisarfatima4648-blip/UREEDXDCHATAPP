'use client'

import React, { useState, useEffect, useCallback, useRef, memo } from 'react'
import dynamic from 'next/dynamic'
import { useAppStore } from '@/lib/store'
import {
  connectSocket,
  disconnectSocket,
  onSocketEvent,
  offSocketEvent,
} from '@/lib/socket'
import { LoginView } from '@/components/LoginView'
import { Sidebar } from '@/components/Sidebar'
import { ChatView } from '@/components/ChatView'
import MemberPanel from '@/components/MemberPanel'
import { Menu, Moon, Sun, X, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from 'next-themes'
import { useIsMobile } from '@/hooks/use-mobile'
import { playNotificationSound } from '@/lib/notification-sound'
import { toast } from 'sonner'

// ─── Lazy-loaded components (don't block initial paint) ──────────────────
const FriendsView = dynamic(() => import('@/components/FriendsView').then(m => ({ default: m.FriendsView })), { ssr: false })
const CreateGCDialog = dynamic(() => import('@/components/CreateGCDialog').then(m => ({ default: m.CreateGCDialog })), { ssr: false })
const StartDMDialog = dynamic(() => import('@/components/StartDMDialog').then(m => ({ default: m.StartDMDialog })), { ssr: false })
const GCSettingsDialog = dynamic(() => import('@/components/GCSettingsDialog'), { ssr: false })
const ProfileDialog = dynamic(() => import('@/components/ProfileDialog'), { ssr: false })
const AddMemberDialog = dynamic(() => import('@/components/AddMemberDialog'), { ssr: false })
const DMCallUI = dynamic(() => import('@/components/DMCallUI').then(m => ({ default: m.DMCallUI })), { ssr: false })

// ─── Main Application Page ─────────────────────────────────────────────────

export default function AppPage() {
  // ─── Selectors (only re-render when these specific values change) ───────
  const isAuthenticated = useAppStore((s) => s.isAuthenticated)
  const currentUser = useAppStore((s) => s.currentUser)
  const activeView = useAppStore((s) => s.activeView)
  const selectedGCId = useAppStore((s) => s.selectedGCId)
  const selectedDMConversationId = useAppStore((s) => s.selectedDMConversationId)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)
  const userGCs = useAppStore((s) => s.userGCs)

  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const [mounted, setMounted] = useState(false)
  const initializedRef = useRef(false)

  // Dialog states
  const [createGCOpen, setCreateGCOpen] = useState(false)
  const [startDMOpen, setStartDMOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [gcSettingsOpen, setGCSettingsOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)

  // ─── Track mobile state (use getState to avoid dependency on store) ────
  useEffect(() => {
    const { setIsMobile, setSidebarOpen } = useAppStore.getState()
    setIsMobile(isMobile)
    if (!isMobile) {
      setSidebarOpen(false)
    }
  }, [isMobile])

  // ─── Hydration ──────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true)
  }, [])

  // ─── Initialize data after auth ─────────────────────────────────────────
  const initializeData = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`/api/init?userId=${userId}`)
      if (res.ok) {
        const { gcs, dms, friends, requests, gcEmojis } = await res.json()
        const { setUserGCs, setDMConversations, setFriends, setPendingRequests, setCustomEmojis } = useAppStore.getState()
        if (gcs) setUserGCs(gcs)
        if (dms) setDMConversations(dms)
        if (friends) setFriends(friends)
        if (requests) setPendingRequests(requests)
        // Load all GC emojis so they're available in DMs too
        if (gcEmojis && typeof gcEmojis === 'object') {
          for (const [gcId, emojis] of Object.entries(gcEmojis)) {
            if (Array.isArray(emojis) && emojis.length > 0) {
              setCustomEmojis(gcId, emojis)
            }
          }
        }
      }
    } catch (err) {
    }
  }, [])

  // ─── Socket event listeners ─────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return

    const userId = currentUser.id
    connectSocket(userId)
    initializeData(userId)

    // All handlers use getState() to avoid stale closures and infinite loops
    const onNewMessage = (msg: any) => {
      // Normalize server camelCase → client snake_case
      const normalized = {
        id: msg.id,
        gc_id: msg.gcId ?? msg.gc_id ?? null,
        dm_conversation_id: msg.dmConversationId ?? msg.dm_conversation_id ?? null,
        sender_id: msg.senderId ?? msg.sender?.id ?? null,
        content: msg.content,
        type: msg.type ?? 'text',
        attachment_url: msg.attachmentUrl ?? msg.attachment_url ?? null,
        reply_to_id: msg.replyToId ?? msg.reply_to_id ?? null,
        created_at: msg.createdAt ?? msg.created_at ?? new Date().toISOString(),
        sender: msg.sender ? {
          id: msg.sender.id,
          username: msg.sender.username,
          display_name: msg.sender.displayName ?? msg.sender.display_name,
          avatar_url: msg.sender.avatarUrl ?? msg.sender.avatar_url,
        } : null,
      }

      // ─── Notification logic ──────────────────────────────────────────
      const channelId = normalized.gc_id || normalized.dm_conversation_id
      if (channelId) {
        const s = useAppStore.getState()
        const isOwnMessage = normalized.sender_id === s.currentUser?.id
        const isCurrentlyViewing =
          (normalized.gc_id && s.selectedGCId === normalized.gc_id) ||
          (normalized.dm_conversation_id && s.selectedDMConversationId === normalized.dm_conversation_id)

        if (!isOwnMessage && !isCurrentlyViewing) {
          // Check if this message mentions the current user
          const myUsername = s.currentUser?.username || ''
          const myDisplayName = s.currentUser?.display_name || ''
          const content = (normalized.content || '').toLowerCase()
          const isMentionByText =
            content.includes(`@${myUsername.toLowerCase()}`) ||
            content.includes(`@${myDisplayName.toLowerCase()}`)

          // Check if this message is a REPLY to one of the current user's messages.
          // Look up the replied-to message in the store (gcMessages / dmMessages)
          // and verify its sender is the current user.
          let isReplyToMe = false
          if (normalized.reply_to_id) {
            const storeMsgs =
              (normalized.gc_id && s.gcMessages[normalized.gc_id]) ||
              (normalized.dm_conversation_id && s.dmMessages[normalized.dm_conversation_id]) ||
              []
            const repliedMsg = storeMsgs.find((m) => m.id === normalized.reply_to_id)
            if (repliedMsg && repliedMsg.sender_id === s.currentUser?.id) {
              isReplyToMe = true
            }
          }

          const isMention = isMentionByText || isReplyToMe

          if (isMention) {
            s.incrementMention(channelId)
          } else {
            s.incrementUnread(channelId)
          }
          playNotificationSound()

          // ─── Toast notification ───────────────────────────────────
          const senderName = normalized.sender?.display_name || normalized.sender?.username || 'Someone'
          // Determine the channel name so the user knows WHERE the message came from
          let channelLabel = 'Direct Message'
          if (normalized.gc_id) {
            const gc = s.userGCs.find((g) => g.id === normalized.gc_id)
            channelLabel = gc?.name || 'Group Chat'
          } else if (normalized.dm_conversation_id) {
            const dm = s.dmConversations.find((c) => c.id === normalized.dm_conversation_id)
            const otherName = dm?.other_user?.display_name || dm?.other_user?.username
            channelLabel = otherName ? `DM · ${otherName}` : 'Direct Message'
          }
          const preview = (normalized.content || '').length > 100
            ? (normalized.content || '').slice(0, 100) + '…'
            : (normalized.content || '')
          toast.info(`${senderName} · ${channelLabel}`, {
            description: isMentionByText ? `@you — ${preview}` : preview,
            duration: 3000,
          })
        }
      }

      useAppStore.getState().addMessage(normalized)
    }

    const onTyping = (data: { channelId: string; userId: string; isTyping: boolean }) => {
      const s = useAppStore.getState()
      if (data.isTyping) s.addTypingUser(data.channelId, data.userId)
      else s.removeTypingUser(data.channelId, data.userId)
    }

    const onPresenceUpdate = (data: { userId: string; status: string }) => {
      const s = useAppStore.getState()
      if (data.status === 'online') s.addUserOnline(data.userId)
      else s.removeUserOnline(data.userId)
    }

    const onVCJoin = (data: any) => {
      // Server sends flat: { userId, username, displayName, avatarUrl, gcId, timestamp }
      // Build a VoiceSession-like object
      const session = {
        id: `vc-${data.userId}-${Date.now()}`,
        gc_id: data.gcId,
        user_id: data.userId,
        joined_at: data.timestamp || new Date().toISOString(),
        user: {
          id: data.userId,
          username: data.username,
          display_name: data.displayName,
          avatar_url: data.avatarUrl,
        },
      }
      useAppStore.getState().addVoiceParticipant(data.gcId, session)
    }

    const onVCLeave = (data: { gcId: string; userId: string }) =>
      useAppStore.getState().removeVoiceParticipant(data.gcId, data.userId)

    const onVCParticipants = (data: any) => {
      const sessions = (data.participants || []).map((p: any) => ({
        id: `vc-${p.user_id || p.userId}-${Date.now()}`,
        gc_id: data.gcId,
        user_id: p.user_id || p.userId,
        joined_at: p.joined_at || p.joinedAt || new Date().toISOString(),
        user: {
          id: p.user_id || p.userId || p.user?.id,
          username: p.user?.username || p.username,
          display_name: p.user?.display_name || p.displayName,
          avatar_url: p.user?.avatar_url || p.avatarUrl,
        },
      }))
      useAppStore.getState().setVoiceParticipants(data.gcId, sessions)
    }

    const onMemberAdded = (data: any) => {
      // Server sends flat: { gcId, userId, role, user, gc, timestamp }
      // Build a GCMember-like object with snake_case fields
      const member = {
        gc_id: data.gcId,
        user_id: data.userId,
        role: data.role || 'member',
        user: data.user ? {
          id: data.user.id,
          username: data.user.username,
          display_name: data.user.displayName ?? data.user.display_name,
          avatar_url: data.user.avatarUrl ?? data.user.avatar_url,
          status: data.user.status || 'offline',
        } : null,
        joined_at: data.timestamp || new Date().toISOString(),
      }
      useAppStore.getState().addGCMember(data.gcId, member)

      // If the added member is the current user AND we got GC data, add GC to sidebar
      const state = useAppStore.getState()
      if (data.userId === state.currentUser?.id && data.gc) {
        // Check if we already have this GC (avoid duplicates)
        if (!state.userGCs.some(g => g.id === data.gcId)) {
          useAppStore.getState().addGC(data.gc)
        }
        // Also load existing members for this GC
        fetch(`/api/gcs/${data.gcId}/members`).then(r => {
          if (r.ok) r.json().then(members => {
            useAppStore.getState().setGCMembers(data.gcId, members)
          })
        }).catch(() => {})
      }
    }

    const onMemberRemoved = (data: { gcId: string; userId: string }) =>
      useAppStore.getState().removeGCMember(data.gcId, data.userId)

    const onDMConversationNew = (data: any) => {
      // Another user started a DM with us — add it to our DM list in real-time
      const s = useAppStore.getState()
      if (!s.currentUser) return
      // Don't add if we already have this conversation
      if (s.dmConversations.some(c => c.id === data.id)) return
      // Build the conversation object the store expects
      const otherUserId = data.user1_id === s.currentUser.id ? data.user2_id : data.user1_id
      useAppStore.getState().addDMConversation({
        id: data.id,
        user1_id: data.user1_id,
        user2_id: data.user2_id,
        other_user: data.other_user ? {
          id: data.other_user.id,
          username: data.other_user.username,
          display_name: data.other_user.displayName ?? data.other_user.display_name,
          avatar_url: data.other_user.avatarUrl ?? data.other_user.avatar_url,
          status: data.other_user.status || 'offline',
        } : null,
        created_at: data.timestamp,
        updated_at: data.timestamp,
        last_message_at: null,
      })
    }

    const onMemberBanned = (data: { gcId: string; userId: string }) =>
      useAppStore.getState().removeGCMember(data.gcId, data.userId)

    const onGCUpdated = (data: any) =>
      useAppStore.getState().updateGC(data.id, data)

    const onFriendRequestReceived = (data: any) => {
      const s = useAppStore.getState()
      s.setPendingRequests([...s.pendingFriendRequests, data])
    }

    const onFriendAccepted = (data: any) => {
      const s = useAppStore.getState()
      s.addFriend(data.friend)
      s.setPendingRequests(s.pendingFriendRequests.filter((r: any) => r.id !== data.requestId))
    }

    const onFriendDeclined = (data: any) => {
      const s = useAppStore.getState()
      s.setPendingRequests(s.pendingFriendRequests.filter((r: any) => r.id !== data.requestId))
    }

    const onEmojiAdded = (data: any) => {
      // Server sends a flat object: { id, gcId, name, imageUrl, uploadedBy, createdAt, timestamp }
      const normalized = {
        id: data.id,
        name: data.name,
        image_url: data.imageUrl ?? data.image_url,
        uploaded_by: data.uploadedBy ?? data.uploaded_by,
        gc_id: data.gcId ?? data.gc_id,
        created_at: data.createdAt ?? data.created_at,
      }
      useAppStore.getState().addCustomEmoji(data.gcId, normalized)
    }

    const onEmojiRemoved = (data: { emojiId: string; gcId: string }) =>
      useAppStore.getState().removeCustomEmoji(data.emojiId)

    const onUserProfileUpdate = (data: any) => {
      if (data.userId === useAppStore.getState().currentUser?.id) return // skip self
      const updateData: any = {}
      if (data.displayName) updateData.display_name = data.displayName
      if (data.bio !== undefined) updateData.bio = data.bio
      if (data.customStatus !== undefined) updateData.custom_status = data.customStatus
      if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl
      if (data.bannerUrl !== undefined) updateData.banner_url = data.bannerUrl
      useAppStore.getState().updateRemoteUser(data.userId, updateData)
    }

    const onAuthSuccess = (data: any) => {
      if (data.onlineUsers) useAppStore.getState().setOnlineUsers(data.onlineUsers)
    }

    const onCallIncoming = (data: any) => {
      useAppStore.getState().setIncomingCall({
        dmConversationId: data.dmConversationId,
        callerId: data.callerId,
        callerName: data.callerName,
        callerAvatar: data.callerAvatar,
      })
    }

    const onCallConnected = (data: any) => {
      const s = useAppStore.getState()
      // Preserve isCaller: the original caller already has isCaller=true in their activeCall
      // The callee doesn't have activeCall set yet (or has it from handleAccept without isCaller)
      const existingCall = s.activeCall
      s.setActiveCall({
        dmConversationId: data.dmConversationId,
        callerId: data.otherUserId,
        callerName: data.otherName,
        callerAvatar: data.otherAvatar,
        status: 'connected',
        startedAt: data.startedAt,
        isCaller: existingCall?.isCaller ?? false,
      })
      s.setIncomingCall(null)
    }

    const onCallEnded = (data: any) => {
      const s = useAppStore.getState()
      s.setActiveCall(null)
      s.setIncomingCall(null)
      s.setCallMuted(false)
      s.setCallDeafened(false)
    }

    const onMessageDeleted = (data: any) => {
      const channelId = data.gcId || data.dmConversationId
      if (channelId) {
        const s = useAppStore.getState()
        const msgs = s.gcMessages[channelId] || s.dmMessages[channelId] || []
        // Skip if already removed locally (avoids unnecessary re-render)
        if (!msgs.some((m) => m.id === data.messageId)) return
        s.removeMessage(data.messageId, channelId)
      }
    }

    const onMessageEdited = (data: any) => {
      const channelId = data.gcId || data.dmConversationId
      if (channelId) {
        const s = useAppStore.getState()
        const msgs = s.gcMessages[channelId] || s.dmMessages[channelId] || []
        const existing = msgs.find((m) => m.id === data.messageId)
        // Skip if already updated locally (avoids double re-render / black flash)
        if (existing && existing.content === data.newContent && existing.edited_at) return
        s.updateMessageContent(data.messageId, channelId, data.newContent, data.editedAt)
      }
    }

    // Register all listeners
    onSocketEvent('message:new', onNewMessage)
    onSocketEvent('message:typing', onTyping)
    onSocketEvent('presence:update', onPresenceUpdate)
    onSocketEvent('vc:user-joined', onVCJoin)
    onSocketEvent('vc:user-left', onVCLeave)
    onSocketEvent('vc:participants', onVCParticipants)
    onSocketEvent('gc:member:added', onMemberAdded)
    onSocketEvent('gc:member:removed', onMemberRemoved)
    onSocketEvent('gc:member:banned', onMemberBanned)
    onSocketEvent('gc:updated', onGCUpdated)
    onSocketEvent('dm:conversation:new', onDMConversationNew)
    onSocketEvent('friend:request:received', onFriendRequestReceived)
    onSocketEvent('friend:accepted', onFriendAccepted)
    onSocketEvent('friend:declined', onFriendDeclined)
    onSocketEvent('emoji:added', onEmojiAdded)
    onSocketEvent('emoji:removed', onEmojiRemoved)
    onSocketEvent('auth:success', onAuthSuccess)
    onSocketEvent('dm:call:incoming', onCallIncoming)
    onSocketEvent('dm:call:connected', onCallConnected)
    onSocketEvent('dm:call:ended', onCallEnded)
    onSocketEvent('message:deleted', onMessageDeleted)
    onSocketEvent('message:edited', onMessageEdited)
    onSocketEvent('user:profile:update', onUserProfileUpdate)

    return () => {
      offSocketEvent('message:new', onNewMessage)
      offSocketEvent('message:typing', onTyping)
      offSocketEvent('presence:update', onPresenceUpdate)
      offSocketEvent('vc:user-joined', onVCJoin)
      offSocketEvent('vc:user-left', onVCLeave)
      offSocketEvent('vc:participants', onVCParticipants)
      offSocketEvent('gc:member:added', onMemberAdded)
      offSocketEvent('gc:member:removed', onMemberRemoved)
      offSocketEvent('gc:member:banned', onMemberBanned)
      offSocketEvent('gc:updated', onGCUpdated)
      offSocketEvent('dm:conversation:new', onDMConversationNew)
      offSocketEvent('friend:request:received', onFriendRequestReceived)
      offSocketEvent('friend:accepted', onFriendAccepted)
      offSocketEvent('friend:declined', onFriendDeclined)
      offSocketEvent('emoji:added', onEmojiAdded)
      offSocketEvent('emoji:removed', onEmojiRemoved)
      offSocketEvent('auth:success', onAuthSuccess)
      offSocketEvent('dm:call:incoming', onCallIncoming)
      offSocketEvent('dm:call:connected', onCallConnected)
      offSocketEvent('dm:call:ended', onCallEnded)
      offSocketEvent('message:deleted', onMessageDeleted)
      offSocketEvent('message:edited', onMessageEdited)
      offSocketEvent('user:profile:update', onUserProfileUpdate)
    }
  }, [currentUser?.id, initializeData])

  // ─── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => { disconnectSocket() }
  }, [])

  // ─── Handle GC settings view — just open the dialog, no activeView change needed
  // Sidebar now calls onOpenGCSettings prop directly, avoiding the 2-step flash

  // ─── Stable action helpers (never change between renders) ──────────────
  const openGCSettings = useCallback(() => setGCSettingsOpen(true), [])
  const openAddMember = useCallback(() => setAddMemberOpen(true), [])
  const toggleSidebar = useCallback(() => useAppStore.getState().toggleSidebar(), [])
  const toggleRightPanel = useCallback(() => useAppStore.getState().toggleRightPanel(), [])
  const setSidebarOpen = useCallback((v: boolean) => useAppStore.getState().setSidebarOpen(v), [])
  const setRPOpen = useCallback((v: boolean) => useAppStore.getState().setRightPanelOpen(v), [])

  // ─── Auth guard ─────────────────────────────────────────────────────────
  if (!isAuthenticated || !currentUser) {
    return <LoginView />
  }

  // ─── Derived values ────────────────────────────────────────────────────
  const showChat = activeView === 'chat' && (selectedGCId || selectedDMConversationId)
  const showWelcome = activeView === 'chat' && !selectedGCId && !selectedDMConversationId
  const showFriends = activeView === 'friends'

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* ── Mobile Header Bar ─────────────────────────────────────────────── */}
      {isMobile && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center h-12 px-3 bg-discord-darkest border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex-1 text-center">
            <span className="font-semibold text-sm text-foreground">
              {selectedGCId
                ? userGCs.find((g) => g.id === selectedGCId)?.name || 'UREEDXD'
                : selectedDMConversationId
                  ? 'Direct Message'
                  : 'UREEDXD'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {selectedGCId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={toggleRightPanel}
              >
                <Users className="h-5 w-5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {mounted && (theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              ))}
            </Button>
          </div>
        </div>
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <MemoizedSidebar
        onOpenProfileSettings={() => setProfileOpen(true)}
        onCreateGC={() => setCreateGCOpen(true)}
        onStartDM={() => setStartDMOpen(true)}
      />

      {/* ── Main Content Area ─────────────────────────────────────────────── */}
      <main className={`flex-1 flex flex-col min-w-0 ${isMobile ? 'pt-12' : ''}`}>
        {showChat && <MemoizedChatView onOpenGCSettings={openGCSettings} onAddMember={openAddMember} />}

        {showWelcome && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">Welcome to UREEDXD!</h1>
            <p className="text-muted-foreground text-center max-w-md">
              Select a group chat or start a direct message to begin chatting.
              Create a new group or find friends to get started.
            </p>
            <div className="flex gap-3 mt-2">
              <Button onClick={() => setCreateGCOpen(true)} className="gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
                Create Group
              </Button>
              <Button variant="outline" onClick={() => setStartDMOpen(true)} className="gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                New Message
              </Button>
            </div>
          </div>
        )}

        {showFriends && <MemoizedFriendsView />}
      </main>

      {/* ── Right Panel: Members (desktop only) ──────────────────────────── */}
      {!isMobile && selectedGCId && (
        <div className={`
          w-60 border-l border-border bg-card flex-shrink-0
          transition-all duration-200
          ${rightPanelOpen ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 absolute'}
          lg:translate-x-0 lg:opacity-100
        `}>
          <MemoizedMemberPanel />
        </div>
      )}

      {/* ── Mobile Member Panel (overlay) ────────────────────────────────── */}
      {isMobile && selectedGCId && rightPanelOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setRPOpen(false)}
        >
          <div
            className="absolute right-0 top-12 bottom-0 w-72 bg-card border-l border-border overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="font-semibold text-sm">Members</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRPOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <MemoizedMemberPanel />
          </div>
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <CreateGCDialog open={createGCOpen} onOpenChange={setCreateGCOpen} />
      <StartDMDialog open={startDMOpen} onOpenChange={setStartDMOpen} />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} userId={currentUser.id} />

      {/* ── DM Call UI (overlays) ──────────────────────────────────────── */}
      <DMCallUI />

      {selectedGCId && (
        <>
          <GCSettingsDialog open={gcSettingsOpen} onOpenChange={setGCSettingsOpen} gcId={selectedGCId} />
          <AddMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} gcId={selectedGCId} />
        </>
      )}
    </div>
  )
}

// ─── Memoized wrappers to prevent cascading re-renders ────────────────────────

const MemoizedSidebar = memo(Sidebar)
const MemoizedChatView = memo(ChatView)
const MemoizedMemberPanel = memo(MemberPanel)
const MemoizedFriendsView = memo(FriendsView)