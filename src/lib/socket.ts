'use client'

import { io, Socket } from 'socket.io-client'
import type { Message } from '@/lib/database'

// In production (Vercel), use the deployed chat-service URL (Railway).
// In dev, use the local gateway with XTransformPort.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || '/?XTransformPort=3003'

let socket: Socket | null = null
let lastUserId: string | null = null
let authenticated = false
// Queue of events to send once auth is confirmed
let pendingQueue: { event: string; data: any }[] = []

export function getSocket(): Socket {
  if (!socket) {
    console.log('[socket] Creating socket.io instance, URL:', SOCKET_URL, 'path: /')
    socket = io(SOCKET_URL, {
      path: '/',
      // Allow both transports — websocket is essential for low-latency WebRTC
      // signaling (ICE candidates, offers/answers). Polling alone causes
      // delayed/batched signal delivery which breaks voice channels & DM calls.
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    socket.on('connect', () => {
      console.log('[socket] CONNECTED, id:', socket!.id)
      // Reset auth state on every new connection
      authenticated = false
      if (lastUserId) {
        console.log('[socket] Emitting auth for user:', lastUserId)
        socket!.emit('auth', { userId: lastUserId })
      }
    })

    // Mark as authenticated only when server confirms
    socket.on('auth:success', () => {
      console.log('[socket] Auth confirmed by server')
      authenticated = true
      // Flush any queued events
      while (pendingQueue.length > 0) {
        const { event, data } = pendingQueue.shift()!
        console.log('[socket] Flushing queued event:', event)
        socket!.emit(event, data)
      }
    })

    socket.on('connect_error', (err) => {
      console.error('[socket] CONNECT ERROR:', err.message)
    })

    socket.on('disconnect', (reason) => {
      console.warn('[socket] DISCONNECTED:', reason)
      authenticated = false
    })
  }
  return socket
}

// Internal: queue or send immediately based on auth state
function emit(event: string, data: any): void {
  const s = getSocket()
  if (!authenticated || !s.connected) {
    console.log('[socket] Queuing event (not authed):', event)
    pendingQueue.push({ event, data })
  } else {
    s.emit(event, data)
  }
}

// ─── Connection Management ──────────────────────────────────────────────────

export function connectSocket(userId: string): void {
  lastUserId = userId
  const s = getSocket()
  if (s.connected) {
    s.emit('auth', { userId })
  }
  // If not connected, the 'connect' listener above will handle auth
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
  lastUserId = null
  authenticated = false
  pendingQueue = []
}

export function isAuthenticated(): boolean {
  return authenticated
}

// ─── Messaging ───────────────────────────────────────────────────────────────

export function sendMessage(data: {
  gcId?: string
  dmConversationId?: string
  content: string
  type?: Message['type']
  attachmentUrl?: string
  replyToId?: string
}): void {
  emit('message:send', data)
}

export function sendTyping(data: {
  gcId?: string
  dmConversationId?: string
}): void {
  emit('message:typing', data)
}

// ─── Presence ────────────────────────────────────────────────────────────────

export function changePresence(status: 'online' | 'idle' | 'dnd' | 'invisible'): void {
  emit('presence:change', { status })
}

// ─── Voice Channel ───────────────────────────────────────────────────────────

export function joinVC(gcId: string): void {
  emit('vc:join', { gcId })
}

export function leaveVC(gcId: string): void {
  emit('vc:leave', { gcId })
}

export function sendVCSignal(gcId: string, targetUserId: string, signal: any): void {
  emit('vc:signal', { gcId, targetUserId, signal })
}

// ─── Group Chat Member Management ────────────────────────────────────────────

export function addGCMember(gcId: string, userId: string, role?: 'admin' | 'member'): void {
  emit('gc:member:add', { gcId, userId, role })
}

export function removeGCMember(gcId: string, userId: string): void {
  emit('gc:member:remove', { gcId, userId })
}

export function banGCMember(gcId: string, userId: string, reason?: string): void {
  emit('gc:member:ban', { gcId, userId, reason })
}

// ─── Friend Requests ─────────────────────────────────────────────────────────

export function sendFriendRequest(receiverId: string): void {
  emit('friend:request:send', { receiverId })
}

export function acceptFriendRequest(requestId: string): void {
  emit('friend:request:accept', { requestId })
}

export function declineFriendRequest(requestId: string): void {
  emit('friend:request:decline', { requestId })
}

// ─── Custom Emojis ───────────────────────────────────────────────────────────

export function addEmoji(gcId: string, name: string, imageUrl: string): void {
  emit('emoji:add', { gcId, name, imageUrl })
}

export function removeEmoji(gcId: string, emojiId: string): void {
  emit('emoji:remove', { gcId, emojiId })
}

// ─── DM Voice Calls ─────────────────────────────────────────────────────────

export function callUser(dmConversationId: string): void {
  emit('dm:call', { dmConversationId })
}

export function answerCall(dmConversationId: string): void {
  emit('dm:call:answer', { dmConversationId })
}

export function declineCall(dmConversationId: string): void {
  emit('dm:call:decline', { dmConversationId })
}

export function hangUpCall(dmConversationId: string): void {
  emit('dm:call:hangup', { dmConversationId })
}

export function sendDMCallSignal(dmConversationId: string, targetUserId: string, signal: any): void {
  emit('dm:call:signal', { dmConversationId, targetUserId, signal })
}

// ─── Event Subscription Helpers ──────────────────────────────────────────────

export function onSocketEvent(event: string, handler: (...args: unknown[]) => void): void {
  getSocket().on(event, handler)
}

export function offSocketEvent(event: string, handler?: (...args: unknown[]) => void): void {
  if (handler) {
    getSocket().off(event, handler)
  } else {
    getSocket().removeAllListeners(event)
  }
}