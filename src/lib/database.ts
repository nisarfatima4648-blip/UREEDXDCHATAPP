// ─── Supabase PostgreSQL Database Layer ─────────────────────────────────────
// Uses pg (node-postgres) for Vercel serverless + Supabase Postgres.
// ALL methods are async — callers must use `await`.
// Tables are created via prisma/supabase-sql-editor.sql

import { Pool } from 'pg';

// =============================================================================
// TypeScript Interfaces
// =============================================================================

export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string;
  status: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
  custom_status: string | null;
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface GroupChat {
  id: string;
  name: string;
  icon_url: string | null;
  description: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
}

export interface GCMember {
  id: string;
  gc_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  can_kick: boolean;
  can_ban: boolean;
  can_add_members: boolean;
  can_manage_emojis: boolean;
  joined_at: string;
  user?: User;
}

export interface Message {
  id: string;
  gc_id: string | null;
  dm_conversation_id: string | null;
  sender_id: string;
  content: string;
  type: 'text' | 'system' | 'image' | 'file' | 'video';
  attachment_url: string | null;
  reply_to_id: string | null;
  created_at: string;
  edited_at?: string | null;
  sender?: User;
}

export interface DMConversation {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
  other_user?: User;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  sender?: User;
}

export interface Block {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface CustomEmoji {
  id: string;
  gc_id: string;
  name: string;
  image_url: string;
  uploaded_by: string;
  created_at: string;
}

export interface VoiceSession {
  id: string;
  gc_id: string;
  user_id: string;
  joined_at: string;
  user?: User;
}

export interface GCBan {
  id: string;
  gc_id: string;
  user_id: string;
  reason: string | null;
  created_at: string;
}

export interface UpdateUserData {
  display_name?: string;
  avatar_url?: string | null;
  banner_url?: string | null;
  bio?: string;
  status?: User['status'];
  custom_status?: string | null;
}

export interface UpdateGCData {
  name?: string;
  icon_url?: string | null;
  description?: string;
}

export interface CreateMessageData {
  gc_id?: string | null;
  dm_conversation_id?: string | null;
  sender_id: string;
  content: string;
  type?: Message['type'];
  attachment_url?: string | null;
  reply_to_id?: string | null;
}

export interface UpdateMemberPermissions {
  can_kick?: boolean;
  can_ban?: boolean;
  can_add_members?: boolean;
  can_manage_emojis?: boolean;
}

// =============================================================================
// Helper
// =============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function ts(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

// =============================================================================
// Database Class (async — uses pg Pool)
// =============================================================================

class Database {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  private async q(text: string, params?: unknown[]) {
    return this.pool.query(text, params as any[]);
  }
  private async qOne<T = any>(text: string, params?: unknown[]): Promise<T | null> {
    const res = await this.pool.query(text, params as any[]);
    return (res.rows[0] as T) || null;
  }
  private async qAll<T = any>(text: string, params?: unknown[]): Promise<T[]> {
    const res = await this.pool.query(text, params as any[]);
    return res.rows as T[];
  }

  // ── Users ────────────────────────────────────────────────────────────────

  async createUser(id: string, username: string, displayName: string, email: string): Promise<User> {
    return this.mapUserRow(await this.qOne(
      'INSERT INTO users (id, username, display_name, email) VALUES ($1,$2,$3,$4) RETURNING *',
      [id, username, displayName, email]
    ));
  }
  async getUserById(id: string): Promise<User | null> {
    return this.mapUserRow(await this.qOne('SELECT * FROM users WHERE id = $1', [id]));
  }
  async getUserByUsername(username: string): Promise<User | null> {
    return this.mapUserRow(await this.qOne('SELECT * FROM users WHERE username = $1', [username]));
  }
  async updateUser(id: string, data: UpdateUserData): Promise<User> {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.display_name !== undefined) { fields.push(`display_name = $${i++}`); values.push(data.display_name); }
    if (data.avatar_url !== undefined) { fields.push(`avatar_url = $${i++}`); values.push(data.avatar_url); }
    if (data.banner_url !== undefined) { fields.push(`banner_url = $${i++}`); values.push(data.banner_url); }
    if (data.bio !== undefined) { fields.push(`bio = $${i++}`); values.push(data.bio); }
    if (data.status !== undefined) { fields.push(`status = $${i++}`); values.push(data.status); }
    if (data.custom_status !== undefined) { fields.push(`custom_status = $${i++}`); values.push(data.custom_status); }
    fields.push(`updated_at = NOW()`); values.push(id);
    return this.mapUserRow(await this.qOne(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values));
  }
  async updateUserStatus(id: string, status: User['status']): Promise<User> {
    return this.mapUserRow(await this.qOne(
      'UPDATE users SET status = $1, last_seen = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    ));
  }
  async deleteUser(id: string): Promise<void> {
    await this.q('DELETE FROM voice_sessions WHERE user_id = $1', [id]);
    await this.q('DELETE FROM gc_bans WHERE user_id = $1', [id]);
    await this.q('DELETE FROM custom_emojis WHERE uploaded_by = $1', [id]);
    await this.q('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1', [id, id]);
    await this.q('DELETE FROM messages WHERE sender_id = $1', [id]);
    await this.q('DELETE FROM dm_conversations WHERE user1_id = $1 OR user2_id = $1', [id, id]);
    await this.q('DELETE FROM gc_members WHERE user_id = $1', [id]);
    await this.q('DELETE FROM friend_requests WHERE sender_id = $1 OR receiver_id = $1', [id, id]);
    const ownedGCs = await this.qAll<{ id: string }>('SELECT id FROM group_chats WHERE owner_id = $1', [id]);
    for (const gc of ownedGCs) {
      await this.q('DELETE FROM group_chats WHERE id = $1', [gc.id]);
    }
    await this.q('DELETE FROM users WHERE id = $1', [id]);
  }
  async searchUsers(query: string): Promise<User[]> {
    const rows = await this.qAll('SELECT * FROM users WHERE username LIKE $1 OR display_name LIKE $1 LIMIT 50', [`%${query}%`]);
    return rows.map(r => this.mapUserRow(r)!).filter(Boolean);
  }
  async getAllUsers(): Promise<User[]> {
    const rows = await this.qAll('SELECT * FROM users ORDER BY username');
    return rows.map(r => this.mapUserRow(r)!).filter(Boolean);
  }

  // ── Group Chats ──────────────────────────────────────────────────────────

  async createGC(id: string, name: string, ownerId: string, description?: string, iconUrl?: string): Promise<GroupChat> {
    return this.mapGCRow(await this.qOne(
      'INSERT INTO group_chats (id, name, description, icon_url, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, name, description || '', iconUrl || null, ownerId]
    ));
  }
  async getGCById(id: string): Promise<GroupChat | null> {
    const gc = this.mapGCRow(await this.qOne('SELECT * FROM group_chats WHERE id = $1', [id]));
    if (gc) { gc.member_count = await this.getMemberCount(id); return gc; }
    return null;
  }
  async getUserGCs(userId: string): Promise<GroupChat[]> {
    const rows = await this.qAll(
      'SELECT gc.*, COUNT(gm.user_id) as member_count FROM group_chats gc INNER JOIN gc_members gm ON gc.id = gm.gc_id WHERE gm.user_id = $1 GROUP BY gc.id ORDER BY gc.name',
      [userId]
    );
    return rows.map(r => this.mapGCRow(r)!).filter(Boolean);
  }
  async updateGC(id: string, data: UpdateGCData): Promise<GroupChat> {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
    if (data.icon_url !== undefined) { fields.push(`icon_url = $${i++}`); values.push(data.icon_url); }
    if (data.description !== undefined) { fields.push(`description = $${i++}`); values.push(data.description); }
    fields.push(`updated_at = NOW()`); values.push(id);
    return this.mapGCRow(await this.qOne(`UPDATE group_chats SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values));
  }
  async deleteGC(id: string): Promise<void> { await this.q('DELETE FROM group_chats WHERE id = $1', [id]); }

  // ── GC Members ───────────────────────────────────────────────────────────

  async addMember(gcId: string, userId: string, role: GCMember['role'] = 'member'): Promise<GCMember> {
    return this.mapMemberRow(await this.qOne(
      'INSERT INTO gc_members (id, gc_id, user_id, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [generateId(), gcId, userId, role]
    ));
  }
  async removeMember(gcId: string, userId: string): Promise<void> {
    await this.q('DELETE FROM gc_members WHERE gc_id = $1 AND user_id = $2', [gcId, userId]);
  }
  async getMember(gcId: string, userId: string): Promise<GCMember | null> {
    return this.mapMemberRowWithUser(await this.qOne(
      `SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
       FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = $1 AND gm.user_id = $2`,
      [gcId, userId]
    ));
  }
  async getGCMembers(gcId: string): Promise<GCMember[]> {
    const rows = await this.qAll(
      `SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
       FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = $1
       ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at`,
      [gcId]
    );
    return rows.map(r => this.mapMemberRowWithUser(r)!).filter(Boolean);
  }
  async updateMemberRole(gcId: string, userId: string, role: GCMember['role']): Promise<GCMember> {
    return this.mapMemberRow(await this.qOne('UPDATE gc_members SET role = $1 WHERE gc_id = $2 AND user_id = $3 RETURNING *', [role, gcId, userId]));
  }
  async updateMemberPermissions(gcId: string, userId: string, perms: UpdateMemberPermissions): Promise<GCMember> {
    const fields: string[] = []; const values: unknown[] = []; let i = 1;
    if (perms.can_kick !== undefined) { fields.push(`can_kick = $${i++}`); values.push(perms.can_kick); }
    if (perms.can_ban !== undefined) { fields.push(`can_ban = $${i++}`); values.push(perms.can_ban); }
    if (perms.can_add_members !== undefined) { fields.push(`can_add_members = $${i++}`); values.push(perms.can_add_members); }
    if (perms.can_manage_emojis !== undefined) { fields.push(`can_manage_emojis = $${i++}`); values.push(perms.can_manage_emojis); }
    values.push(gcId, userId);
    return this.mapMemberRow(await this.qOne(`UPDATE gc_members SET ${fields.join(', ')} WHERE gc_id = $${i++} AND user_id = $${i} RETURNING *`, values));
  }
  async transferOwnership(gcId: string, newOwnerId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE gc_members SET role = 'admin' WHERE gc_id = $1 AND role = 'owner'`, [gcId]);
      await client.query(`UPDATE gc_members SET role = 'owner' WHERE gc_id = $1 AND user_id = $2`, [gcId, newOwnerId]);
      await client.query(`UPDATE group_chats SET owner_id = $1, updated_at = NOW() WHERE id = $2`, [newOwnerId, gcId]);
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  }
  async isMember(gcId: string, userId: string): Promise<boolean> {
    return !!(await this.qOne('SELECT 1 FROM gc_members WHERE gc_id = $1 AND user_id = $2', [gcId, userId]));
  }
  async getMemberCount(gcId: string): Promise<number> {
    const r = await this.qOne<{ count: string }>('SELECT COUNT(*) as count FROM gc_members WHERE gc_id = $1', [gcId]);
    return parseInt(r?.count || '0', 10);
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  async createMessage(id: string, data: CreateMessageData): Promise<Message> {
    return this.mapMessageRow(await this.qOne(
      'INSERT INTO messages (id, gc_id, dm_conversation_id, sender_id, content, type, attachment_url, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [id, data.gc_id || null, data.dm_conversation_id || null, data.sender_id, data.content, data.type || 'text', data.attachment_url || null, data.reply_to_id || null]
    ));
  }
  async getGCMessages(gcId: string, limit = 50, before?: string): Promise<Message[]> {
    const sql = before
      ? `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT $3`
      : `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = $1 ORDER BY m.created_at DESC LIMIT $2`;
    const rows = await this.qAll(sql, before ? [gcId, before, limit] : [gcId, limit]);
    return rows.map(r => this.mapMessageRow(r)!).filter(Boolean);
  }
  async getDMMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
    const sql = before
      ? `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT $3`
      : `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = $1 ORDER BY m.created_at DESC LIMIT $2`;
    const rows = await this.qAll(sql, before ? [conversationId, before, limit] : [conversationId, limit]);
    return rows.map(r => this.mapMessageRow(r)!).filter(Boolean);
  }
  async getMessageById(id: string): Promise<Message | null> {
    return this.mapMessageRow(await this.qOne(
      `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.id = $1`,
      [id]
    ));
  }
  async deleteMessage(id: string): Promise<void> { await this.q('DELETE FROM messages WHERE id = $1', [id]); }
  async updateMessageContent(id: string, content: string): Promise<Message | null> {
    await this.q('UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2', [content, id]);
    return this.getMessageById(id);
  }

  // ── DM Conversations ─────────────────────────────────────────────────────

  async getOrCreateDM(user1Id: string, user2Id: string): Promise<DMConversation> {
    const [u1, u2] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
    const existing = await this.qOne('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [u1, u2]);
    if (existing) return this.mapDMRow(existing);
    return this.mapDMRow(await this.qOne('INSERT INTO dm_conversations (id, user1_id, user2_id) VALUES ($1,$2,$3) RETURNING *', [generateId(), u1, u2]));
  }
  async getDMConversation(u1: string, u2: string): Promise<DMConversation | null> {
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    return this.mapDMRow(await this.qOne('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [a, b]));
  }
  async getDMById(id: string): Promise<DMConversation | null> {
    return this.mapDMRow(await this.qOne('SELECT * FROM dm_conversations WHERE id = $1', [id]));
  }
  async getUserDMs(userId: string): Promise<DMConversation[]> {
    const rows = await this.qAll(
      `SELECT dc.*, u.id as ouid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as oucreated_at, u.updated_at as ouupdated_at FROM dm_conversations dc INNER JOIN users u ON (CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END) = u.id WHERE dc.user1_id = $1 OR dc.user2_id = $1 ORDER BY dc.created_at DESC`,
      [userId]
    );
    return rows.map(r => this.mapDMRowWithUser(r)!).filter(Boolean);
  }

  // ── Friends ──────────────────────────────────────────────────────────────

  async sendFriendRequest(senderId: string, receiverId: string): Promise<FriendRequest> {
    return this.mapFriendRequestRow(await this.qOne('INSERT INTO friend_requests (id, sender_id, receiver_id) VALUES ($1,$2,$3) RETURNING *', [generateId(), senderId, receiverId]));
  }
  async acceptFriendRequest(id: string): Promise<void> { await this.q("UPDATE friend_requests SET status = 'accepted' WHERE id = $1", [id]); }
  async declineFriendRequest(id: string): Promise<void> { await this.q("UPDATE friend_requests SET status = 'declined' WHERE id = $1", [id]); }
  async getPendingRequests(userId: string): Promise<FriendRequest[]> {
    const rows = await this.qAll(
      `SELECT fr.*, s.id as sid, s.username, s.display_name, s.email, s.avatar_url, s.banner_url, s.bio, s.status, s.custom_status, s.last_seen, s.created_at as screated_at, s.updated_at as supdated_at FROM friend_requests fr INNER JOIN users s ON fr.sender_id = s.id WHERE fr.receiver_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      [userId]
    );
    return rows.map(r => this.mapFriendRequestRowWithSender(r)!).filter(Boolean);
  }
  async getFriends(userId: string): Promise<User[]> {
    const rows = await this.qAll(
      `SELECT u.* FROM users u INNER JOIN friend_requests fr ON ((fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.receiver_id = $1 AND fr.sender_id = u.id)) WHERE fr.status = 'accepted' ORDER BY u.display_name`,
      [userId]
    );
    return rows.map(r => this.mapUserRow(r)!).filter(Boolean);
  }
  async removeFriend(userId: string, otherUserId: string): Promise<void> {
    await this.q('DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [userId, otherUserId]);
  }
  async areFriends(u1: string, u2: string): Promise<boolean> {
    return !!(await this.qOne(`SELECT 1 FROM friend_requests WHERE status = 'accepted' AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`, [u1, u2]));
  }

  // ── Blocks ───────────────────────────────────────────────────────────────

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.q('INSERT INTO blocks (id, blocker_id, blocked_id) VALUES ($1,$2,$3) ON CONFLICT (blocker_id, blocked_id) DO NOTHING', [generateId(), blockerId, blockedId]);
  }
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.q('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
  }
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    return !!(await this.qOne('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]));
  }
  async getBlockedUsers(userId: string): Promise<User[]> {
    const rows = await this.qAll('SELECT u.* FROM users u INNER JOIN blocks b ON b.blocked_id = u.id WHERE b.blocker_id = $1 ORDER BY u.display_name', [userId]);
    return rows.map(r => this.mapUserRow(r)!).filter(Boolean);
  }

  // ── Custom Emojis ────────────────────────────────────────────────────────

  async addEmoji(gcId: string, name: string, imageUrl: string, uploadedBy: string): Promise<CustomEmoji> {
    return this.mapEmojiRow(await this.qOne('INSERT INTO custom_emojis (id, gc_id, name, image_url, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [generateId(), gcId, name, imageUrl, uploadedBy]));
  }
  async removeEmoji(emojiId: string): Promise<void> { await this.q('DELETE FROM custom_emojis WHERE id = $1', [emojiId]); }
  async getGCEmojis(gcId: string): Promise<CustomEmoji[]> {
    const rows = await this.qAll('SELECT * FROM custom_emojis WHERE gc_id = $1 ORDER BY name', [gcId]);
    return rows.map(r => this.mapEmojiRow(r)!).filter(Boolean);
  }
  async getEmojiById(emojiId: string): Promise<CustomEmoji | null> {
    return this.mapEmojiRow(await this.qOne('SELECT * FROM custom_emojis WHERE id = $1', [emojiId]));
  }

  // ── Voice Sessions ───────────────────────────────────────────────────────

  async joinVoice(gcId: string, userId: string): Promise<VoiceSession> {
    await this.q('DELETE FROM voice_sessions WHERE user_id = $1', [userId]);
    return this.mapVoiceSessionRow(await this.qOne('INSERT INTO voice_sessions (id, gc_id, user_id) VALUES ($1,$2,$3) RETURNING *', [generateId(), gcId, userId]));
  }
  async leaveVoice(gcId: string, userId: string): Promise<void> {
    await this.q('DELETE FROM voice_sessions WHERE gc_id = $1 AND user_id = $2', [gcId, userId]);
  }
  async getVoiceParticipants(gcId: string): Promise<VoiceSession[]> {
    const rows = await this.qAll(
      `SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.gc_id = $1 ORDER BY vs.joined_at`,
      [gcId]
    );
    return rows.map(r => this.mapVoiceSessionRowWithUser(r)!).filter(Boolean);
  }
  async getUserVoiceSession(userId: string): Promise<VoiceSession | null> {
    return this.mapVoiceSessionRowWithUser(await this.qOne(
      `SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.user_id = $1`,
      [userId]
    ));
  }

  // ── GC Bans ──────────────────────────────────────────────────────────────

  async banUser(gcId: string, userId: string, reason?: string): Promise<void> {
    await this.q('INSERT INTO gc_bans (id, gc_id, user_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (gc_id, user_id) DO UPDATE SET reason = EXCLUDED.reason', [generateId(), gcId, userId, reason || null]);
  }
  async unbanUser(gcId: string, userId: string): Promise<void> {
    await this.q('DELETE FROM gc_bans WHERE gc_id = $1 AND user_id = $2', [gcId, userId]);
  }
  async isBanned(gcId: string, userId: string): Promise<boolean> {
    return !!(await this.qOne('SELECT 1 FROM gc_bans WHERE gc_id = $1 AND user_id = $2', [gcId, userId]));
  }

  // ── Raw pool access (for chat-service) ───────────────────────────────────
  get raw(): Pool { return this.pool; }

  // ── Row Mappers ──────────────────────────────────────────────────────────

  private mapUserRow(row: any): User | null {
    if (!row) return null;
    return { id: row.id, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.created_at), updated_at: ts(row.updated_at) };
  }
  private mapGCRow(row: any): GroupChat | null {
    if (!row) return null;
    return { id: row.id, name: row.name, icon_url: row.icon_url, description: row.description, owner_id: row.owner_id, created_at: ts(row.created_at), updated_at: ts(row.updated_at), member_count: row.member_count ? parseInt(row.member_count, 10) : undefined };
  }
  private mapMemberRow(row: any): GCMember | null {
    if (!row) return null;
    return { id: row.id, gc_id: row.gc_id, user_id: row.user_id, role: row.role, can_kick: row.can_kick, can_ban: row.can_ban, can_add_members: row.can_add_members, can_manage_emojis: row.can_manage_emojis, joined_at: ts(row.joined_at) };
  }
  private mapMemberRowWithUser(row: any): GCMember | null {
    if (!row) return null;
    return { ...this.mapMemberRow(row)!, user: { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.ucreated_at), updated_at: ts(row.uupdated_at) } };
  }
  private mapMessageRow(row: any): Message | null {
    if (!row) return null;
    return { id: row.id, gc_id: row.gc_id, dm_conversation_id: row.dm_conversation_id, sender_id: row.sender_id, content: row.content, type: row.type, attachment_url: row.attachment_url, reply_to_id: row.reply_to_id, created_at: ts(row.created_at), edited_at: row.edited_at ? ts(row.edited_at) : null, sender: row.uid ? { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.ucreated_at), updated_at: ts(row.uupdated_at) } : undefined };
  }
  private mapDMRow(row: any): DMConversation | null {
    if (!row) return null;
    return { id: row.id, user1_id: row.user1_id, user2_id: row.user2_id, created_at: ts(row.created_at) };
  }
  private mapDMRowWithUser(row: any): DMConversation | null {
    if (!row) return null;
    return { id: row.id, user1_id: row.user1_id, user2_id: row.user2_id, created_at: ts(row.created_at), other_user: { id: row.ouid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.oucreated_at), updated_at: ts(row.ouupdated_at) } };
  }
  private mapFriendRequestRow(row: any): FriendRequest | null {
    if (!row) return null;
    return { id: row.id, sender_id: row.sender_id, receiver_id: row.receiver_id, status: row.status, created_at: ts(row.created_at) };
  }
  private mapFriendRequestRowWithSender(row: any): FriendRequest | null {
    if (!row) return null;
    return { ...this.mapFriendRequestRow(row)!, sender: { id: row.sid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.screated_at), updated_at: ts(row.supdated_at) } };
  }
  private mapEmojiRow(row: any): CustomEmoji | null {
    if (!row) return null;
    return { id: row.id, gc_id: row.gc_id, name: row.name, image_url: row.image_url, uploaded_by: row.uploaded_by, created_at: ts(row.created_at) };
  }
  private mapVoiceSessionRow(row: any): VoiceSession | null {
    if (!row) return null;
    return { id: row.id, gc_id: row.gc_id, user_id: row.user_id, joined_at: ts(row.joined_at) };
  }
  private mapVoiceSessionRowWithUser(row: any): VoiceSession | null {
    if (!row) return null;
    return { ...this.mapVoiceSessionRow(row)!, user: { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: ts(row.last_seen), created_at: ts(row.ucreated_at), updated_at: ts(row.uupdated_at) } };
  }
}

// =============================================================================
// Singleton
// =============================================================================

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ureedxdchat';
export const db = new Database(DB_URL);
