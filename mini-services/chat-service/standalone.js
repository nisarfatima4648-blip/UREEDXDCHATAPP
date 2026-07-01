// ============================================================================
// standalone.js — Self-contained chat-service for WispByte (plain Node.js)
// No TypeScript, no external imports. Uses pg + socket.io directly.
//
// On WispByte, set: JS_FILE=standalone.js
// Environment variables needed: DATABASE_URL
// ============================================================================

const { createServer } = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

// ─── Database Pool ──────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ureedxdchat',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }
function generateId() { return crypto.randomUUID(); }
function ts(val) { return val instanceof Date ? val.toISOString() : (typeof val === 'string' ? val : new Date().toISOString()); }

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    status: user.status,
  };
}

// ─── Database Methods (async, using pg) ─────────────────────────────────────

const db = {
  async getUserById(id) {
    const r = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async updateUserStatus(id, status) {
    const r = await pool.query('UPDATE users SET status = $1, last_seen = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *', [status, id]);
    return r.rows[0] || null;
  },

  async getUserGCs(userId) {
    const r = await pool.query(
      'SELECT gc.*, COUNT(gm.user_id) as member_count FROM group_chats gc INNER JOIN gc_members gm ON gc.id = gm.gc_id WHERE gm.user_id = $1 GROUP BY gc.id ORDER BY gc.name',
      [userId]
    );
    return r.rows.map(row => ({ ...row, member_count: parseInt(row.member_count, 10) }));
  },

  async isMember(gcId, userId) {
    const r = await pool.query('SELECT 1 FROM gc_members WHERE gc_id = $1 AND user_id = $2', [gcId, userId]);
    return r.rows.length > 0;
  },

  async createMessage(id, data) {
    const r = await pool.query(
      'INSERT INTO messages (id, gc_id, dm_conversation_id, sender_id, content, type, attachment_url, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [id, data.gc_id || null, data.dm_conversation_id || null, data.sender_id, data.content, data.type || 'text', data.attachment_url || null, data.reply_to_id || null]
    );
    return r.rows[0];
  },

  async getDMById(id) {
    const r = await pool.query('SELECT * FROM dm_conversations WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async getDMConversation(u1, u2) {
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    const r = await pool.query('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [a, b]);
    return r.rows[0] || null;
  },

  async joinVoice(gcId, userId) {
    await pool.query('DELETE FROM voice_sessions WHERE user_id = $1', [userId]);
    const id = generateId();
    const r = await pool.query('INSERT INTO voice_sessions (id, gc_id, user_id) VALUES ($1,$2,$3) RETURNING *', [id, gcId, userId]);
    return r.rows[0];
  },

  async leaveVoice(gcId, userId) {
    await pool.query('DELETE FROM voice_sessions WHERE gc_id = $1 AND user_id = $2', [gcId, userId]);
  },

  async getVoiceParticipants(gcId) {
    const r = await pool.query(
      `SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.gc_id = $1 ORDER BY vs.joined_at`,
      [gcId]
    );
    return r.rows.map(row => ({
      id: row.id, gc_id: row.gc_id, user_id: row.user_id, joined_at: ts(row.joined_at),
      user: { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.ucreated_at), updated_at: ts(row.uupdated_at) }
    }));
  },

  async getUserVoiceSession(userId) {
    const r = await pool.query(
      `SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.user_id = $1`,
      [userId]
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { id: row.id, gc_id: row.gc_id, user_id: row.user_id, joined_at: ts(row.joined_at), user: { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.ucreated_at), updated_at: ts(row.uupdated_at) } };
  },

  async addMember(gcId, userId, role = 'member') {
    const id = generateId();
    const r = await pool.query('INSERT INTO gc_members (id, gc_id, user_id, role) VALUES ($1,$2,$3,$4) RETURNING *', [id, gcId, userId, role]);
    return r.rows[0];
  },

  async removeMember(gcId, userId) {
    await pool.query('DELETE FROM gc_members WHERE gc_id = $1 AND user_id = $2', [gcId, userId]);
  },

  async banUser(gcId, userId, reason) {
    const id = generateId();
    await pool.query('INSERT INTO gc_bans (id, gc_id, user_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (gc_id, user_id) DO UPDATE SET reason = EXCLUDED.reason', [id, gcId, userId, reason || null]);
  },

  async updateGC(id, data) {
    const fields = []; const values = []; let i = 1;
    if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
    if (data.icon_url !== undefined) { fields.push(`icon_url = $${i++}`); values.push(data.icon_url); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    fields.push(`updated_at = NOW()`); values.push(id);
    const r = await pool.query(`UPDATE group_chats SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return r.rows[0];
  },

  async getGCById(id) {
    const r = await pool.query('SELECT * FROM group_chats WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  async getFriends(userId) {
    const r = await pool.query(
      `SELECT u.* FROM users u INNER JOIN friend_requests fr ON ((fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.receiver_id = $1 AND fr.sender_id = u.id)) WHERE fr.status = 'accepted' ORDER BY u.display_name`,
      [userId]
    );
    return r.rows;
  },

  async sendFriendRequest(senderId, receiverId) {
    const id = generateId();
    const r = await pool.query('INSERT INTO friend_requests (id, sender_id, receiver_id) VALUES ($1,$2,$3) RETURNING *', [id, senderId, receiverId]);
    return r.rows[0];
  },

  async acceptFriendRequest(id) {
    await pool.query("UPDATE friend_requests SET status = 'accepted' WHERE id = $1", [id]);
  },

  async declineFriendRequest(id) {
    await pool.query("UPDATE friend_requests SET status = 'declined' WHERE id = $1", [id]);
  },

  async addEmoji(gcId, name, imageUrl, uploadedBy) {
    const id = generateId();
    const r = await pool.query('INSERT INTO custom_emojis (id, gc_id, name, image_url, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, gcId, name, imageUrl, uploadedBy]);
    return r.rows[0];
  },

  async removeEmoji(emojiId) {
    await pool.query('DELETE FROM custom_emojis WHERE id = $1', [emojiId]);
  },

  async getEmojiById(emojiId) {
    const r = await pool.query('SELECT * FROM custom_emojis WHERE id = $1', [emojiId]);
    return r.rows[0] || null;
  },

  get raw() { return pool; },
};

// ─── Server Setup ───────────────────────────────────────────────────────────

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const socketToUser = new Map();
const userToSocket = new Map();
const PORT = process.env.PORT || 3003;

function getUserId(socket) { return socketToUser.get(socket.id); }
function getSocketByUser(userId) {
  const socketId = userToSocket.get(userId);
  if (!socketId) return undefined;
  return io.sockets.sockets.get(socketId);
}
function emitToUser(userId, event, data) {
  io.to(`user:${userId}`).emit(event, { ...data, timestamp: now() });
}

// ─── Internal HTTP API (port 3004) ──────────────────────────────────────────

const internalHttpServer = createServer((req, res) => {
  if (!req.url?.startsWith('/api/internal/')) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  let body = '';
  req.on('data', (chunk) => { body += chunk.toString(); });
  req.on('end', async () => {
    if (res.writableEnded) return;
    try {
      const data = JSON.parse(body || '{}');

      if (req.url === '/api/internal/message-deleted') {
        const { messageId, gcId, dmConversationId } = data;
        const room = gcId ? `gc:${gcId}` : dmConversationId ? `dm:${dmConversationId}` : null;
        if (room) io.to(room).emit('message:deleted', { messageId, gcId, dmConversationId, timestamp: now() });
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } else if (req.url === '/api/internal/message-edited') {
        const { messageId, gcId, dmConversationId, newContent, editedAt, senderId } = data;
        const room = gcId ? `gc:${gcId}` : dmConversationId ? `dm:${dmConversationId}` : null;
        if (room) io.to(room).emit('message:edited', { messageId, newContent, editedAt, senderId, gcId, dmConversationId, timestamp: now() });
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } else if (req.url === '/api/internal/dm-conversation-created') {
        const { conversationId, user1Id, user2Id, creatorId, otherUser, creatorUser } = data;
        const recipientId = creatorId === user1Id ? user2Id : user1Id;
        const creatorSocket = getSocketByUser(creatorId);
        if (creatorSocket) creatorSocket.join(`dm:${conversationId}`);
        const recipientSocket = getSocketByUser(recipientId);
        if (recipientSocket) recipientSocket.join(`dm:${conversationId}`);
        io.to(`user:${recipientId}`).emit('dm:conversation:new', {
          id: conversationId, user1_id: user1Id, user2_id: user2Id,
          other_user: creatorUser || otherUser, timestamp: now(),
        });
        console.log(`[dm-conversation-created] Notified ${recipientId}`);
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404); res.end('Not found');
      }
    } catch (err) {
      console.error('[internal-api] Error:', err);
      if (!res.writableEnded) { res.writeHead(500); res.end('Internal error'); }
    }
  });
});

internalHttpServer.listen(3004, '0.0.0.0', () => {
  console.log(`[chat-service] Internal API on port 3004`);
});

// ─── Socket.io Connection Handler ───────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[socket] Connected: ${socket.id}`);

  // AUTH
  socket.on('auth', async (payload) => {
    try {
      const { userId } = payload;
      const user = await db.getUserById(userId);
      if (!user) { socket.emit('auth:error', { message: 'User not found' }); socket.disconnect(); return; }

      socketToUser.set(socket.id, userId);
      userToSocket.set(userId, socket.id);
      await db.updateUserStatus(userId, 'online');

      const gcList = await db.getUserGCs(userId);
      for (const gc of gcList) socket.join(`gc:${gc.id}`);
      socket.join(`user:${userId}`);

      const dmConversations = await pool.query('SELECT id FROM dm_conversations WHERE user1_id = $1 OR user2_id = $1', [userId]);
      for (const dm of dmConversations.rows) socket.join(`dm:${dm.id}`);

      socket.emit('auth:success', { user: sanitizeUser(user), timestamp: now() });

      const presence = { userId, status: 'online', ...sanitizeUser(user), timestamp: now() };
      for (const gc of gcList) socket.to(`gc:${gc.id}`).emit('presence:update', presence);
      const friends = await db.getFriends(userId);
      for (const f of friends) emitToUser(f.id, 'presence:update', presence);

      console.log(`[auth] ${user.username} (${userId}) authenticated, joined ${gcList.length} GCs`);
    } catch (err) {
      console.error('[auth] Error:', err);
      socket.emit('auth:error', { message: 'Authentication failed' });
    }
  });

  // MESSAGING
  socket.on('message:send', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) { socket.emit('error', { message: 'Not authenticated' }); return; }
      const user = await db.getUserById(userId);
      if (!user) return;
      const { gcId, dmConversationId, content, type, attachmentUrl, replyToId } = payload;

      if (gcId) {
        if (!await db.isMember(gcId, userId)) { socket.emit('error', { message: 'Not a member' }); return; }
      } else if (dmConversationId) {
        const dmConv = (await pool.query('SELECT 1 FROM dm_conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)', [dmConversationId, userId])).rows[0];
        if (!dmConv) { socket.emit('error', { message: 'Not a participant' }); return; }
        socket.join(`dm:${dmConversationId}`);
      } else { socket.emit('error', { message: 'Must specify gcId or dmConversationId' }); return; }

      const messageId = generateId();
      const message = await db.createMessage(messageId, { gc_id: gcId, dm_conversation_id: dmConversationId, sender_id: userId, content, type: type || 'text', attachment_url: attachmentUrl, reply_to_id: replyToId });

      const fullMessage = { ...message, sender: { id: user.id, username: user.username, displayName: user.display_name, avatarUrl: user.avatar_url }, timestamp: now() };

      if (gcId) {
        io.to(`gc:${gcId}`).emit('message:new', fullMessage);
      } else if (dmConversationId) {
        const dmConv = (await pool.query('SELECT user1_id, user2_id FROM dm_conversations WHERE id = $1', [dmConversationId])).rows[0];
        if (dmConv) {
          const otherUserId = dmConv.user1_id === userId ? dmConv.user2_id : dmConv.user1_id;
          const otherSocket = getSocketByUser(otherUserId);
          if (otherSocket) otherSocket.join(`dm:${dmConversationId}`);
        }
        io.to(`dm:${dmConversationId}`).emit('message:new', fullMessage);
      }
    } catch (err) { console.error('[message:send] Error:', err); }
  });

  // TYPING
  socket.on('message:typing', (payload) => {
    const userId = getUserId(socket);
    if (!userId) return;
    const typingPayload = { userId, gcId: payload.gcId || null, dmConversationId: payload.dmConversationId || null, isTyping: payload.isTyping, timestamp: now() };
    if (payload.gcId) socket.to(`gc:${payload.gcId}`).emit('message:typing', typingPayload);
    else if (payload.dmConversationId) socket.to(`dm:${payload.dmConversationId}`).emit('message:typing', typingPayload);
  });

  // PRESENCE
  socket.on('presence:change', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const user = await db.getUserById(userId);
      if (!user) return;
      const { status } = payload;
      const gcList = await db.getUserGCs(userId);
      if (status === 'invisible') {
        await db.updateUserStatus(userId, 'offline');
        const offlinePresence = { userId, status: 'offline', ...sanitizeUser(user), timestamp: now() };
        for (const gc of gcList) socket.to(`gc:${gc.id}`).emit('presence:update', offlinePresence);
        const friends = await db.getFriends(userId);
        for (const f of friends) emitToUser(f.id, 'presence:update', offlinePresence);
      } else {
        await db.updateUserStatus(userId, status);
        const presence = { userId, status, ...sanitizeUser(user), timestamp: now() };
        for (const gc of gcList) socket.to(`gc:${gc.id}`).emit('presence:update', presence);
        const friends = await db.getFriends(userId);
        for (const f of friends) emitToUser(f.id, 'presence:update', presence);
      }
      socket.emit('presence:updated', { status, timestamp: now() });
    } catch (err) { console.error('[presence:change] Error:', err); }
  });

  // PROFILE UPDATE
  socket.on('user:profile:update', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId || userId !== payload.userId) return;
      const updates = []; const params = []; let paramIdx = 1;
      if (payload.displayName !== undefined) { updates.push(`display_name = $${paramIdx++}`); params.push(payload.displayName); }
      if (payload.bio !== undefined) { updates.push(`bio = $${paramIdx++}`); params.push(payload.bio); }
      if (payload.customStatus !== undefined) { updates.push(`custom_status = $${paramIdx++}`); params.push(payload.customStatus); }
      if (payload.avatarUrl !== undefined) { updates.push(`avatar_url = $${paramIdx++}`); params.push(payload.avatarUrl); }
      if (payload.bannerUrl !== undefined) { updates.push(`banner_url = $${paramIdx++}`); params.push(payload.bannerUrl); }
      if (updates.length > 0) { updates.push("updated_at = NOW()"); params.push(userId); await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params); }
      const gcList = await db.getUserGCs(userId);
      const broadcastData = { userId, ...payload, timestamp: now() };
      for (const gc of gcList) socket.to(`gc:${gc.id}`).emit('user:profile:update', broadcastData);
      const dmConvs = await pool.query('SELECT id FROM dm_conversations WHERE user1_id = $1 OR user2_id = $1', [userId]);
      for (const dm of dmConvs.rows) socket.to(`dm:${dm.id}`).emit('user:profile:update', broadcastData);
    } catch (err) { console.error('[user:profile:update] Error:', err); }
  });

  // VOICE CHANNEL
  socket.on('vc:join', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const user = await db.getUserById(userId);
      if (!user) return;
      const { gcId } = payload;
      if (!await db.isMember(gcId, userId)) { socket.emit('error', { message: 'Not a member' }); return; }
      await db.joinVoice(gcId, userId);
      socket.join(`vc:${gcId}`);
      socket.to(`gc:${gcId}`).emit('vc:user-joined', { userId, username: user.username, displayName: user.display_name, avatarUrl: user.avatar_url, gcId, timestamp: now() });
      const participants = await db.getVoiceParticipants(gcId);
      socket.emit('vc:participants', { gcId, participants, timestamp: now() });
      console.log(`[vc] ${user.username} joined VC in gc:${gcId}`);
    } catch (err) { console.error('[vc:join] Error:', err); }
  });

  socket.on('vc:leave', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const user = await db.getUserById(userId);
      if (!user) return;
      const { gcId } = payload;
      await db.leaveVoice(gcId, userId);
      socket.leave(`vc:${gcId}`);
      io.to(`gc:${gcId}`).emit('vc:user-left', { userId, username: user.username, displayName: user.display_name, gcId, timestamp: now() });
      socket.to(`vc:${gcId}`).emit('vc:peer-left', { userId, gcId, timestamp: now() });
      console.log(`[vc] ${user.username} left VC in gc:${gcId}`);
    } catch (err) { console.error('[vc:leave] Error:', err); }
  });

  socket.on('vc:signal', (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      io.to(`user:${payload.targetUserId}`).emit('vc:signal', { fromUserId: userId, gcId: payload.gcId, signal: payload.signal });
    } catch (err) { console.error('[vc:signal] Error:', err); }
  });

  // GC MEMBER MANAGEMENT
  socket.on('gc:member:add', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { gcId, userId: targetUserId, role } = payload;
      if (!await db.isMember(gcId, userId)) { socket.emit('error', { message: 'Not a member' }); return; }
      await db.addMember(gcId, targetUserId, role || 'member');
      const targetUser = await db.getUserById(targetUserId);
      const targetSocket = getSocketByUser(targetUserId);
      if (targetSocket) targetSocket.join(`gc:${gcId}`);
      const gc = await db.getGCById(gcId);
      const memberData = { gcId, userId: targetUserId, role: role || 'member', user: sanitizeUser(targetUser), gc, timestamp: now() };
      io.to(`gc:${gcId}`).emit('gc:member:added', memberData);
      io.to(`user:${targetUserId}`).emit('gc:member:added', memberData);
      console.log(`[gc] User ${targetUserId} added to gc:${gcId}`);
    } catch (err) { console.error('[gc:member:add] Error:', err); }
  });

  socket.on('gc:member:remove', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { gcId, userId: targetUserId } = payload;
      if (!await db.isMember(gcId, userId)) { socket.emit('error', { message: 'Not a member' }); return; }
      await db.removeMember(gcId, targetUserId);
      await db.leaveVoice(gcId, targetUserId);
      io.to(`gc:${gcId}`).emit('gc:member:removed', { gcId, userId: targetUserId, timestamp: now() });
      const targetSocket = getSocketByUser(targetUserId);
      if (targetSocket) { targetSocket.leave(`gc:${gcId}`); targetSocket.leave(`vc:${gcId}`); }
    } catch (err) { console.error('[gc:member:remove] Error:', err); }
  });

  socket.on('gc:member:ban', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { gcId, userId: targetUserId, reason } = payload;
      if (!await db.isMember(gcId, userId)) return;
      await db.banUser(gcId, targetUserId, reason);
      await db.removeMember(gcId, targetUserId);
      await db.leaveVoice(gcId, targetUserId);
      io.to(`gc:${gcId}`).emit('gc:member:banned', { gcId, userId: targetUserId, reason: reason || null, timestamp: now() });
      const targetSocket = getSocketByUser(targetUserId);
      if (targetSocket) { targetSocket.leave(`gc:${gcId}`); targetSocket.leave(`vc:${gcId}`); targetSocket.emit('gc:banned', { gcId, reason: reason || null }); }
    } catch (err) { console.error('[gc:member:ban] Error:', err); }
  });

  socket.on('gc:update', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { gcId, name, iconUrl, description } = payload;
      if (!await db.isMember(gcId, userId)) return;
      const updatedGC = await db.updateGC(gcId, { name, icon_url: iconUrl, description });
      io.to(`gc:${gcId}`).emit('gc:updated', { gcId, gc: { id: updatedGC.id, name: updatedGC.name, iconUrl: updatedGC.icon_url, description: updatedGC.description, ownerId: updatedGC.owner_id }, timestamp: now() });
    } catch (err) { console.error('[gc:update] Error:', err); }
  });

  // FRIEND REQUESTS
  socket.on('friend:request:send', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const user = await db.getUserById(userId);
      if (!user) return;
      const { receiverId } = payload;
      const request = await db.sendFriendRequest(userId, receiverId);
      emitToUser(receiverId, 'friend:request:received', { id: request.id, senderId: userId, sender: sanitizeUser(user), receiverId, status: 'pending', createdAt: request.created_at, timestamp: now() });
      socket.emit('friend:request:sent', { id: request.id, senderId: userId, sender: sanitizeUser(user), receiverId, status: 'pending', createdAt: request.created_at, timestamp: now() });
    } catch (err) { console.error('[friend:request:send] Error:', err); }
  });

  socket.on('friend:request:accept', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { requestId } = payload;
      const req = (await pool.query('SELECT * FROM friend_requests WHERE id = $1', [requestId])).rows[0];
      if (!req) { socket.emit('error', { message: 'Friend request not found' }); return; }
      await db.acceptFriendRequest(requestId);
      emitToUser(req.sender_id, 'friend:accepted', { id: requestId, senderId: req.sender_id, receiverId: req.receiver_id, status: 'accepted', timestamp: now() });
      emitToUser(req.receiver_id, 'friend:accepted', { id: requestId, senderId: req.sender_id, receiverId: req.receiver_id, status: 'accepted', timestamp: now() });
    } catch (err) { console.error('[friend:request:accept] Error:', err); }
  });

  socket.on('friend:request:decline', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { requestId } = payload;
      const req = (await pool.query('SELECT * FROM friend_requests WHERE id = $1', [requestId])).rows[0];
      if (!req) { socket.emit('error', { message: 'Friend request not found' }); return; }
      await db.declineFriendRequest(requestId);
      emitToUser(req.sender_id, 'friend:declined', { id: requestId, senderId: req.sender_id, receiverId: req.receiver_id, status: 'declined', timestamp: now() });
      socket.emit('friend:request:declined', { id: requestId, senderId: req.sender_id, receiverId: req.receiver_id, status: 'declined', timestamp: now() });
    } catch (err) { console.error('[friend:request:decline] Error:', err); }
  });

  // CUSTOM EMOJIS
  socket.on('emoji:add', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { gcId, name, imageUrl } = payload;
      if (!await db.isMember(gcId, userId)) return;
      const emoji = await db.addEmoji(gcId, name, imageUrl, userId);
      io.to(`gc:${gcId}`).emit('emoji:added', { id: emoji.id, gcId, name: emoji.name, imageUrl: emoji.image_url, uploadedBy: userId, createdAt: emoji.created_at, timestamp: now() });
    } catch (err) { console.error('[emoji:add] Error:', err); }
  });

  socket.on('emoji:remove', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { gcId, emojiId } = payload;
      if (!await db.isMember(gcId, userId)) return;
      const emoji = await db.getEmojiById(emojiId);
      await db.removeEmoji(emojiId);
      io.to(`gc:${gcId}`).emit('emoji:removed', { id: emojiId, gcId, timestamp: now() });
    } catch (err) { console.error('[emoji:remove] Error:', err); }
  });

  // DM VOICE CALLS
  socket.on('dm:call', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { dmConversationId } = payload;
      const user = await db.getUserById(userId);
      if (!user) return;
      const dm = await db.getDMById(dmConversationId);
      if (!dm) return;
      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
      io.to(`user:${otherUserId}`).emit('dm:call:incoming', { dmConversationId, callerId: userId, callerName: user.display_name || user.username, callerAvatar: user.avatar_url, timestamp: now() });
      console.log(`[dm:call] ${user.username} calling ${otherUserId}`);
    } catch (err) { console.error('[dm:call] Error:', err); }
  });

  socket.on('dm:call:answer', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { dmConversationId } = payload;
      const user = await db.getUserById(userId);
      if (!user) return;
      const dm = await db.getDMById(dmConversationId);
      if (!dm) return;
      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
      const otherUser = await db.getUserById(otherUserId);
      if (!otherUser) return;
      const connectedData = { dmConversationId, startedAt: now() };
      socket.emit('dm:call:connected', { ...connectedData, otherUserId, otherName: otherUser.display_name || otherUser.username, otherAvatar: otherUser.avatar_url });
      emitToUser(otherUserId, 'dm:call:connected', { ...connectedData, otherUserId: userId, otherName: user.display_name || user.username, otherAvatar: user.avatar_url });
      console.log(`[dm:call:answer] ${user.username} accepted call`);
    } catch (err) { console.error('[dm:call:answer] Error:', err); }
  });

  socket.on('dm:call:decline', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { dmConversationId } = payload;
      const dm = await db.getDMById(dmConversationId);
      if (!dm) return;
      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
      emitToUser(otherUserId, 'dm:call:ended', { dmConversationId, reason: 'declined', endedBy: userId });
    } catch (err) { console.error('[dm:call:decline] Error:', err); }
  });

  socket.on('dm:call:hangup', async (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      const { dmConversationId } = payload;
      const dm = await db.getDMById(dmConversationId);
      if (!dm) return;
      const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
      emitToUser(otherUserId, 'dm:call:ended', { dmConversationId, reason: 'hungup', endedBy: userId });
    } catch (err) { console.error('[dm:call:hangup] Error:', err); }
  });

  socket.on('dm:call:signal', (payload) => {
    try {
      const userId = getUserId(socket);
      if (!userId) return;
      io.to(`user:${payload.targetUserId}`).emit('dm:call:signal', { fromUserId: userId, dmConversationId: payload.dmConversationId, signal: payload.signal });
    } catch (err) { console.error('[dm:call:signal] Error:', err); }
  });

  // DISCONNECT
  socket.on('disconnect', async () => {
    try {
      const userId = socketToUser.get(socket.id);
      if (!userId) { console.log(`[disconnect] Unknown: ${socket.id}`); return; }
      const user = await db.getUserById(userId);
      await db.updateUserStatus(userId, 'offline');
      socketToUser.delete(socket.id);
      userToSocket.delete(userId);
      const gcList = await db.getUserGCs(userId);
      if (user) {
        const presence = { userId, status: 'offline', ...sanitizeUser(user), timestamp: now() };
        for (const gc of gcList) io.to(`gc:${gc.id}`).emit('presence:update', presence);
        const friends = await db.getFriends(userId);
        for (const f of friends) emitToUser(f.id, 'presence:update', presence);
      }
      const voiceSession = await db.getUserVoiceSession(userId);
      if (voiceSession) {
        await db.leaveVoice(voiceSession.gc_id, userId);
        io.to(`gc:${voiceSession.gc_id}`).emit('vc:user-left', { userId, username: user?.username, displayName: user?.display_name, gcId: voiceSession.gc_id, timestamp: now() });
      }
      console.log(`[disconnect] ${user?.username || userId} disconnected`);
    } catch (err) { console.error('[disconnect] Error:', err); }
  });

  socket.on('error', (error) => { console.error(`[socket:error] ${socket.id}:`, error); });
});

// ─── Start Server ───────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[chat-service] Socket.io server running on 0.0.0.0:${PORT}`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[chat-service] Received ${signal}, shutting down...`);
  io.close();
  internalHttpServer.close();
  httpServer.close(() => { console.log('[chat-service] Closed'); process.exit(0); });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
