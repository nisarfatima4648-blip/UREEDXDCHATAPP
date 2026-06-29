import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'
import { db, type User } from '../../src/lib/database'

// ─── Server Setup ────────────────────────────────────────────────────────────

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ─── Connection Tracking ─────────────────────────────────────────────────────

const socketToUser = new Map<string, string>() // socket.id -> userId
const userToSocket = new Map<string, string>() // userId -> socket.id

const PORT = 3003

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function generateId(): string {
  return crypto.randomUUID()
}

function getUserId(socket: Socket): string | undefined {
  return socketToUser.get(socket.id)
}

function getSocketByUser(userId: string): Socket | undefined {
  const socketId = userToSocket.get(userId)
  if (!socketId) return undefined
  return io.sockets.sockets.get(socketId)
}

function emitToUser(userId: string, event: string, data: any) {
  const socket = getSocketByUser(userId)
  if (socket) {
    socket.emit(event, { ...data, timestamp: now() })
  }
}

/** Convert DB User (snake_case) to camelCase for socket payloads */
function sanitizeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    status: user.status,
  }
}

// ─── Main Connection Handler ─────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket] Connected: ${socket.id}`)

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('auth', (payload: { userId: string }) => {
    try {
      const { userId } = payload
      const user = db.getUserById(userId)

      if (!user) {
        socket.emit('auth:error', { message: 'User not found', timestamp: now() })
        socket.disconnect()
        return
      }

      // Store mapping
      socketToUser.set(socket.id, userId)
      userToSocket.set(userId, socket.id)

      // Update status to online
      db.updateUserStatus(userId, 'online')

      // Join all GC rooms the user is a member of
      const gcList = db.getUserGCs(userId)
      for (const gc of gcList) {
        socket.join(`gc:${gc.id}`)
      }

      // Join personal room for DMs and friend events
      socket.join(`user:${userId}`)

      // Also join any existing DM conversation rooms
      const dmConversations = db.getUserDMs(userId)
      for (const dm of dmConversations) {
        socket.join(`dm:${dm.id}`)
      }

      // Send success with user data
      socket.emit('auth:success', { user: sanitizeUser(user), timestamp: now() })

      // Broadcast presence to all GC rooms
      const presence = { userId, status: 'online' as const, ...sanitizeUser(user), timestamp: now() }
      for (const gc of gcList) {
        socket.to(`gc:${gc.id}`).emit('presence:update', presence)
      }

      // Broadcast to friends
      const friends = db.getFriends(userId)
      for (const f of friends) {
        emitToUser(f.id, 'presence:update', presence)
      }

      console.log(`[auth] User ${user.username} (${userId}) authenticated, joined ${gcList.length} GCs`)
    } catch (err) {
      console.error('[auth] Error:', err)
      socket.emit('auth:error', { message: 'Authentication failed', timestamp: now() })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGING
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('message:send', (payload: {
    gcId?: string
    dmConversationId?: string
    content: string
    type?: string
    attachmentUrl?: string
    replyToId?: string
  }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) {
        socket.emit('error', { message: 'Not authenticated', timestamp: now() })
        return
      }

      const user = db.getUserById(userId)
      if (!user) return

      const { gcId, dmConversationId, content, type, attachmentUrl, replyToId } = payload

      // Validate access — must be member of GC or participant in DM
      if (gcId) {
        if (!db.isMember(gcId, userId)) {
          socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
          return
        }
      } else if (dmConversationId) {
        const dm = db.getDMConversation(userId, 'dummy') // We need a different check
        // Check if user is in this DM by querying the conversation
        const dmConv = db.raw
          .query('SELECT 1 FROM dm_conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)')
          .get(dmConversationId, userId, userId) as unknown
        if (!dmConv) {
          socket.emit('error', { message: 'Not a participant in this DM', timestamp: now() })
          return
        }
        // Join the DM room
        socket.join(`dm:${dmConversationId}`)
      } else {
        socket.emit('error', { message: 'Must specify gcId or dmConversationId', timestamp: now() })
        return
      }

      // Create message in DB
      const messageId = generateId()
      const message = db.createMessage(messageId, {
        gc_id: gcId ?? null,
        dm_conversation_id: dmConversationId ?? null,
        sender_id: userId,
        content,
        type: (type as any) ?? 'text',
        attachment_url: attachmentUrl ?? null,
        reply_to_id: replyToId ?? null,
      })

      const fullMessage = {
        id: message.id,
        gcId: message.gc_id,
        dmConversationId: message.dm_conversation_id,
        content: message.content,
        type: message.type,
        attachmentUrl: message.attachment_url,
        replyToId: message.reply_to_id,
        createdAt: message.created_at,
        sender: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
        },
        timestamp: now(),
      }

      // Emit to appropriate room
      if (gcId) {
        io.to(`gc:${gcId}`).emit('message:new', fullMessage)
      } else if (dmConversationId) {
        // For DMs, also ensure the other participant receives the message
        // even if they weren't in the room (e.g. DM created after their auth)
        const dmConv = db.raw
          .query('SELECT user1_id, user2_id FROM dm_conversations WHERE id = ?')
          .get(dmConversationId) as any
        if (dmConv) {
          const otherUserId = dmConv.user1_id === userId ? dmConv.user2_id : dmConv.user1_id
          const otherSocket = getSocketByUser(otherUserId)
          if (otherSocket) {
            otherSocket.join(`dm:${dmConversationId}`)
          }
        }
        io.to(`dm:${dmConversationId}`).emit('message:new', fullMessage)
      }
    } catch (err) {
      console.error('[message:send] Error:', err)
      socket.emit('error', { message: 'Failed to send message', timestamp: now() })
    }
  })

  // ── Typing Indicator ───────────────────────────────────────────────────────

  socket.on('message:typing', (payload: {
    gcId?: string
    dmConversationId?: string
    isTyping: boolean
  }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const user = db.getUserById(userId)
      if (!user) return

      const typingPayload = {
        userId,
        username: user.username,
        displayName: user.display_name,
        gcId: payload.gcId ?? null,
        dmConversationId: payload.dmConversationId ?? null,
        isTyping: payload.isTyping,
        timestamp: now(),
      }

      if (payload.gcId) {
        socket.to(`gc:${payload.gcId}`).emit('message:typing', typingPayload)
      } else if (payload.dmConversationId) {
        socket.to(`dm:${payload.dmConversationId}`).emit('message:typing', typingPayload)
      }
    } catch (err) {
      console.error('[message:typing] Error:', err)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESENCE
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('presence:change', (payload: { status: 'online' | 'idle' | 'dnd' | 'invisible' }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const user = db.getUserById(userId)
      if (!user) return

      const { status } = payload
      const gcList = db.getUserGCs(userId)

      if (status === 'invisible') {
        // Internally keep online but show offline to others
        db.updateUserStatus(userId, 'offline')

        const offlinePresence = {
          userId,
          status: 'offline' as const,
          ...sanitizeUser(user),
          timestamp: now(),
        }

        for (const gc of gcList) {
          socket.to(`gc:${gc.id}`).emit('presence:update', offlinePresence)
        }

        const friends = db.getFriends(userId)
        for (const f of friends) {
          emitToUser(f.id, 'presence:update', offlinePresence)
        }
      } else {
        db.updateUserStatus(userId, status)

        const presence = {
          userId,
          status,
          ...sanitizeUser(user),
          timestamp: now(),
        }

        for (const gc of gcList) {
          socket.to(`gc:${gc.id}`).emit('presence:update', presence)
        }

        const friends = db.getFriends(userId)
        for (const f of friends) {
          emitToUser(f.id, 'presence:update', presence)
        }
      }

      // Acknowledge to the user themselves
      socket.emit('presence:updated', { status, timestamp: now() })
    } catch (err) {
      console.error('[presence:change] Error:', err)
    }
  })

  // ── User Profile Update (broadcast to all GC rooms the user is in) ───────

  socket.on('user:profile:update', (payload: {
    userId: string
    displayName?: string
    bio?: string
    customStatus?: string
    avatarUrl?: string
    bannerUrl?: string
  }) => {
    try {
      const userId = getUserId(socket)
      if (!userId || userId !== payload.userId) return

      // Update DB
      const updates: string[] = []
      const params: any[] = []
      if (payload.displayName !== undefined) { updates.push('display_name = ?'); params.push(payload.displayName) }
      if (payload.bio !== undefined) { updates.push('bio = ?'); params.push(payload.bio) }
      if (payload.customStatus !== undefined) { updates.push('custom_status = ?'); params.push(payload.customStatus) }
      if (payload.avatarUrl !== undefined) { updates.push('avatar_url = ?'); params.push(payload.avatarUrl) }
      if (payload.bannerUrl !== undefined) { updates.push('banner_url = ?'); params.push(payload.bannerUrl) }
      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')")
        params.push(userId)
        db.raw.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)
      }

      // Broadcast to all GC rooms
      const gcList = db.getUserGCs(userId)
      const broadcastData = { userId, ...payload, timestamp: now() }
      for (const gc of gcList) {
        socket.to(`gc:${gc.id}`).emit('user:profile:update', broadcastData)
      }

      // Also emit to any DM conversations
      const dmConvs = db.getUserDMs(userId)
      for (const dm of dmConvs) {
        socket.to(`dm:${dm.id}`).emit('user:profile:update', broadcastData)
      }
    } catch (err) {
      console.error('[user:profile:update] Error:', err)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VOICE CHANNEL
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('vc:join', (payload: { gcId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const user = db.getUserById(userId)
      if (!user) return

      const { gcId } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      // Create voice session (db.joinVoice also removes any existing session for this user)
      db.joinVoice(gcId, userId)

      // Join the VC room for signaling
      socket.join(`vc:${gcId}`)

      // Notify others in the GC
      socket.to(`gc:${gcId}`).emit('vc:user-joined', {
        userId,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        gcId,
        timestamp: now(),
      })

      // Send current participants list to the joining user
      const participants = db.getVoiceParticipants(gcId)
      socket.emit('vc:participants', {
        gcId,
        participants: participants.map((p) => ({
          userId: p.user_id,
          username: p.user?.username,
          displayName: p.user?.display_name,
          avatarUrl: p.user?.avatar_url,
          joinedAt: p.joined_at,
        })),
        timestamp: now(),
      })

      console.log(`[vc] ${user.username} joined VC in gc:${gcId}`)
    } catch (err) {
      console.error('[vc:join] Error:', err)
      socket.emit('error', { message: 'Failed to join voice channel', timestamp: now() })
    }
  })

  socket.on('vc:leave', (payload: { gcId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const user = db.getUserById(userId)
      if (!user) return

      const { gcId } = payload

      db.leaveVoice(gcId, userId)
      socket.leave(`vc:${gcId}`)

      const leavePayload = {
        userId,
        username: user.username,
        displayName: user.display_name,
        gcId,
        timestamp: now(),
      }

      // Notify everyone in the GC (including the leaving user so their UI updates)
      io.to(`gc:${gcId}`).emit('vc:user-left', leavePayload)

      // Also notify the VC signaling room so peers can close WebRTC connections
      socket.to(`vc:${gcId}`).emit('vc:peer-left', {
        userId,
        gcId,
        timestamp: now(),
      })

      console.log(`[vc] ${user.username} left VC in gc:${gcId}`)
    } catch (err) {
      console.error('[vc:leave] Error:', err)
    }
  })

  // ─── WebRTC Signaling Relay ──────────────────────────────────────────────

  socket.on('vc:signal', (payload: { gcId: string; targetUserId: string; signal: any }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const targetSocket = getSocketByUser(payload.targetUserId)
      if (targetSocket) {
        targetSocket.emit('vc:signal', {
          fromUserId: userId,
          gcId: payload.gcId,
          signal: payload.signal,
        })
      }
    } catch (err) {
      console.error('[vc:signal] Error:', err)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // GC MEMBER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('gc:member:add', (payload: { gcId: string; userId: string; role?: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { gcId, userId: targetUserId, role } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      db.addMember(gcId, targetUserId, (role as any) ?? 'member')

      const targetUser = db.getUserById(targetUserId)

      // IMPORTANT: Join target user to GC room BEFORE emitting so they receive the event
      const targetSocket = getSocketByUser(targetUserId)
      if (targetSocket) {
        targetSocket.join(`gc:${gcId}`)
      }

      // Fetch full GC data so the new member can add it to their sidebar
      const gc = db.getGCById(gcId)

      const memberData = {
        gcId,
        userId: targetUserId,
        role: (role as any) ?? 'member',
        user: targetUser ? sanitizeUser(targetUser) : null,
        gc: gc ? {
          id: gc.id,
          name: gc.name,
          description: gc.description,
          owner_id: gc.owner_id,
          created_at: gc.created_at,
          updated_at: gc.updated_at,
          avatar_url: gc.avatar_url,
          banner_url: gc.banner_url,
        } : null,
        timestamp: now(),
      }

      io.to(`gc:${gcId}`).emit('gc:member:added', memberData)

      console.log(`[gc] User ${targetUserId} added to gc:${gcId}`)
    } catch (err) {
      console.error('[gc:member:add] Error:', err)
      socket.emit('error', { message: 'Failed to add member', timestamp: now() })
    }
  })

  socket.on('gc:member:remove', (payload: { gcId: string; userId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { gcId, userId: targetUserId } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      db.removeMember(gcId, targetUserId)

      // Remove from VC if in one
      db.leaveVoice(gcId, targetUserId)

      const memberData = {
        gcId,
        userId: targetUserId,
        timestamp: now(),
      }

      io.to(`gc:${gcId}`).emit('gc:member:removed', memberData)

      // If target user is online, make them leave the rooms
      const targetSocket = getSocketByUser(targetUserId)
      if (targetSocket) {
        targetSocket.leave(`gc:${gcId}`)
        targetSocket.leave(`vc:${gcId}`)
      }

      console.log(`[gc] User ${targetUserId} removed from gc:${gcId}`)
    } catch (err) {
      console.error('[gc:member:remove] Error:', err)
      socket.emit('error', { message: 'Failed to remove member', timestamp: now() })
    }
  })

  socket.on('gc:member:ban', (payload: { gcId: string; userId: string; reason?: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { gcId, userId: targetUserId, reason } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      db.banUser(gcId, targetUserId, reason)

      // Remove from members and VC
      db.removeMember(gcId, targetUserId)
      db.leaveVoice(gcId, targetUserId)

      const banData = {
        gcId,
        userId: targetUserId,
        reason: reason ?? null,
        timestamp: now(),
      }

      io.to(`gc:${gcId}`).emit('gc:member:banned', banData)

      // If target user is online, notify and remove from rooms
      const targetSocket = getSocketByUser(targetUserId)
      if (targetSocket) {
        targetSocket.leave(`gc:${gcId}`)
        targetSocket.leave(`vc:${gcId}`)
        targetSocket.emit('gc:banned', { gcId, reason: reason ?? null, timestamp: now() })
      }

      console.log(`[gc] User ${targetUserId} banned from gc:${gcId}`)
    } catch (err) {
      console.error('[gc:member:ban] Error:', err)
      socket.emit('error', { message: 'Failed to ban member', timestamp: now() })
    }
  })

  socket.on('gc:update', (payload: {
    gcId: string
    name?: string
    iconUrl?: string
    description?: string
  }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { gcId, name, iconUrl, description } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      const updatedGC = db.updateGC(gcId, {
        name,
        icon_url: iconUrl,
        description,
      })

      const gcData = {
        gcId,
        gc: {
          id: updatedGC.id,
          name: updatedGC.name,
          iconUrl: updatedGC.icon_url,
          description: updatedGC.description,
          ownerId: updatedGC.owner_id,
          updatedAt: updatedGC.updated_at,
          memberCount: updatedGC.member_count,
        },
        timestamp: now(),
      }

      io.to(`gc:${gcId}`).emit('gc:updated', gcData)

      console.log(`[gc] gc:${gcId} updated`)
    } catch (err) {
      console.error('[gc:update] Error:', err)
      socket.emit('error', { message: 'Failed to update group chat', timestamp: now() })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FRIEND REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('friend:request:send', (payload: { receiverId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const user = db.getUserById(userId)
      if (!user) return

      const { receiverId } = payload
      const request = db.sendFriendRequest(userId, receiverId)

      const requestData = {
        id: request.id,
        senderId: userId,
        sender: sanitizeUser(user),
        receiverId,
        status: 'pending' as const,
        createdAt: request.created_at,
        timestamp: now(),
      }

      // Emit to receiver's personal room
      emitToUser(receiverId, 'friend:request:received', requestData)

      // Acknowledge to sender
      socket.emit('friend:request:sent', requestData)

      console.log(`[friend] ${user.username} sent friend request to ${receiverId}`)
    } catch (err) {
      console.error('[friend:request:send] Error:', err)
      socket.emit('error', { message: 'Failed to send friend request', timestamp: now() })
    }
  })

  socket.on('friend:request:accept', (payload: { requestId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { requestId } = payload

      // Get the request details before updating
      const req = db.raw
        .query('SELECT * FROM friend_requests WHERE id = ?')
        .get(requestId) as Record<string, any> | undefined

      if (!req) {
        socket.emit('error', { message: 'Friend request not found', timestamp: now() })
        return
      }

      db.acceptFriendRequest(requestId)

      const acceptData = {
        id: requestId,
        senderId: req.sender_id,
        receiverId: req.receiver_id,
        status: 'accepted' as const,
        timestamp: now(),
      }

      // Emit to both users
      emitToUser(req.sender_id, 'friend:accepted', acceptData)
      emitToUser(req.receiver_id, 'friend:accepted', acceptData)

      console.log(`[friend] Request ${requestId} accepted`)
    } catch (err) {
      console.error('[friend:request:accept] Error:', err)
      socket.emit('error', { message: 'Failed to accept friend request', timestamp: now() })
    }
  })

  socket.on('friend:request:decline', (payload: { requestId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { requestId } = payload

      // Get the request details before updating
      const req = db.raw
        .query('SELECT * FROM friend_requests WHERE id = ?')
        .get(requestId) as Record<string, any> | undefined

      if (!req) {
        socket.emit('error', { message: 'Friend request not found', timestamp: now() })
        return
      }

      db.declineFriendRequest(requestId)

      const declineData = {
        id: requestId,
        senderId: req.sender_id,
        receiverId: req.receiver_id,
        status: 'declined' as const,
        timestamp: now(),
      }

      // Emit to sender
      emitToUser(req.sender_id, 'friend:declined', declineData)

      // Acknowledge to the decliner
      socket.emit('friend:request:declined', declineData)

      console.log(`[friend] Request ${requestId} declined`)
    } catch (err) {
      console.error('[friend:request:decline] Error:', err)
      socket.emit('error', { message: 'Failed to decline friend request', timestamp: now() })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM EMOJIS
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('emoji:add', (payload: { gcId: string; name: string; imageUrl: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { gcId, name, imageUrl } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      const emoji = db.addEmoji(gcId, name, imageUrl, userId)

      const emojiData = {
        id: emoji.id,
        gcId,
        name: emoji.name,
        imageUrl: emoji.image_url,
        uploadedBy: userId,
        createdAt: emoji.created_at,
        timestamp: now(),
      }

      io.to(`gc:${gcId}`).emit('emoji:added', emojiData)

      console.log(`[emoji] ${name} added to gc:${gcId}`)
    } catch (err) {
      console.error('[emoji:add] Error:', err)
      socket.emit('error', { message: 'Failed to add emoji', timestamp: now() })
    }
  })

  socket.on('emoji:remove', (payload: { gcId: string; emojiId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { gcId, emojiId } = payload

      if (!db.isMember(gcId, userId)) {
        socket.emit('error', { message: 'Not a member of this group chat', timestamp: now() })
        return
      }

      // Fetch emoji before deleting
      const emoji = db.getEmojiById(emojiId)

      db.removeEmoji(emojiId)

      const emojiData = {
        id: emojiId,
        gcId,
        emoji: emoji ? {
          id: emoji.id,
          name: emoji.name,
          imageUrl: emoji.image_url,
        } : null,
        timestamp: now(),
      }

      io.to(`gc:${gcId}`).emit('emoji:removed', emojiData)

      console.log(`[emoji] ${emojiId} removed from gc:${gcId}`)
    } catch (err) {
      console.error('[emoji:remove] Error:', err)
      socket.emit('error', { message: 'Failed to remove emoji', timestamp: now() })
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DM VOICE CALLS
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('dm:call', (payload: { dmConversationId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { dmConversationId } = payload
      const user = db.getUserById(userId)
      if (!user) return

      // Look up the DM conversation
      const dm = db.getDMById(dmConversationId)
      if (!dm) {
        socket.emit('error', { message: 'DM conversation not found', timestamp: now() })
        return
      }

      // Determine the other user in this DM
      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id
      const otherUser = db.getUserById(otherUserId)
      if (!otherUser) {
        socket.emit('error', { message: 'User not found', timestamp: now() })
        return
      }

      console.log(`[dm:call] ${user.username} calling ${otherUser.username} in ${dmConversationId}`)

      // Emit incoming call to the other user — try direct socket first, fallback to personal room
      const targetSocket = getSocketByUser(otherUserId)
      if (targetSocket) {
        targetSocket.emit('dm:call:incoming', {
          dmConversationId,
          callerId: userId,
          callerName: user.display_name || user.username,
          callerAvatar: user.avatar_url,
          timestamp: now(),
        })
        console.log(`[dm:call] Emitted dm:call:incoming to ${otherUser.username} via socket ${targetSocket.id}`)
      } else {
        // Fallback: emit via the user's personal room (joined on auth)
        io.to(`user:${otherUserId}`).emit('dm:call:incoming', {
          dmConversationId,
          callerId: userId,
          callerName: user.display_name || user.username,
          callerAvatar: user.avatar_url,
          timestamp: now(),
        })
        console.warn(`[dm:call] No direct socket for ${otherUserId}, sent via user:${otherUserId} room`)
      }
    } catch (err) {
      console.error('[dm:call] Error:', err)
    }
  })

  socket.on('dm:call:answer', (payload: { dmConversationId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { dmConversationId } = payload
      const user = db.getUserById(userId)
      if (!user) return

      const dm = db.getDMById(dmConversationId)
      if (!dm) return

      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id
      const otherUser = db.getUserById(otherUserId)
      if (!otherUser) return

      console.log(`[dm:call:answer] ${user.username} accepted call from ${otherUser.username}`)

      // Notify both users the call is connected
      const connectedData = {
        dmConversationId,
        startedAt: now(),
      }

      // To the caller (who answered)
      socket.emit('dm:call:connected', {
        ...connectedData,
        otherUserId,
        otherName: otherUser.display_name || otherUser.username,
        otherAvatar: otherUser.avatar_url,
      })

      // To the callee (who initiated)
      emitToUser(otherUserId, 'dm:call:connected', {
        ...connectedData,
        otherUserId: userId,
        otherName: user.display_name || user.username,
        otherAvatar: user.avatar_url,
      })
    } catch (err) {
      console.error('[dm:call:answer] Error:', err)
    }
  })

  socket.on('dm:call:decline', (payload: { dmConversationId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { dmConversationId } = payload
      const user = db.getUserById(userId)
      if (!user) return

      const dm = db.getDMById(dmConversationId)
      if (!dm) return

      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id

      console.log(`[dm:call:decline] ${user.username} declined call`)

      emitToUser(otherUserId, 'dm:call:ended', {
        dmConversationId,
        reason: 'declined',
        endedBy: userId,
      })
    } catch (err) {
      console.error('[dm:call:decline] Error:', err)
    }
  })

  socket.on('dm:call:hangup', (payload: { dmConversationId: string }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const { dmConversationId } = payload

      const dm = db.getDMById(dmConversationId)
      if (!dm) return

      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id

      console.log(`[dm:call:hangup] ${userId} hung up call in ${dmConversationId}`)

      emitToUser(otherUserId, 'dm:call:ended', {
        dmConversationId,
        reason: 'hungup',
        endedBy: userId,
      })
    } catch (err) {
      console.error('[dm:call:hangup] Error:', err)
    }
  })

  // ─── DM Call WebRTC Signal Relay ──────────────────────────────────────

  socket.on('dm:call:signal', (payload: { dmConversationId: string; targetUserId: string; signal: any }) => {
    try {
      const userId = getUserId(socket)
      if (!userId) return

      const targetSocket = getSocketByUser(payload.targetUserId)
      if (targetSocket) {
        targetSocket.emit('dm:call:signal', {
          fromUserId: userId,
          dmConversationId: payload.dmConversationId,
          signal: payload.signal,
        })
      }
    } catch (err) {
      console.error('[dm:call:signal] Error:', err)
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCONNECT
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('disconnect', () => {
    try {
      const userId = socketToUser.get(socket.id)
      if (!userId) {
        console.log(`[disconnect] Unknown socket: ${socket.id}`)
        return
      }

      const user = db.getUserById(userId)

      // Set status to offline
      db.updateUserStatus(userId, 'offline')

      // Remove from tracking maps
      socketToUser.delete(socket.id)
      userToSocket.delete(userId)

      // Get memberships for broadcasting
      const gcList = db.getUserGCs(userId)

      // Remove all voice sessions for this user
      const voiceSession = db.getUserVoiceSession(userId)

      // Broadcast presence update to all GC rooms
      if (user) {
        const presence = {
          userId,
          status: 'offline' as const,
          ...sanitizeUser(user),
          timestamp: now(),
        }

        for (const gc of gcList) {
          io.to(`gc:${gc.id}`).emit('presence:update', presence)
        }

        const friends = db.getFriends(userId)
        for (const f of friends) {
          emitToUser(f.id, 'presence:update', presence)
        }
      }

      // Broadcast VC leave if user was in a voice channel
      if (voiceSession) {
        db.leaveVoice(voiceSession.gc_id, userId)

        io.to(`gc:${voiceSession.gc_id}`).emit('vc:user-left', {
          userId,
          username: user?.username,
          displayName: user?.display_name,
          gcId: voiceSession.gc_id,
          timestamp: now(),
        })

      }

      console.log(`[disconnect] User ${user?.username ?? userId} disconnected`)
    } catch (err) {
      console.error('[disconnect] Error:', err)
    }
  })

  // ── Error Handler ────────────────────────────────────────────────────────

  socket.on('error', (error) => {
    console.error(`[socket:error] ${socket.id}:`, error)
  })
})

// ─── Internal HTTP API (for Next.js API routes to trigger socket events) ───

// Reuse the same httpServer — attach a raw HTTP handler for /api/internal/* routes
httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
  // Let socket.io handle non-API requests
  if (!req.url?.startsWith('/api/internal/')) return

  let body = ''
  req.on('data', (chunk: Buffer) => { body += chunk.toString() })
  req.on('end', () => {
    try {
      const data = JSON.parse(body || '{}')

      if (req.url === '/api/internal/message-deleted') {
        const { messageId, gcId, dmConversationId } = data
        const room = gcId ? `gc:${gcId}` : dmConversationId ? `dm:${dmConversationId}` : null
        if (room) {
          io.to(room).emit('message:deleted', { messageId, gcId, dmConversationId, timestamp: now() })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else if (req.url === '/api/internal/message-edited') {
        const { messageId, gcId, dmConversationId, newContent, editedAt, senderId } = data
        const room = gcId ? `gc:${gcId}` : dmConversationId ? `dm:${dmConversationId}` : null
        if (room) {
          io.to(room).emit('message:edited', {
            messageId, newContent, editedAt, senderId,
            gcId, dmConversationId, timestamp: now()
          })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else if (req.url === '/api/internal/dm-conversation-created') {
        // Notify the other user that a new DM conversation was created with them
        const { conversationId, user1Id, user2Id, creatorId, otherUser, creatorUser } = data
        // The recipient is the user who didn't create the DM
        const recipientId = creatorId === user1Id ? user2Id : user1Id
        
        // Join the creator to the DM room (they might have created it after auth)
        const creatorSocket = getSocketByUser(creatorId)
        if (creatorSocket) {
          creatorSocket.join(`dm:${conversationId}`)
        }
        
        const recipientSocket = getSocketByUser(recipientId)
        if (recipientSocket) {
          // Join recipient to DM room so they receive messages
          recipientSocket.join(`dm:${conversationId}`)
          // Send the new DM conversation to the recipient
          emitToUser(recipientId, 'dm:conversation:new', {
            id: conversationId,
            user1_id: user1Id,
            user2_id: user2Id,
            other_user: creatorUser || otherUser,
            timestamp: now(),
          })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    } catch (err) {
      console.error('[internal-api] Error:', err)
      res.writeHead(500)
      res.end('Internal error')
    }
  })
})

// ─── Start Server ────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[chat-service] Socket.io server running on port ${PORT}`)
})

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(signal: string) {
  console.log(`[chat-service] Received ${signal}, shutting down...`)
  io.close()
  httpServer.close(() => {
    console.log('[chat-service] Server closed')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))