import { create } from 'zustand'
import type {
  User,
  GroupChat,
  GCMember,
  Message,
  DMConversation,
  FriendRequest,
  CustomEmoji,
  VoiceSession,
} from '@/lib/database'
import type { CustomTheme } from '@/lib/themes'

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActiveView = 'chat' | 'friends' | 'settings' | 'gc-settings'

export interface CallState {
  dmConversationId: string
  callerId: string
  callerName: string
  callerAvatar: string | null
  status: 'ringing' | 'connected' | 'ended'
  startedAt?: string
  isCaller?: boolean
}

interface AppState {
  // Auth
  currentUser: User | null
  isAuthenticated: boolean

  // UI State
  activeView: ActiveView
  selectedGCId: string | null
  selectedDMConversationId: string | null
  sidebarOpen: boolean
  rightPanelOpen: boolean
  replyTo: Message | null
  isMobile: boolean

  // Call State
  activeCall: CallState | null
  incomingCall: {
    dmConversationId: string
    callerId: string
    callerName: string
    callerAvatar: string | null
  } | null
  isCallMuted: boolean
  isCallDeafened: boolean

  // Theme
  activeThemeId: string
  customTheme: CustomTheme | null

  // Data
  userGCs: GroupChat[]
  gcMembers: Record<string, GCMember[]>
  gcMessages: Record<string, Message[]>
  dmConversations: DMConversation[]
  dmMessages: Record<string, Message[]>
  friends: User[]
  pendingFriendRequests: FriendRequest[]
  onlineUsers: string[]
  typingUsers: Record<string, string[]>
  voiceParticipants: Record<string, VoiceSession[]>
  customEmojis: Record<string, CustomEmoji[]>

  // Notifications
  unreadCounts: Record<string, number>       // channelId → count
  mentionCounts: Record<string, number>       // channelId → count

  // ─── Auth Actions ───────────────────────────────────────────────────────
  setCurrentUser: (user: User | null) => void

  // ─── UI Actions ─────────────────────────────────────────────────────────
  setActiveView: (view: ActiveView) => void
  selectGC: (gcId: string | null) => void
  selectDM: (conversationId: string | null) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleRightPanel: () => void
  setRightPanelOpen: (open: boolean) => void
  setReplyTo: (message: Message | null) => void
  setIsMobile: (isMobile: boolean) => void

  // ─── Theme Actions ─────────────────────────────────────────────────────
  setActiveThemeId: (id: string) => void
  setCustomTheme: (theme: CustomTheme | null) => void

  // ─── GC Actions ─────────────────────────────────────────────────────────
  setUserGCs: (gcs: GroupChat[]) => void
  addGC: (gc: GroupChat) => void
  removeGC: (gcId: string) => void
  updateGC: (gcId: string, data: Partial<GroupChat>) => void

  // ─── GC Member Actions ──────────────────────────────────────────────────
  setGCMembers: (gcId: string, members: GCMember[]) => void
  addGCMember: (gcId: string, member: GCMember) => void
  removeGCMember: (gcId: string, userId: string) => void

  // ─── Message Actions ────────────────────────────────────────────────────
  addMessage: (message: Message) => void
  removeMessage: (messageId: string, channelId: string) => void
  updateMessageContent: (messageId: string, channelId: string, newContent: string, editedAt: string) => void
  setGCMessages: (gcId: string, messages: Message[]) => void
  setDMMessages: (conversationId: string, messages: Message[]) => void
  appendMessages: (key: string, messages: Message[]) => void
  prependMessages: (key: string, messages: Message[]) => void

  // ─── DM Actions ─────────────────────────────────────────────────────────
  setDMConversations: (conversations: DMConversation[]) => void
  addDMConversation: (conversation: DMConversation) => void
  updateDMConversation: (conversationId: string, data: Partial<DMConversation>) => void

  // ─── Friend Actions ─────────────────────────────────────────────────────
  setFriends: (friends: User[]) => void
  addFriend: (friend: User) => void
  removeFriend: (userId: string) => void
  updateRemoteUser: (userId: string, data: Partial<User>) => void
  setPendingRequests: (requests: FriendRequest[]) => void
  addPendingRequest: (request: FriendRequest) => void
  updatePendingRequest: (requestId: string, status: 'accepted' | 'declined') => void

  // ─── Online Users Actions ───────────────────────────────────────────────
  setOnlineUsers: (userIds: string[]) => void
  addUserOnline: (userId: string) => void
  removeUserOnline: (userId: string) => void

  // ─── Typing Actions ─────────────────────────────────────────────────────
  setTypingUsers: (channelId: string, userIds: string[]) => void
  addTypingUser: (channelId: string, userId: string) => void
  removeTypingUser: (channelId: string, userId: string) => void

  // ─── Voice Actions ──────────────────────────────────────────────────────
  setVoiceParticipants: (gcId: string, participants: VoiceSession[]) => void
  addVoiceParticipant: (gcId: string, session: VoiceSession) => void
  removeVoiceParticipant: (gcId: string, userId: string) => void

  // ─── Custom Emoji Actions ───────────────────────────────────────────────
  setCustomEmojis: (gcId: string, emojis: CustomEmoji[]) => void
  addCustomEmoji: (gcId: string, emoji: CustomEmoji) => void
  removeCustomEmoji: (emojiId: string) => void

  // ─── Call Actions ───────────────────────────────────────────────────────
  setActiveCall: (call: CallState | null) => void
  setIncomingCall: (call: { dmConversationId: string; callerId: string; callerName: string; callerAvatar: string | null } | null) => void
  setCallMuted: (muted: boolean) => void
  setCallDeafened: (deafened: boolean) => void

  // ─── Notification Actions ───────────────────────────────────────────
  incrementUnread: (channelId: string) => void
  incrementMention: (channelId: string) => void
  clearUnread: (channelId: string) => void
  clearMention: (channelId: string) => void

  // ─── Reset ──────────────────────────────────────────────────────────────
  reset: () => void
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState = {
  currentUser: null,
  isAuthenticated: false,
  activeView: 'chat' as ActiveView,
  selectedGCId: null,
  selectedDMConversationId: null,
  sidebarOpen: false,
  rightPanelOpen: false,
  replyTo: null,
  isMobile: false,
  userGCs: [],
  gcMembers: {},
  gcMessages: {},
  dmConversations: [],
  dmMessages: {},
  friends: [],
  pendingFriendRequests: [],
  onlineUsers: [] as string[],
  typingUsers: {},
  voiceParticipants: {},
  customEmojis: {},
  activeCall: null,
  incomingCall: null,
  isCallMuted: false,
  isCallDeafened: false,
  activeThemeId: 'midnight',
  customTheme: null,
  unreadCounts: {},
  mentionCounts: {},
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => ({
  ...initialState,

  // ─── Auth Actions ───────────────────────────────────────────────────────

  setCurrentUser: (user) =>
    set({
      currentUser: user,
      isAuthenticated: !!user,
    }),

  // ─── UI Actions ─────────────────────────────────────────────────────────

  setActiveView: (view) => set({ activeView: view }),

  selectGC: (gcId) =>
    set((s) => ({
      selectedGCId: gcId,
      selectedDMConversationId: null,
      activeView: 'chat',
      rightPanelOpen: false,
      replyTo: null,
      unreadCounts: { ...s.unreadCounts, [gcId]: 0 },
      mentionCounts: { ...s.mentionCounts, [gcId]: 0 },
    })),

  selectDM: (conversationId) =>
    set((s) => ({
      selectedDMConversationId: conversationId,
      selectedGCId: null,
      activeView: 'chat',
      rightPanelOpen: false,
      replyTo: null,
      unreadCounts: { ...s.unreadCounts, [conversationId]: 0 },
      mentionCounts: { ...s.mentionCounts, [conversationId]: 0 },
    })),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  setReplyTo: (message) => set({ replyTo: message }),
  setIsMobile: (isMobile) => set({ isMobile }),

  // ─── Theme Actions ─────────────────────────────────────────────────────

  setActiveThemeId: (id) => {
    set({ activeThemeId: id })
    if (typeof window !== 'undefined') {
      localStorage.setItem('discord-theme-id', id)
    }
  },

  setCustomTheme: (theme) => {
    set({ customTheme: theme, activeThemeId: 'custom' })
    if (typeof window !== 'undefined') {
      localStorage.setItem('discord-theme-id', 'custom')
      localStorage.setItem('discord-custom-theme', theme ? JSON.stringify(theme) : '')
    }
  },

  // ─── GC Actions ─────────────────────────────────────────────────────────

  setUserGCs: (gcs) => set({ userGCs: gcs }),

  addGC: (gc) =>
    set((s) => ({
      userGCs: [gc, ...s.userGCs],
    })),

  removeGC: (gcId) =>
    set((s) => {
      const { [gcId]: _m, ...restMembers } = s.gcMembers
      const { [gcId]: _msg, ...restMessages } = s.gcMessages
      const { [gcId]: _v, ...restVoice } = s.voiceParticipants
      const { [gcId]: _e, ...restEmojis } = s.customEmojis
      return {
        userGCs: s.userGCs.filter((gc) => gc.id !== gcId),
        selectedGCId: s.selectedGCId === gcId ? null : s.selectedGCId,
        gcMembers: restMembers,
        gcMessages: restMessages,
        voiceParticipants: restVoice,
        customEmojis: restEmojis,
      }
    }),

  updateGC: (gcId, data) =>
    set((s) => ({
      userGCs: s.userGCs.map((gc) =>
        gc.id === gcId ? { ...gc, ...data, updated_at: new Date().toISOString() } : gc
      ),
    })),

  // ─── GC Member Actions ──────────────────────────────────────────────────

  setGCMembers: (gcId, members) =>
    set((s) => ({
      gcMembers: { ...s.gcMembers, [gcId]: members },
    })),

  addGCMember: (gcId, member) =>
    set((s) => ({
      gcMembers: {
        ...s.gcMembers,
        [gcId]: [...(s.gcMembers[gcId] || []), member],
      },
    })),

  removeGCMember: (gcId, userId) =>
    set((s) => ({
      gcMembers: {
        ...s.gcMembers,
        [gcId]: (s.gcMembers[gcId] || []).filter((m) => m.user_id !== userId),
      },
    })),

  // ─── Message Actions ────────────────────────────────────────────────────

  addMessage: (message) =>
    set((s) => {
      if (message.gc_id) {
        const existing = s.gcMessages[message.gc_id] || []
        // Avoid duplicates by real message ID
        if (existing.some((m) => m.id === message.id)) return s
        // When a real (non-temp) message arrives, remove ONLY the temp message
        // from the SAME sender with MATCHING content (optimistic → real confirmation).
        // Do NOT blindly remove all temp messages from that sender.
        let filtered = existing
        if (!message.id.startsWith('temp-')) {
          filtered = existing.filter(
            (m) => !(
              m.id.startsWith('temp-') &&
              m.sender_id === message.sender_id &&
              m.content === message.content
            )
          )
        }
        return {
          gcMessages: {
            ...s.gcMessages,
            [message.gc_id]: [...filtered, message],
          },
        }
      }
      if (message.dm_conversation_id) {
        const existing = s.dmMessages[message.dm_conversation_id] || []
        if (existing.some((m) => m.id === message.id)) return s
        let filtered = existing
        if (!message.id.startsWith('temp-')) {
          filtered = existing.filter(
            (m) => !(
              m.id.startsWith('temp-') &&
              m.sender_id === message.sender_id &&
              m.content === message.content
            )
          )
        }
        return {
          dmMessages: {
            ...s.dmMessages,
            [message.dm_conversation_id]: [...filtered, message],
          },
        }
      }
      return s
    }),

  removeMessage: (messageId, channelId) =>
    set((s) => {
      if (s.gcMessages[channelId]) {
        return {
          gcMessages: {
            ...s.gcMessages,
            [channelId]: (s.gcMessages[channelId] || []).filter((m) => m.id !== messageId),
          },
        }
      }
      if (s.dmMessages[channelId]) {
        return {
          dmMessages: {
            ...s.dmMessages,
            [channelId]: (s.dmMessages[channelId] || []).filter((m) => m.id !== messageId),
          },
        }
      }
      return s
    }),

  updateMessageContent: (messageId, channelId, newContent, editedAt) =>
    set((s) => {
      const updateList = (list: Message[]) =>
        list.map((m) =>
          m.id === messageId
            ? { ...m, content: newContent, edited_at: editedAt || m.edited_at }
            : m
        )
      if (s.gcMessages[channelId]) {
        return {
          gcMessages: {
            ...s.gcMessages,
            [channelId]: updateList(s.gcMessages[channelId] || []),
          },
        }
      }
      if (s.dmMessages[channelId]) {
        return {
          dmMessages: {
            ...s.dmMessages,
            [channelId]: updateList(s.dmMessages[channelId] || []),
          },
        }
      }
      return s
    }),

  setGCMessages: (gcId, messages) =>
    set((s) => ({
      gcMessages: { ...s.gcMessages, [gcId]: messages },
    })),

  setDMMessages: (conversationId, messages) =>
    set((s) => ({
      dmMessages: { ...s.dmMessages, [conversationId]: messages },
    })),

  appendMessages: (key, messages) =>
    set((s) => {
      const isGC = s.gcMessages[key] !== undefined || !!get().selectedGCId
      // Determine which map to update based on context
      const existingGC = s.gcMessages[key] || []
      const existingDM = s.dmMessages[key] || []

      // Use GC map if key matches a GC, otherwise DM
      if (existingGC.length > 0 || s.userGCs.some((gc) => gc.id === key)) {
        const merged = [...existingGC]
        for (const m of messages) {
          if (!merged.some((em) => em.id === m.id)) merged.push(m)
        }
        return { gcMessages: { ...s.gcMessages, [key]: merged } }
      } else {
        const merged = [...existingDM]
        for (const m of messages) {
          if (!merged.some((em) => em.id === m.id)) merged.push(m)
        }
        return { dmMessages: { ...s.dmMessages, [key]: merged } }
      }
    }),

  prependMessages: (key, messages) =>
    set((s) => {
      const existingGC = s.gcMessages[key] || []
      const existingDM = s.dmMessages[key] || []

      if (existingGC.length > 0 || s.userGCs.some((gc) => gc.id === key)) {
        const existingIds = new Set(existingGC.map((m) => m.id))
        const unique = messages.filter((m) => !existingIds.has(m.id))
        return {
          gcMessages: { ...s.gcMessages, [key]: [...unique, ...existingGC] },
        }
      } else {
        const existingIds = new Set(existingDM.map((m) => m.id))
        const unique = messages.filter((m) => !existingIds.has(m.id))
        return {
          dmMessages: { ...s.dmMessages, [key]: [...unique, ...existingDM] },
        }
      }
    }),

  // ─── DM Actions ─────────────────────────────────────────────────────────

  setDMConversations: (conversations) =>
    set({ dmConversations: conversations }),

  addDMConversation: (conversation) =>
    set((s) => {
      // Deduplicate: if conversation with same ID already exists, move it to front
      const exists = s.dmConversations.some((c) => c.id === conversation.id)
      if (exists) {
        return {
          dmConversations: [
            conversation,
            ...s.dmConversations.filter((c) => c.id !== conversation.id),
          ],
        }
      }
      return { dmConversations: [conversation, ...s.dmConversations] }
    }),

  updateDMConversation: (conversationId, data) =>
    set((s) => ({
      dmConversations: s.dmConversations.map((c) =>
        c.id === conversationId ? { ...c, ...data } : c
      ),
    })),

  // ─── Friend Actions ─────────────────────────────────────────────────────

  setFriends: (friends) => set({ friends }),

  addFriend: (friend) =>
    set((s) => {
      if (s.friends.some((f) => f.id === friend.id)) return s
      return { friends: [...s.friends, friend] }
    }),

  removeFriend: (userId) =>
    set((s) => ({
      friends: s.friends.filter((f) => f.id !== userId),
    })),

  updateRemoteUser: (userId, data) =>
    set((s) => {
      // Update in friends list
      const updatedFriends = s.friends.map((f) =>
        f.id === userId ? { ...f, ...data } : f
      )
      // Update in GC members
      const updatedGCMembers: Record<string, GCMember[]> = {}
      for (const [gcId, members] of Object.entries(s.gcMembers)) {
        updatedGCMembers[gcId] = members.map((m) =>
          m.user?.id === userId ? { ...m, user: { ...m.user, ...data } } : m
        )
      }
      // Update in DM conversations (other user)
      const updatedDMs = s.dmConversations.map((dm) => {
        if (dm.other_user?.id === userId) {
          return { ...dm, other_user: { ...dm.other_user, ...data } }
        }
        return dm
      })
      // Update sender info in messages
      const updatedGCMessages: Record<string, Message[]> = {}
      for (const [gcId, msgs] of Object.entries(s.gcMessages)) {
        updatedGCMessages[gcId] = msgs.map((m) =>
          m.sender?.id === userId ? { ...m, sender: { ...m.sender, ...data } as any } : m
        )
      }
      const updatedDMMessages: Record<string, Message[]> = {}
      for (const [dmId, msgs] of Object.entries(s.dmMessages)) {
        updatedDMMessages[dmId] = msgs.map((m) =>
          m.sender?.id === userId ? { ...m, sender: { ...m.sender, ...data } as any } : m
        )
      }
      return {
        friends: updatedFriends,
        gcMembers: { ...s.gcMembers, ...updatedGCMembers },
        dmConversations: updatedDMs,
        gcMessages: { ...s.gcMessages, ...updatedGCMessages },
        dmMessages: { ...s.dmMessages, ...updatedDMMessages },
      }
    }),

  setPendingRequests: (requests) => set({ pendingFriendRequests: requests }),

  addPendingRequest: (request) =>
    set((s) => {
      if (s.pendingFriendRequests.some((r) => r.id === request.id)) return s
      return { pendingFriendRequests: [...s.pendingFriendRequests, request] }
    }),

  updatePendingRequest: (requestId, status) =>
    set((s) => ({
      pendingFriendRequests: s.pendingFriendRequests.map((r) =>
        r.id === requestId ? { ...r, status } : r
      ),
    })),

  // ─── Online Users Actions ───────────────────────────────────────────────

  setOnlineUsers: (userIds) => set({ onlineUsers: userIds }),

  addUserOnline: (userId) =>
    set((s) => {
      if (s.onlineUsers.includes(userId)) return s
      return { onlineUsers: [...s.onlineUsers, userId] }
    }),

  removeUserOnline: (userId) =>
    set((s) => ({
      onlineUsers: s.onlineUsers.filter((id) => id !== userId),
    })),

  // ─── Typing Actions ─────────────────────────────────────────────────────

  setTypingUsers: (channelId, userIds) =>
    set((s) => ({
      typingUsers: { ...s.typingUsers, [channelId]: userIds },
    })),

  addTypingUser: (channelId, userId) =>
    set((s) => {
      const existing = s.typingUsers[channelId] || []
      if (existing.includes(userId)) return s
      return {
        typingUsers: { ...s.typingUsers, [channelId]: [...existing, userId] },
      }
    }),

  removeTypingUser: (channelId, userId) =>
    set((s) => ({
      typingUsers: {
        ...s.typingUsers,
        [channelId]: (s.typingUsers[channelId] || []).filter(
          (id) => id !== userId
        ),
      },
    })),

  // ─── Voice Actions ──────────────────────────────────────────────────────

  setVoiceParticipants: (gcId, participants) =>
    set((s) => ({
      voiceParticipants: { ...s.voiceParticipants, [gcId]: participants },
    })),

  addVoiceParticipant: (gcId, session) =>
    set((s) => {
      const existing = s.voiceParticipants[gcId] || []
      if (existing.some((p) => p.user_id === session.user_id)) return s
      return {
        voiceParticipants: {
          ...s.voiceParticipants,
          [gcId]: [...existing, session],
        },
      }
    }),

  removeVoiceParticipant: (gcId, userId) =>
    set((s) => ({
      voiceParticipants: {
        ...s.voiceParticipants,
        [gcId]: (s.voiceParticipants[gcId] || []).filter(
          (p) => p.user_id !== userId
        ),
      },
    })),

  // ─── Custom Emoji Actions ───────────────────────────────────────────────

  setCustomEmojis: (gcId, emojis) =>
    set((s) => ({
      customEmojis: { ...s.customEmojis, [gcId]: emojis },
    })),

  addCustomEmoji: (gcId, emoji) =>
    set((s) => ({
      customEmojis: {
        ...s.customEmojis,
        [gcId]: [...(s.customEmojis[gcId] || []), emoji],
      },
    })),

  removeCustomEmoji: (emojiId) =>
    set((s) => {
      const updated: Record<string, CustomEmoji[]> = {}
      for (const [gcId, emojis] of Object.entries(s.customEmojis)) {
        const filtered = emojis.filter((e) => e.id !== emojiId)
        if (filtered.length > 0 || emojis.length === 0) {
          updated[gcId] = filtered
        }
      }
      return { customEmojis: updated }
    }),

  // ─── Call Actions ───────────────────────────────────────────────────────

  setActiveCall: (call) => set({ activeCall: call }),

  setIncomingCall: (call) => set({ incomingCall: call }),

  setCallMuted: (muted) => set({ isCallMuted: muted }),

  setCallDeafened: (deafened) => set({ isCallDeafened: deafened }),

  // ─── Notification Actions ───────────────────────────────────────────

  incrementUnread: (channelId) =>
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [channelId]: (s.unreadCounts[channelId] || 0) + 1,
      },
    })),

  incrementMention: (channelId) =>
    set((s) => ({
      mentionCounts: {
        ...s.mentionCounts,
        [channelId]: (s.mentionCounts[channelId] || 0) + 1,
      },
      unreadCounts: {
        ...s.unreadCounts,
        [channelId]: (s.unreadCounts[channelId] || 0) + 1,
      },
    })),

  clearUnread: (channelId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [channelId]: 0 },
      mentionCounts: { ...s.mentionCounts, [channelId]: 0 },
    })),

  clearMention: (channelId) =>
    set((s) => ({
      mentionCounts: { ...s.mentionCounts, [channelId]: 0 },
    })),

  // ─── Reset ──────────────────────────────────────────────────────────────

  reset: () => set(initialState),
}))