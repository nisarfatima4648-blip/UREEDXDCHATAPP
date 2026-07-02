// ─── Supabase PostgreSQL Database Layer ─────────────────────────────────────
// Uses pg (node-postgres) for Vercel serverless + Supabase Postgres.
// ALL methods are async — callers must use `await`.

import { Pool } from 'pg';

// ─── TypeScript Interfaces ──────────────────────────────────────────────────

export interface User {
  id: string; username: string; display_name: string; email: string;
  avatar_url: string | null; banner_url: string | null; bio: string;
  status: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
  custom_status: string | null; last_seen: string; created_at: string; updated_at: string;
}
export interface GroupChat {
  id: string; name: string; icon_url: string | null; description: string;
  owner_id: string; created_at: string; updated_at: string; member_count?: number;
}
export interface GCMember {
  id: string; gc_id: string; user_id: string; role: 'owner' | 'admin' | 'member';
  can_kick: boolean; can_ban: boolean; can_add_members: boolean; can_manage_emojis: boolean;
  joined_at: string; user?: User;
}
export interface Message {
  id: string; gc_id: string | null; dm_conversation_id: string | null; sender_id: string;
  content: string; type: 'text' | 'system' | 'image' | 'file' | 'video';
  attachment_url: string | null; reply_to_id: string | null; created_at: string;
  edited_at?: string | null; sender?: User;
}
export interface DMConversation {
  id: string; user1_id: string; user2_id: string; created_at: string; other_user?: User;
}
export interface FriendRequest {
  id: string; sender_id: string; receiver_id: string;
  status: 'pending' | 'accepted' | 'declined'; created_at: string; sender?: User;
}
export interface Block { id: string; blocker_id: string; blocked_id: string; created_at: string; }
export interface CustomEmoji { id: string; gc_id: string; name: string; image_url: string; uploaded_by: string; created_at: string; }
export interface VoiceSession { id: string; gc_id: string; user_id: string; joined_at: string; user?: User; }
export interface GCBan { id: string; gc_id: string; user_id: string; reason: string | null; created_at: string; }
export interface UpdateUserData { display_name?: string; avatar_url?: string | null; banner_url?: string | null; bio?: string; status?: User['status']; custom_status?: string | null; }
export interface UpdateGCData { name?: string; icon_url?: string | null; description?: string; }
export interface CreateMessageData { gc_id?: string | null; dm_conversation_id?: string | null; sender_id: string; content: string; type?: Message['type']; attachment_url?: string | null; reply_to_id?: string | null; }
export interface UpdateMemberPermissions { can_kick?: boolean; can_ban?: boolean; can_add_members?: boolean; can_manage_emojis?: boolean; }

function genId() { return crypto.randomUUID(); }
function ts(v: any): string { return v instanceof Date ? v.toISOString() : (typeof v === 'string' ? v : new Date().toISOString()); }

class Database {
  private pool: Pool;
  constructor(connStr: string) {
    this.pool = new Pool({ connectionString: connStr, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  }
  private async q(text: string, params?: any[]) { return this.pool.query(text, params); }
  private async qOne<T = any>(text: string, params?: any[]): Promise<T | null> { const r = await this.pool.query(text, params); return r.rows[0] || null; }
  private async qAll<T = any>(text: string, params?: any[]): Promise<T[]> { const r = await this.pool.query(text, params); return r.rows; }

  // ── Users ──
  async createUser(id: string, u: string, d: string, e: string): Promise<User> {
    const r = await this.qOne('INSERT INTO users (id, username, display_name, email) VALUES ($1,$2,$3,$4) RETURNING *', [id, u, d, e]); return this.mapUser(r);
  }
  async getUserById(id: string): Promise<User | null> { return this.mapUser(await this.qOne('SELECT * FROM users WHERE id = $1', [id])); }
  async getUserByUsername(u: string): Promise<User | null> { return this.mapUser(await this.qOne('SELECT * FROM users WHERE username = $1', [u])); }
  async updateUser(id: string, data: UpdateUserData): Promise<User> {
    const f: string[] = []; const v: any[] = []; let i = 1;
    if (data.display_name !== undefined) { f.push(`display_name = $${i++}`); v.push(data.display_name); }
    if (data.avatar_url !== undefined) { f.push(`avatar_url = $${i++}`); v.push(data.avatar_url); }
    if (data.banner_url !== undefined) { f.push(`banner_url = $${i++}`); v.push(data.banner_url); }
    if (data.bio !== undefined) { f.push(`bio = $${i++}`); v.push(data.bio); }
    if (data.status !== undefined) { f.push(`status = $${i++}`); v.push(data.status); }
    if (data.custom_status !== undefined) { f.push(`custom_status = $${i++}`); v.push(data.custom_status); }
    f.push('updated_at = NOW()'); v.push(id);
    return this.mapUser(await this.qOne(`UPDATE users SET ${f.join(', ')} WHERE id = $${i} RETURNING *`, v));
  }
  async updateUserStatus(id: string, status: User['status']): Promise<User> {
    return this.mapUser(await this.qOne('UPDATE users SET status = $1, last_seen = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *', [status, id]));
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
    await this.q('DELETE FROM users WHERE id = $1', [id]);
  }
  async searchUsers(query: string): Promise<User[]> {
    return (await this.qAll('SELECT * FROM users WHERE username LIKE $1 OR display_name LIKE $1 LIMIT 50', [`%${query}%`])).map(r => this.mapUser(r)!).filter(Boolean);
  }
  async getAllUsers(): Promise<User[]> {
    return (await this.qAll('SELECT * FROM users ORDER BY username')).map(r => this.mapUser(r)!).filter(Boolean);
  }

  // ── Group Chats ──
  async createGC(id: string, n: string, o: string, d?: string, i?: string): Promise<GroupChat> {
    return this.mapGC(await this.qOne('INSERT INTO group_chats (id, name, description, icon_url, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, n, d || '', i || null, o]));
  }
  async getGCById(id: string): Promise<GroupChat | null> {
    const gc = this.mapGC(await this.qOne('SELECT * FROM group_chats WHERE id = $1', [id]));
    if (gc) { gc.member_count = await this.getMemberCount(id); }
    return gc;
  }
  async getUserGCs(userId: string): Promise<GroupChat[]> {
    return (await this.qAll('SELECT gc.*, COUNT(gm.user_id) as member_count FROM group_chats gc INNER JOIN gc_members gm ON gc.id = gm.gc_id WHERE gm.user_id = $1 GROUP BY gc.id ORDER BY gc.name', [userId])).map(r => this.mapGC(r)!).filter(Boolean);
  }
  async updateGC(id: string, data: UpdateGCData): Promise<GroupChat> {
    const f: string[] = []; const v: any[] = []; let i = 1;
    if (data.name !== undefined) { f.push(`name = $${i++}`); v.push(data.name); }
    if (data.icon_url !== undefined) { f.push(`icon_url = $${i++}`); v.push(data.icon_url); }
    if (data.description !== undefined) { f.push(`description = $${i++}`); v.push(data.description); }
    f.push('updated_at = NOW()'); v.push(id);
    return this.mapGC(await this.qOne(`UPDATE group_chats SET ${f.join(', ')} WHERE id = $${i} RETURNING *`, v));
  }
  async deleteGC(id: string): Promise<void> { await this.q('DELETE FROM group_chats WHERE id = $1', [id]); }

  // ── GC Members ──
  async addMember(g: string, u: string, r: GCMember['role'] = 'member'): Promise<GCMember> {
    return this.mapMember(await this.qOne('INSERT INTO gc_members (id, gc_id, user_id, role) VALUES ($1,$2,$3,$4) RETURNING *', [genId(), g, u, r]));
  }
  async removeMember(g: string, u: string): Promise<void> { await this.q('DELETE FROM gc_members WHERE gc_id = $1 AND user_id = $2', [g, u]); }
  async getMember(g: string, u: string): Promise<GCMember | null> {
    return this.mapMemberUser(await this.qOne('SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = $1 AND gm.user_id = $2', [g, u]));
  }
  async getGCMembers(g: string): Promise<GCMember[]> {
    return (await this.qAll('SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = $1 ORDER BY CASE gm.role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END, gm.joined_at', [g])).map(r => this.mapMemberUser(r)!).filter(Boolean);
  }
  async updateMemberRole(g: string, u: string, r: GCMember['role']): Promise<GCMember> {
    return this.mapMember(await this.qOne('UPDATE gc_members SET role = $1 WHERE gc_id = $2 AND user_id = $3 RETURNING *', [r, g, u]));
  }
  async updateMemberPermissions(g: string, u: string, p: UpdateMemberPermissions): Promise<GCMember> {
    const f: string[] = []; const v: any[] = []; let i = 1;
    if (p.can_kick !== undefined) { f.push(`can_kick = $${i++}`); v.push(p.can_kick); }
    if (p.can_ban !== undefined) { f.push(`can_ban = $${i++}`); v.push(p.can_ban); }
    if (p.can_add_members !== undefined) { f.push(`can_add_members = $${i++}`); v.push(p.can_add_members); }
    if (p.can_manage_emojis !== undefined) { f.push(`can_manage_emojis = $${i++}`); v.push(p.can_manage_emojis); }
    v.push(g, u);
    return this.mapMember(await this.qOne(`UPDATE gc_members SET ${f.join(', ')} WHERE gc_id = $${i++} AND user_id = $${i} RETURNING *`, v));
  }
  async transferOwnership(g: string, n: string): Promise<void> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); await c.query("UPDATE gc_members SET role = 'admin' WHERE gc_id = $1 AND role = 'owner'", [g]); await c.query('UPDATE gc_members SET role = $1 WHERE gc_id = $2 AND user_id = $3', ['owner', g, n]); await c.query('UPDATE group_chats SET owner_id = $1, updated_at = NOW() WHERE id = $2', [n, g]); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async isMember(g: string, u: string): Promise<boolean> { return !!(await this.qOne('SELECT 1 FROM gc_members WHERE gc_id = $1 AND user_id = $2', [g, u])); }
  async getMemberCount(g: string): Promise<number> { return parseInt(((await this.qOne('SELECT COUNT(*) as count FROM gc_members WHERE gc_id = $1', [g])) as any)?.count || '0', 10); }

  // ── Messages ──
  async createMessage(id: string, data: CreateMessageData): Promise<Message> {
    return this.mapMsg(await this.qOne('INSERT INTO messages (id, gc_id, dm_conversation_id, sender_id, content, type, attachment_url, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id, data.gc_id || null, data.dm_conversation_id || null, data.sender_id, data.content, data.type || 'text', data.attachment_url || null, data.reply_to_id || null]));
  }
  async getGCMessages(g: string, l = 50, b?: string): Promise<Message[]> {
    const sql = b ? 'SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT $3' : 'SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = $1 ORDER BY m.created_at DESC LIMIT $2';
    return (await this.qAll(sql, b ? [g, b, l] : [g, l])).map(r => this.mapMsg(r)!).filter(Boolean);
  }
  async getDMMessages(c: string, l = 50, b?: string): Promise<Message[]> {
    const sql = b ? 'SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT $3' : 'SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = $1 ORDER BY m.created_at DESC LIMIT $2';
    return (await this.qAll(sql, b ? [c, b, l] : [c, l])).map(r => this.mapMsg(r)!).filter(Boolean);
  }
  async getMessageById(id: string): Promise<Message | null> {
    return this.mapMsg(await this.qOne('SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.id = $1', [id]));
  }
  async deleteMessage(id: string): Promise<void> { await this.q('DELETE FROM messages WHERE id = $1', [id]); }
  async updateMessageContent(id: string, content: string): Promise<Message | null> {
    await this.q('UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2', [content, id]);
    return this.getMessageById(id);
  }

  // ── DM Conversations ──
  async getOrCreateDM(u1: string, u2: string): Promise<DMConversation> {
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    const ex = await this.qOne('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [a, b]);
    if (ex) return this.mapDM(ex);
    return this.mapDM(await this.qOne('INSERT INTO dm_conversations (id, user1_id, user2_id) VALUES ($1,$2,$3) RETURNING *', [genId(), a, b]));
  }
  async getDMConversation(u1: string, u2: string): Promise<DMConversation | null> {
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    return this.mapDM(await this.qOne('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [a, b]));
  }
  async getDMById(id: string): Promise<DMConversation | null> { return this.mapDM(await this.qOne('SELECT * FROM dm_conversations WHERE id = $1', [id])); }
  async getUserDMs(userId: string): Promise<DMConversation[]> {
    return (await this.qAll('SELECT dc.*, u.id as ouid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as oucreated_at, u.updated_at as ouupdated_at FROM dm_conversations dc INNER JOIN users u ON (CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END) = u.id WHERE dc.user1_id = $1 OR dc.user2_id = $1 ORDER BY dc.created_at DESC', [userId])).map(r => this.mapDMUser(r)!).filter(Boolean);
  }

  // ── Friends ──
  async sendFriendRequest(s: string, r: string): Promise<FriendRequest> { return this.mapFR(await this.qOne('INSERT INTO friend_requests (id, sender_id, receiver_id) VALUES ($1,$2,$3) RETURNING *', [genId(), s, r])); }
  async acceptFriendRequest(id: string): Promise<void> { await this.q("UPDATE friend_requests SET status = 'accepted' WHERE id = $1", [id]); }
  async declineFriendRequest(id: string): Promise<void> { await this.q("UPDATE friend_requests SET status = 'declined' WHERE id = $1", [id]); }
  async getPendingRequests(u: string): Promise<FriendRequest[]> {
    return (await this.qAll('SELECT fr.*, s.id as sid, s.username, s.display_name, s.email, s.avatar_url, s.banner_url, s.bio, s.status, s.custom_status, s.last_seen, s.created_at as screated_at, s.updated_at as supdated_at FROM friend_requests fr INNER JOIN users s ON fr.sender_id = s.id WHERE fr.receiver_id = $1 AND fr.status = \'pending\' ORDER BY fr.created_at DESC', [u])).map(r => this.mapFRSender(r)!).filter(Boolean);
  }
  async getFriends(u: string): Promise<User[]> {
    return (await this.qAll('SELECT u.* FROM users u INNER JOIN friend_requests fr ON ((fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.receiver_id = $1 AND fr.sender_id = u.id)) WHERE fr.status = \'accepted\' ORDER BY u.display_name', [u])).map(r => this.mapUser(r)!).filter(Boolean);
  }
  async removeFriend(u1: string, u2: string): Promise<void> { await this.q('DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [u1, u2]); }
  async areFriends(u1: string, u2: string): Promise<boolean> { return !!(await this.qOne("SELECT 1 FROM friend_requests WHERE status = 'accepted' AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))", [u1, u2])); }

  // ── Blocks ──
  async blockUser(b: string, d: string): Promise<void> { await this.q('INSERT INTO blocks (id, blocker_id, blocked_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [genId(), b, d]); }
  async unblockUser(b: string, d: string): Promise<void> { await this.q('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [b, d]); }
  async isBlocked(b: string, d: string): Promise<boolean> { return !!(await this.qOne('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [b, d])); }
  async getBlockedUsers(u: string): Promise<User[]> { return (await this.qAll('SELECT u.* FROM users u INNER JOIN blocks b ON b.blocked_id = u.id WHERE b.blocker_id = $1 ORDER BY u.display_name', [u])).map(r => this.mapUser(r)!).filter(Boolean); }

  // ── Emojis ──
  async addEmoji(g: string, n: string, i: string, u: string): Promise<CustomEmoji> { return this.mapEmoji(await this.qOne('INSERT INTO custom_emojis (id, gc_id, name, image_url, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [genId(), g, n, i, u])); }
  async removeEmoji(id: string): Promise<void> { await this.q('DELETE FROM custom_emojis WHERE id = $1', [id]); }
  async getGCEmojis(g: string): Promise<CustomEmoji[]> { return (await this.qAll('SELECT * FROM custom_emojis WHERE gc_id = $1 ORDER BY name', [g])).map(r => this.mapEmoji(r)!).filter(Boolean); }
  async getEmojiById(id: string): Promise<CustomEmoji | null> { return this.mapEmoji(await this.qOne('SELECT * FROM custom_emojis WHERE id = $1', [id])); }

  // ── Voice ──
  async joinVoice(g: string, u: string): Promise<VoiceSession> { await this.q('DELETE FROM voice_sessions WHERE user_id = $1', [u]); return this.mapVoice(await this.qOne('INSERT INTO voice_sessions (id, gc_id, user_id) VALUES ($1,$2,$3) RETURNING *', [genId(), g, u])); }
  async leaveVoice(g: string, u: string): Promise<void> { await this.q('DELETE FROM voice_sessions WHERE gc_id = $1 AND user_id = $2', [g, u]); }
  async getVoiceParticipants(g: string): Promise<VoiceSession[]> {
    return (await this.qAll('SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.gc_id = $1 ORDER BY vs.joined_at', [g])).map(r => this.mapVoiceUser(r)!).filter(Boolean);
  }
  async getUserVoiceSession(u: string): Promise<VoiceSession | null> {
    return this.mapVoiceUser(await this.qOne('SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.user_id = $1', [u]));
  }

  // ── Bans ──
  async banUser(g: string, u: string, r?: string): Promise<void> { await this.q('INSERT INTO gc_bans (id, gc_id, user_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (gc_id, user_id) DO UPDATE SET reason = EXCLUDED.reason', [genId(), g, u, r || null]); }
  async unbanUser(g: string, u: string): Promise<void> { await this.q('DELETE FROM gc_bans WHERE gc_id = $1 AND user_id = $2', [g, u]); }
  async isBanned(g: string, u: string): Promise<boolean> { return !!(await this.qOne('SELECT 1 FROM gc_bans WHERE gc_id = $1 AND user_id = $2', [g, u])); }

  get raw(): Pool { return this.pool; }

  // ── Mappers ──
  private mapUser(r: any): User | null { return r ? { id: r.id, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.created_at), updated_at: ts(r.updated_at) } : null; }
  private mapGC(r: any): GroupChat | null { return r ? { id: r.id, name: r.name, icon_url: r.icon_url, description: r.description, owner_id: r.owner_id, created_at: ts(r.created_at), updated_at: ts(r.updated_at), member_count: r.member_count ? parseInt(r.member_count, 10) : undefined } : null; }
  private mapMember(r: any): GCMember | null { return r ? { id: r.id, gc_id: r.gc_id, user_id: r.user_id, role: r.role, can_kick: r.can_kick, can_ban: r.can_ban, can_add_members: r.can_add_members, can_manage_emojis: r.can_manage_emojis, joined_at: ts(r.joined_at) } : null; }
  private mapMemberUser(r: any): GCMember | null { return r ? { ...this.mapMember(r)!, user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } } : null; }
  private mapMsg(r: any): Message | null { return r ? { id: r.id, gc_id: r.gc_id, dm_conversation_id: r.dm_conversation_id, sender_id: r.sender_id, content: r.content, type: r.type, attachment_url: r.attachment_url, reply_to_id: r.reply_to_id, created_at: ts(r.created_at), edited_at: r.edited_at ? ts(r.edited_at) : null, sender: r.uid ? { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } : undefined } : null; }
  private mapDM(r: any): DMConversation | null { return r ? { id: r.id, user1_id: r.user1_id, user2_id: r.user2_id, created_at: ts(r.created_at) } : null; }
  private mapDMUser(r: any): DMConversation | null { return r ? { id: r.id, user1_id: r.user1_id, user2_id: r.user2_id, created_at: ts(r.created_at), other_user: { id: r.ouid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.oucreated_at), updated_at: ts(r.ouupdated_at) } } : null; }
  private mapFR(r: any): FriendRequest | null { return r ? { id: r.id, sender_id: r.sender_id, receiver_id: r.receiver_id, status: r.status, created_at: ts(r.created_at) } : null; }
  private mapFRSender(r: any): FriendRequest | null { return r ? { ...this.mapFR(r)!, sender: { id: r.sid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.screated_at), updated_at: ts(r.supdated_at) } } : null; }
  private mapEmoji(r: any): CustomEmoji | null { return r ? { id: r.id, gc_id: r.gc_id, name: r.name, image_url: r.image_url, uploaded_by: r.uploaded_by, created_at: ts(r.created_at) } : null; }
  private mapVoice(r: any): VoiceSession | null { return r ? { id: r.id, gc_id: r.gc_id, user_id: r.user_id, joined_at: ts(r.joined_at) } : null; }
  private mapVoiceUser(r: any): VoiceSession | null { return r ? { ...this.mapVoice(r)!, user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } } : null; }
}

export const db = new Database(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ureedxdchat');
