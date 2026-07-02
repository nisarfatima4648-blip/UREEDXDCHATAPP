// ─── Hybrid Database Layer ──────────────────────────────────────────────────
// Uses PostgreSQL (pg) in production (Vercel/Supabase) and SQLite (better-sqlite3)
// in local dev. ALL methods are async — callers use `await`.
//
// The DATABASE_URL env var determines which backend to use:
//   - "file:/path/to/db" → SQLite (local dev)
//   - "postgresql://..." → PostgreSQL (production)

import { mkdirSync, existsSync } from 'fs';

// ─── Detect backend from DATABASE_URL ───────────────────────────────────────

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ureedxdchat';
const USE_SQLITE = DB_URL.startsWith('file:');

// ─── TypeScript Interfaces (shared) ─────────────────────────────────────────

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

// ─── SQLite Implementation (local dev) ──────────────────────────────────────

let _sqliteDb: any = null;
function getSqliteDb(): any {
  if (_sqliteDb) return _sqliteDb;
  const dbPath = DB_URL.replace('file:', '');
  const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Initialize tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, avatar_url TEXT, banner_url TEXT, bio TEXT DEFAULT '', status TEXT DEFAULT 'offline', custom_status TEXT, last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS group_chats (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon_url TEXT, description TEXT DEFAULT '', owner_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS gc_members (id TEXT PRIMARY KEY, gc_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member', can_kick INTEGER DEFAULT 0, can_ban INTEGER DEFAULT 0, can_add_members INTEGER DEFAULT 0, can_manage_emojis INTEGER DEFAULT 0, joined_at TEXT DEFAULT (datetime('now')), UNIQUE(gc_id, user_id));
    CREATE TABLE IF NOT EXISTS dm_conversations (id TEXT PRIMARY KEY, user1_id TEXT NOT NULL, user2_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user1_id, user2_id));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, gc_id TEXT, dm_conversation_id TEXT, sender_id TEXT NOT NULL, content TEXT NOT NULL, type TEXT DEFAULT 'text', attachment_url TEXT, reply_to_id TEXT, created_at TEXT DEFAULT (datetime('now')), edited_at TEXT);
    CREATE TABLE IF NOT EXISTS friend_requests (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), UNIQUE(sender_id, receiver_id));
    CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(blocker_id, blocked_id));
    CREATE TABLE IF NOT EXISTS custom_emojis (id TEXT PRIMARY KEY, gc_id TEXT NOT NULL, name TEXT NOT NULL, image_url TEXT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(gc_id, name));
    CREATE TABLE IF NOT EXISTS voice_sessions (id TEXT PRIMARY KEY, gc_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS gc_bans (id TEXT PRIMARY KEY, gc_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(gc_id, user_id));
  `);
  _sqliteDb = db;
  return db;
}

function genId() { return crypto.randomUUID(); }

// SQLite database wrapper — all methods are async (wrapped in Promise.resolve)
const sqliteDb = {
  async createUser(id: string, username: string, displayName: string, email: string): Promise<User> {
    const db = getSqliteDb();
    return db.prepare('INSERT INTO users (id, username, display_name, email) VALUES (?, ?, ?, ?) RETURNING *').get(id, username, displayName, email) as User;
  },
  async getUserById(id: string): Promise<User | null> {
    const db = getSqliteDb();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null;
  },
  async getUserByUsername(username: string): Promise<User | null> {
    const db = getSqliteDb();
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | null;
  },
  async updateUser(id: string, data: UpdateUserData): Promise<User> {
    const db = getSqliteDb();
    const fields: string[] = []; const values: any[] = [];
    if (data.display_name !== undefined) { fields.push('display_name = ?'); values.push(data.display_name); }
    if (data.avatar_url !== undefined) { fields.push('avatar_url = ?'); values.push(data.avatar_url); }
    if (data.banner_url !== undefined) { fields.push('banner_url = ?'); values.push(data.banner_url); }
    if (data.bio !== undefined) { fields.push('bio = ?'); values.push(data.bio); }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
    if (data.custom_status !== undefined) { fields.push('custom_status = ?'); values.push(data.custom_status); }
    fields.push("updated_at = datetime('now')"); values.push(id);
    return db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ? RETURNING *`).get(...values) as User;
  },
  async updateUserStatus(id: string, status: User['status']): Promise<User> {
    const db = getSqliteDb();
    return db.prepare("UPDATE users SET status = ?, last_seen = datetime('now'), updated_at = datetime('now') WHERE id = ? RETURNING *").get(status, id) as User;
  },
  async deleteUser(id: string): Promise<void> {
    const db = getSqliteDb();
    db.prepare('DELETE FROM voice_sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM gc_bans WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM custom_emojis WHERE uploaded_by = ?').run(id);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(id, id);
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(id);
    db.prepare('DELETE FROM dm_conversations WHERE user1_id = ? OR user2_id = ?').run(id, id);
    db.prepare('DELETE FROM gc_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM friend_requests WHERE sender_id = ? OR receiver_id = ?').run(id, id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
  async searchUsers(query: string): Promise<User[]> {
    const db = getSqliteDb();
    return db.prepare('SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 50').all(`%${query}%`, `%${query}%`) as User[];
  },
  async getAllUsers(): Promise<User[]> {
    const db = getSqliteDb();
    return db.prepare('SELECT * FROM users ORDER BY username').all() as User[];
  },
  async createGC(id: string, name: string, ownerId: string, description?: string, iconUrl?: string): Promise<GroupChat> {
    const db = getSqliteDb();
    return db.prepare('INSERT INTO group_chats (id, name, description, icon_url, owner_id) VALUES (?, ?, ?, ?, ?) RETURNING *').get(id, name, description || '', iconUrl || null, ownerId) as GroupChat;
  },
  async getGCById(id: string): Promise<GroupChat | null> {
    const db = getSqliteDb();
    const gc = db.prepare('SELECT * FROM group_chats WHERE id = ?').get(id) as GroupChat | null;
    if (gc) { const c = db.prepare('SELECT COUNT(*) as count FROM gc_members WHERE gc_id = ?').get(id) as any; gc.member_count = c.count; }
    return gc;
  },
  async getUserGCs(userId: string): Promise<GroupChat[]> {
    const db = getSqliteDb();
    return db.prepare('SELECT gc.*, COUNT(gm.user_id) as member_count FROM group_chats gc INNER JOIN gc_members gm ON gc.id = gm.gc_id WHERE gm.user_id = ? GROUP BY gc.id ORDER BY gc.name').all(userId) as GroupChat[];
  },
  async updateGC(id: string, data: UpdateGCData): Promise<GroupChat> {
    const db = getSqliteDb();
    const fields: string[] = []; const values: any[] = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.icon_url !== undefined) { fields.push('icon_url = ?'); values.push(data.icon_url); }
    if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
    fields.push("updated_at = datetime('now')"); values.push(id);
    return db.prepare(`UPDATE group_chats SET ${fields.join(', ')} WHERE id = ? RETURNING *`).get(...values) as GroupChat;
  },
  async deleteGC(id: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM group_chats WHERE id = ?').run(id); },
  async addMember(gcId: string, userId: string, role: GCMember['role'] = 'member'): Promise<GCMember> {
    const db = getSqliteDb();
    return db.prepare('INSERT INTO gc_members (id, gc_id, user_id, role) VALUES (?, ?, ?, ?) RETURNING *').get(genId(), gcId, userId, role) as GCMember;
  },
  async removeMember(gcId: string, userId: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM gc_members WHERE gc_id = ? AND user_id = ?').run(gcId, userId); },
  async getMember(gcId: string, userId: string): Promise<GCMember | null> {
    const db = getSqliteDb();
    const row = db.prepare(`SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = ? AND gm.user_id = ?`).get(gcId, userId) as any;
    if (!row) return null;
    return { id: row.id, gc_id: row.gc_id, user_id: row.user_id, role: row.role, can_kick: Boolean(row.can_kick), can_ban: Boolean(row.can_ban), can_add_members: Boolean(row.can_add_members), can_manage_emojis: Boolean(row.can_manage_emojis), joined_at: row.joined_at, user: { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: row.last_seen, created_at: row.ucreated_at, updated_at: row.uupdated_at } };
  },
  async getGCMembers(gcId: string): Promise<GCMember[]> {
    const db = getSqliteDb();
    const rows = db.prepare(`SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = ? ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at`).all(gcId) as any[];
    return rows.map(row => ({ id: row.id, gc_id: row.gc_id, user_id: row.user_id, role: row.role, can_kick: Boolean(row.can_kick), can_ban: Boolean(row.can_ban), can_add_members: Boolean(row.can_add_members), can_manage_emojis: Boolean(row.can_manage_emojis), joined_at: row.joined_at, user: { id: row.uid, username: row.username, display_name: row.display_name, email: row.email, avatar_url: row.avatar_url, banner_url: row.banner_url, bio: row.bio, status: row.status, custom_status: row.custom_status, last_seen: row.last_seen, created_at: row.ucreated_at, updated_at: row.uupdated_at } }));
  },
  async updateMemberRole(gcId: string, userId: string, role: GCMember['role']): Promise<GCMember> {
    const db = getSqliteDb();
    return db.prepare('UPDATE gc_members SET role = ? WHERE gc_id = ? AND user_id = ? RETURNING *').get(role, gcId, userId) as GCMember;
  },
  async updateMemberPermissions(gcId: string, userId: string, perms: UpdateMemberPermissions): Promise<GCMember> {
    const db = getSqliteDb();
    const fields: string[] = []; const values: any[] = [];
    if (perms.can_kick !== undefined) { fields.push('can_kick = ?'); values.push(perms.can_kick ? 1 : 0); }
    if (perms.can_ban !== undefined) { fields.push('can_ban = ?'); values.push(perms.can_ban ? 1 : 0); }
    if (perms.can_add_members !== undefined) { fields.push('can_add_members = ?'); values.push(perms.can_add_members ? 1 : 0); }
    if (perms.can_manage_emojis !== undefined) { fields.push('can_manage_emojis = ?'); values.push(perms.can_manage_emojis ? 1 : 0); }
    values.push(gcId, userId);
    return db.prepare(`UPDATE gc_members SET ${fields.join(', ')} WHERE gc_id = ? AND user_id = ? RETURNING *`).get(...values) as GCMember;
  },
  async transferOwnership(gcId: string, newOwnerId: string): Promise<void> {
    const db = getSqliteDb();
    const tx = db.transaction(() => {
      db.prepare("UPDATE gc_members SET role = 'admin' WHERE gc_id = ? AND role = 'owner'").run(gcId);
      db.prepare("UPDATE gc_members SET role = 'owner' WHERE gc_id = ? AND user_id = ?").run(gcId, newOwnerId);
      db.prepare("UPDATE group_chats SET owner_id = ?, updated_at = datetime('now') WHERE id = ?").run(newOwnerId, gcId);
    });
    tx();
  },
  async isMember(gcId: string, userId: string): Promise<boolean> {
    const db = getSqliteDb();
    return !!db.prepare('SELECT 1 FROM gc_members WHERE gc_id = ? AND user_id = ?').get(gcId, userId);
  },
  async getMemberCount(gcId: string): Promise<number> {
    const db = getSqliteDb();
    return (db.prepare('SELECT COUNT(*) as count FROM gc_members WHERE gc_id = ?').get(gcId) as any).count;
  },
  async createMessage(id: string, data: CreateMessageData): Promise<Message> {
    const db = getSqliteDb();
    return db.prepare('INSERT INTO messages (id, gc_id, dm_conversation_id, sender_id, content, type, attachment_url, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *').get(id, data.gc_id || null, data.dm_conversation_id || null, data.sender_id, data.content, data.type || 'text', data.attachment_url || null, data.reply_to_id || null) as Message;
  },
  async getGCMessages(gcId: string, limit = 50, before?: string): Promise<Message[]> {
    const db = getSqliteDb();
    const sql = before
      ? `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?`
      : `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = ? ORDER BY m.created_at DESC LIMIT ?`;
    const rows = (before ? db.prepare(sql).all(gcId, before, limit) : db.prepare(sql).all(gcId, limit)) as any[];
    return rows.map(r => ({ id: r.id, gc_id: r.gc_id, dm_conversation_id: r.dm_conversation_id, sender_id: r.sender_id, content: r.content, type: r.type, attachment_url: r.attachment_url, reply_to_id: r.reply_to_id, created_at: r.created_at, edited_at: r.edited_at, sender: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.ucreated_at, updated_at: r.uupdated_at } }));
  },
  async getDMMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
    const db = getSqliteDb();
    const sql = before
      ? `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?`
      : `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = ? ORDER BY m.created_at DESC LIMIT ?`;
    const rows = (before ? db.prepare(sql).all(conversationId, before, limit) : db.prepare(sql).all(conversationId, limit)) as any[];
    return rows.map(r => ({ id: r.id, gc_id: r.gc_id, dm_conversation_id: r.dm_conversation_id, sender_id: r.sender_id, content: r.content, type: r.type, attachment_url: r.attachment_url, reply_to_id: r.reply_to_id, created_at: r.created_at, edited_at: r.edited_at, sender: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.ucreated_at, updated_at: r.uupdated_at } }));
  },
  async getMessageById(id: string): Promise<Message | null> {
    const db = getSqliteDb();
    const r = db.prepare(`SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.id = ?`).get(id) as any;
    if (!r) return null;
    return { id: r.id, gc_id: r.gc_id, dm_conversation_id: r.dm_conversation_id, sender_id: r.sender_id, content: r.content, type: r.type, attachment_url: r.attachment_url, reply_to_id: r.reply_to_id, created_at: r.created_at, edited_at: r.edited_at, sender: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.ucreated_at, updated_at: r.uupdated_at } };
  },
  async deleteMessage(id: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM messages WHERE id = ?').run(id); },
  async updateMessageContent(id: string, content: string): Promise<Message | null> {
    const db = getSqliteDb();
    db.prepare("UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?").run(content, id);
    return this.getMessageById(id);
  },
  async getOrCreateDM(user1Id: string, user2Id: string): Promise<DMConversation> {
    const db = getSqliteDb();
    const [u1, u2] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];
    const existing = db.prepare('SELECT * FROM dm_conversations WHERE user1_id = ? AND user2_id = ?').get(u1, u2);
    if (existing) return existing as DMConversation;
    return db.prepare('INSERT INTO dm_conversations (id, user1_id, user2_id) VALUES (?, ?, ?) RETURNING *').get(genId(), u1, u2) as DMConversation;
  },
  async getDMConversation(u1: string, u2: string): Promise<DMConversation | null> {
    const db = getSqliteDb();
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    return db.prepare('SELECT * FROM dm_conversations WHERE user1_id = ? AND user2_id = ?').get(a, b) as DMConversation | null;
  },
  async getDMById(id: string): Promise<DMConversation | null> {
    const db = getSqliteDb();
    return db.prepare('SELECT * FROM dm_conversations WHERE id = ?').get(id) as DMConversation | null;
  },
  async getUserDMs(userId: string): Promise<DMConversation[]> {
    const db = getSqliteDb();
    const rows = db.prepare(`SELECT dc.*, u.id as ouid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as oucreated_at, u.updated_at as ouupdated_at FROM dm_conversations dc INNER JOIN users u ON (CASE WHEN dc.user1_id = ? THEN dc.user2_id ELSE dc.user1_id END) = u.id WHERE dc.user1_id = ? OR dc.user2_id = ? ORDER BY dc.created_at DESC`).all(userId, userId, userId) as any[];
    return rows.map(r => ({ id: r.id, user1_id: r.user1_id, user2_id: r.user2_id, created_at: r.created_at, other_user: { id: r.ouid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.oucreated_at, updated_at: r.ouupdated_at } }));
  },
  async sendFriendRequest(senderId: string, receiverId: string): Promise<FriendRequest> {
    const db = getSqliteDb();
    return db.prepare('INSERT INTO friend_requests (id, sender_id, receiver_id) VALUES (?, ?, ?) RETURNING *').get(genId(), senderId, receiverId) as FriendRequest;
  },
  async acceptFriendRequest(id: string): Promise<void> { const db = getSqliteDb(); db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(id); },
  async declineFriendRequest(id: string): Promise<void> { const db = getSqliteDb(); db.prepare("UPDATE friend_requests SET status = 'declined' WHERE id = ?").run(id); },
  async getPendingRequests(userId: string): Promise<FriendRequest[]> {
    const db = getSqliteDb();
    const rows = db.prepare(`SELECT fr.*, s.id as sid, s.username, s.display_name, s.email, s.avatar_url, s.banner_url, s.bio, s.status, s.custom_status, s.last_seen, s.created_at as screated_at, s.updated_at as supdated_at FROM friend_requests fr INNER JOIN users s ON fr.sender_id = s.id WHERE fr.receiver_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`).all(userId) as any[];
    return rows.map(r => ({ id: r.id, sender_id: r.sender_id, receiver_id: r.receiver_id, status: r.status, created_at: r.created_at, sender: { id: r.sid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.screated_at, updated_at: r.supdated_at } }));
  },
  async getFriends(userId: string): Promise<User[]> {
    const db = getSqliteDb();
    return db.prepare(`SELECT u.* FROM users u INNER JOIN friend_requests fr ON ((fr.sender_id = ? AND fr.receiver_id = u.id) OR (fr.receiver_id = ? AND fr.sender_id = u.id)) WHERE fr.status = 'accepted' ORDER BY u.display_name`).all(userId, userId) as User[];
  },
  async removeFriend(userId: string, otherUserId: string): Promise<void> {
    const db = getSqliteDb();
    db.prepare('DELETE FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)').run(userId, otherUserId, otherUserId, userId);
  },
  async areFriends(u1: string, u2: string): Promise<boolean> {
    const db = getSqliteDb();
    return !!db.prepare(`SELECT 1 FROM friend_requests WHERE status = 'accepted' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))`).get(u1, u2, u2, u1);
  },
  async blockUser(blockerId: string, blockedId: string): Promise<void> { const db = getSqliteDb(); db.prepare('INSERT OR IGNORE INTO blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)').run(genId(), blockerId, blockedId); },
  async unblockUser(blockerId: string, blockedId: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId); },
  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> { const db = getSqliteDb(); return !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId); },
  async getBlockedUsers(userId: string): Promise<User[]> { const db = getSqliteDb(); return db.prepare('SELECT u.* FROM users u INNER JOIN blocks b ON b.blocked_id = u.id WHERE b.blocker_id = ? ORDER BY u.display_name').all(userId) as User[]; },
  async addEmoji(gcId: string, name: string, imageUrl: string, uploadedBy: string): Promise<CustomEmoji> {
    const db = getSqliteDb();
    return db.prepare('INSERT INTO custom_emojis (id, gc_id, name, image_url, uploaded_by) VALUES (?, ?, ?, ?, ?) RETURNING *').get(genId(), gcId, name, imageUrl, uploadedBy) as CustomEmoji;
  },
  async removeEmoji(emojiId: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM custom_emojis WHERE id = ?').run(emojiId); },
  async getGCEmojis(gcId: string): Promise<CustomEmoji[]> { const db = getSqliteDb(); return db.prepare('SELECT * FROM custom_emojis WHERE gc_id = ? ORDER BY name').all(gcId) as CustomEmoji[]; },
  async getEmojiById(emojiId: string): Promise<CustomEmoji | null> { const db = getSqliteDb(); return db.prepare('SELECT * FROM custom_emojis WHERE id = ?').get(emojiId) as CustomEmoji | null; },
  async joinVoice(gcId: string, userId: string): Promise<VoiceSession> {
    const db = getSqliteDb();
    db.prepare('DELETE FROM voice_sessions WHERE user_id = ?').run(userId);
    return db.prepare('INSERT INTO voice_sessions (id, gc_id, user_id) VALUES (?, ?, ?) RETURNING *').get(genId(), gcId, userId) as VoiceSession;
  },
  async leaveVoice(gcId: string, userId: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM voice_sessions WHERE gc_id = ? AND user_id = ?').run(gcId, userId); },
  async getVoiceParticipants(gcId: string): Promise<VoiceSession[]> {
    const db = getSqliteDb();
    const rows = db.prepare(`SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.gc_id = ? ORDER BY vs.joined_at`).all(gcId) as any[];
    return rows.map(r => ({ id: r.id, gc_id: r.gc_id, user_id: r.user_id, joined_at: r.joined_at, user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.ucreated_at, updated_at: r.uupdated_at } }));
  },
  async getUserVoiceSession(userId: string): Promise<VoiceSession | null> {
    const db = getSqliteDb();
    const r = db.prepare(`SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.user_id = ?`).get(userId) as any;
    if (!r) return null;
    return { id: r.id, gc_id: r.gc_id, user_id: r.user_id, joined_at: r.joined_at, user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: r.last_seen, created_at: r.ucreated_at, updated_at: r.uupdated_at } };
  },
  async banUser(gcId: string, userId: string, reason?: string): Promise<void> { const db = getSqliteDb(); db.prepare('INSERT OR REPLACE INTO gc_bans (id, gc_id, user_id, reason) VALUES (?, ?, ?, ?)').run(genId(), gcId, userId, reason || null); },
  async unbanUser(gcId: string, userId: string): Promise<void> { const db = getSqliteDb(); db.prepare('DELETE FROM gc_bans WHERE gc_id = ? AND user_id = ?').run(gcId, userId); },
  async isBanned(gcId: string, userId: string): Promise<boolean> { const db = getSqliteDb(); return !!db.prepare('SELECT 1 FROM gc_bans WHERE gc_id = ? AND user_id = ?').get(gcId, userId); },
  get raw(): any {
    const db = getSqliteDb();
    return {
      query: (sql: string, params?: any[]) => { 
        const stmt = db.prepare(sql.replace(/\$(\d+)/g, '?'));
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
          return Promise.resolve({ rows: stmt.all(...(params || [])) });
        }
        return Promise.resolve({ rows: [], rowCount: stmt.run(...(params || [])).changes });
      }
    };
  },
};

// ─── PostgreSQL Implementation (production) ─────────────────────────────────

async function createPgDb() {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: DB_URL, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  
  const q = async (text: string, params?: any[]) => pool.query(text, params);
  const qOne = async <T = any>(text: string, params?: any[]) => { const r = await pool.query(text, params); return r.rows[0] || null; };
  const qAll = async <T = any>(text: string, params?: any[]) => { const r = await pool.query(text, params); return r.rows; };
  const ts = (v: any) => v instanceof Date ? v.toISOString() : (typeof v === 'string' ? v : new Date().toISOString());

  const mapUser = (r: any) => r ? { id: r.id, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.created_at), updated_at: ts(r.updated_at) } : null;
  const mapGC = (r: any) => r ? { id: r.id, name: r.name, icon_url: r.icon_url, description: r.description, owner_id: r.owner_id, created_at: ts(r.created_at), updated_at: ts(r.updated_at), member_count: r.member_count ? parseInt(r.member_count, 10) : undefined } : null;
  const mapMsg = (r: any) => r ? { id: r.id, gc_id: r.gc_id, dm_conversation_id: r.dm_conversation_id, sender_id: r.sender_id, content: r.content, type: r.type, attachment_url: r.attachment_url, reply_to_id: r.reply_to_id, created_at: ts(r.created_at), edited_at: r.edited_at ? ts(r.edited_at) : null, sender: r.uid ? { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } : undefined } : null;

  return {
    createUser: async (id: string, u: string, d: string, e: string) => mapUser(await qOne('INSERT INTO users (id, username, display_name, email) VALUES ($1,$2,$3,$4) RETURNING *', [id, u, d, e])),
    getUserById: async (id: string) => mapUser(await qOne('SELECT * FROM users WHERE id = $1', [id])),
    getUserByUsername: async (u: string) => mapUser(await qOne('SELECT * FROM users WHERE username = $1', [u])),
    updateUser: async (id: string, data: UpdateUserData) => { const f: string[] = []; const v: any[] = []; let i = 1; for (const [k, val] of Object.entries(data)) { const col = k === 'display_name' ? 'display_name' : k === 'custom_status' ? 'custom_status' : k; f.push(`${col} = $${i++}`); v.push(val); } f.push('updated_at = NOW()'); v.push(id); return mapUser(await qOne(`UPDATE users SET ${f.join(', ')} WHERE id = $${i} RETURNING *`, v)); },
    updateUserStatus: async (id: string, status: string) => mapUser(await qOne('UPDATE users SET status = $1, last_seen = NOW(), updated_at = NOW() WHERE id = $2 RETURNING *', [status, id])),
    deleteUser: async (id: string) => { await q('DELETE FROM voice_sessions WHERE user_id = $1', [id]); await q('DELETE FROM gc_bans WHERE user_id = $1', [id]); await q('DELETE FROM custom_emojis WHERE uploaded_by = $1', [id]); await q('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1', [id, id]); await q('DELETE FROM messages WHERE sender_id = $1', [id]); await q('DELETE FROM dm_conversations WHERE user1_id = $1 OR user2_id = $1', [id, id]); await q('DELETE FROM gc_members WHERE user_id = $1', [id]); await q('DELETE FROM friend_requests WHERE sender_id = $1 OR receiver_id = $1', [id, id]); await q('DELETE FROM users WHERE id = $1', [id]); },
    searchUsers: async (q: string) => (await qAll('SELECT * FROM users WHERE username LIKE $1 OR display_name LIKE $1 LIMIT 50', [`%${q}%`])).map(mapUser).filter(Boolean),
    getAllUsers: async () => (await qAll('SELECT * FROM users ORDER BY username')).map(mapUser).filter(Boolean),
    createGC: async (id: string, n: string, o: string, d?: string, i?: string) => mapGC(await qOne('INSERT INTO group_chats (id, name, description, icon_url, owner_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, n, d || '', i || null, o])),
    getGCById: async (id: string) => { const gc = mapGC(await qOne('SELECT * FROM group_chats WHERE id = $1', [id])); if (gc) { gc.member_count = parseInt(((await qOne('SELECT COUNT(*) as count FROM gc_members WHERE gc_id = $1', [id])) as any).count, 10); } return gc; },
    getUserGCs: async (u: string) => (await qAll('SELECT gc.*, COUNT(gm.user_id) as member_count FROM group_chats gc INNER JOIN gc_members gm ON gc.id = gm.gc_id WHERE gm.user_id = $1 GROUP BY gc.id ORDER BY gc.name', [u])).map(mapGC).filter(Boolean),
    updateGC: async (id: string, data: UpdateGCData) => { const f: string[] = []; const v: any[] = []; let i = 1; if (data.name !== undefined) { f.push(`name = $${i++}`); v.push(data.name); } if (data.icon_url !== undefined) { f.push(`icon_url = $${i++}`); v.push(data.icon_url); } if (data.description !== undefined) { f.push(`description = $${i++}`); v.push(data.description); } f.push('updated_at = NOW()'); v.push(id); return mapGC(await qOne(`UPDATE group_chats SET ${f.join(', ')} WHERE id = $${i} RETURNING *`, v)); },
    deleteGC: async (id: string) => { await q('DELETE FROM group_chats WHERE id = $1', [id]); },
    addMember: async (g: string, u: string, r: string = 'member') => { const row = await qOne('INSERT INTO gc_members (id, gc_id, user_id, role) VALUES ($1,$2,$3,$4) RETURNING *', [genId(), g, u, r]); return row; },
    removeMember: async (g: string, u: string) => { await q('DELETE FROM gc_members WHERE gc_id = $1 AND user_id = $2', [g, u]); },
    getMember: async (g: string, u: string) => { const r = await qOne(`SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = $1 AND gm.user_id = $2`, [g, u]); if (!r) return null; return { id: r.id, gc_id: r.gc_id, user_id: r.user_id, role: r.role, can_kick: r.can_kick, can_ban: r.can_ban, can_add_members: r.can_add_members, can_manage_emojis: r.can_manage_emojis, joined_at: ts(r.joined_at), user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } }; },
    getGCMembers: async (g: string) => { const rows = await qAll(`SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM gc_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.gc_id = $1 ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at`, [g]); return rows.map(r => ({ id: r.id, gc_id: r.gc_id, user_id: r.user_id, role: r.role, can_kick: r.can_kick, can_ban: r.can_ban, can_add_members: r.can_add_members, can_manage_emojis: r.can_manage_emojis, joined_at: ts(r.joined_at), user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } })); },
    updateMemberRole: async (g: string, u: string, r: string) => qOne('UPDATE gc_members SET role = $1 WHERE gc_id = $2 AND user_id = $3 RETURNING *', [r, g, u]),
    updateMemberPermissions: async (g: string, u: string, p: UpdateMemberPermissions) => { const f: string[] = []; const v: any[] = []; let i = 1; if (p.can_kick !== undefined) { f.push(`can_kick = $${i++}`); v.push(p.can_kick); } if (p.can_ban !== undefined) { f.push(`can_ban = $${i++}`); v.push(p.can_ban); } if (p.can_add_members !== undefined) { f.push(`can_add_members = $${i++}`); v.push(p.can_add_members); } if (p.can_manage_emojis !== undefined) { f.push(`can_manage_emojis = $${i++}`); v.push(p.can_manage_emojis); } v.push(g, u); return qOne(`UPDATE gc_members SET ${f.join(', ')} WHERE gc_id = $${i++} AND user_id = $${i} RETURNING *`, v); },
    transferOwnership: async (g: string, n: string) => { const c = await pool.connect(); try { await c.query('BEGIN'); await c.query("UPDATE gc_members SET role = 'admin' WHERE gc_id = $1 AND role = 'owner'", [g]); await c.query('UPDATE gc_members SET role = $1 WHERE gc_id = $2 AND user_id = $3', ['owner', g, n]); await c.query('UPDATE group_chats SET owner_id = $1, updated_at = NOW() WHERE id = $2', [n, g]); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } },
    isMember: async (g: string, u: string) => !!(await qOne('SELECT 1 FROM gc_members WHERE gc_id = $1 AND user_id = $2', [g, u])),
    getMemberCount: async (g: string) => parseInt(((await qOne('SELECT COUNT(*) as count FROM gc_members WHERE gc_id = $1', [g])) as any).count, 10),
    createMessage: async (id: string, data: CreateMessageData) => mapMsg(await qOne('INSERT INTO messages (id, gc_id, dm_conversation_id, sender_id, content, type, attachment_url, reply_to_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id, data.gc_id || null, data.dm_conversation_id || null, data.sender_id, data.content, data.type || 'text', data.attachment_url || null, data.reply_to_id || null])),
    getGCMessages: async (g: string, l = 50, b?: string) => { const sql = b ? `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT $3` : `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.gc_id = $1 ORDER BY m.created_at DESC LIMIT $2`; return (await qAll(sql, b ? [g, b, l] : [g, l])).map(mapMsg).filter(Boolean); },
    getDMMessages: async (c: string, l = 50, b?: string) => { const sql = b ? `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = $1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT $3` : `SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.dm_conversation_id = $1 ORDER BY m.created_at DESC LIMIT $2`; return (await qAll(sql, b ? [c, b, l] : [c, l])).map(mapMsg).filter(Boolean); },
    getMessageById: async (id: string) => mapMsg(await qOne(`SELECT m.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM messages m INNER JOIN users u ON m.sender_id = u.id WHERE m.id = $1`, [id])),
    deleteMessage: async (id: string) => { await q('DELETE FROM messages WHERE id = $1', [id]); },
    updateMessageContent: async (id: string, content: string) => { await q('UPDATE messages SET content = $1, edited_at = NOW() WHERE id = $2', [content, id]); return this.getMessageById(id); },
    getOrCreateDM: async (u1: string, u2: string) => { const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1]; const ex = await qOne('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [a, b]); if (ex) return ex; return qOne('INSERT INTO dm_conversations (id, user1_id, user2_id) VALUES ($1,$2,$3) RETURNING *', [genId(), a, b]); },
    getDMConversation: async (u1: string, u2: string) => { const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1]; return qOne('SELECT * FROM dm_conversations WHERE user1_id = $1 AND user2_id = $2', [a, b]); },
    getDMById: async (id: string) => qOne('SELECT * FROM dm_conversations WHERE id = $1', [id]),
    getUserDMs: async (u: string) => { const rows = await qAll(`SELECT dc.*, u.id as ouid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as oucreated_at, u.updated_at as ouupdated_at FROM dm_conversations dc INNER JOIN users u ON (CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END) = u.id WHERE dc.user1_id = $1 OR dc.user2_id = $1 ORDER BY dc.created_at DESC`, [u]); return rows.map(r => ({ id: r.id, user1_id: r.user1_id, user2_id: r.user2_id, created_at: ts(r.created_at), other_user: { id: r.ouid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.oucreated_at), updated_at: ts(r.ouupdated_at) } })); },
    sendFriendRequest: async (s: string, r: string) => qOne('INSERT INTO friend_requests (id, sender_id, receiver_id) VALUES ($1,$2,$3) RETURNING *', [genId(), s, r]),
    acceptFriendRequest: async (id: string) => { await q("UPDATE friend_requests SET status = 'accepted' WHERE id = $1", [id]); },
    declineFriendRequest: async (id: string) => { await q("UPDATE friend_requests SET status = 'declined' WHERE id = $1", [id]); },
    getPendingRequests: async (u: string) => { const rows = await qAll(`SELECT fr.*, s.id as sid, s.username, s.display_name, s.email, s.avatar_url, s.banner_url, s.bio, s.status, s.custom_status, s.last_seen, s.created_at as screated_at, s.updated_at as supdated_at FROM friend_requests fr INNER JOIN users s ON fr.sender_id = s.id WHERE fr.receiver_id = $1 AND fr.status = 'pending' ORDER BY fr.created_at DESC`, [u]); return rows.map(r => ({ id: r.id, sender_id: r.sender_id, receiver_id: r.receiver_id, status: r.status, created_at: ts(r.created_at), sender: { id: r.sid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.screated_at), updated_at: ts(r.supdated_at) } })); },
    getFriends: async (u: string) => (await qAll(`SELECT u.* FROM users u INNER JOIN friend_requests fr ON ((fr.sender_id = $1 AND fr.receiver_id = u.id) OR (fr.receiver_id = $1 AND fr.sender_id = u.id)) WHERE fr.status = 'accepted' ORDER BY u.display_name`, [u])).map(mapUser).filter(Boolean),
    removeFriend: async (u1: string, u2: string) => { await q('DELETE FROM friend_requests WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)', [u1, u2]); },
    areFriends: async (u1: string, u2: string) => !!(await qOne(`SELECT 1 FROM friend_requests WHERE status = 'accepted' AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`, [u1, u2])),
    blockUser: async (b: string, d: string) => { await q('INSERT INTO blocks (id, blocker_id, blocked_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [genId(), b, d]); },
    unblockUser: async (b: string, d: string) => { await q('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [b, d]); },
    isBlocked: async (b: string, d: string) => !!(await qOne('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [b, d])),
    getBlockedUsers: async (u: string) => (await qAll('SELECT u.* FROM users u INNER JOIN blocks b ON b.blocked_id = u.id WHERE b.blocker_id = $1 ORDER BY u.display_name', [u])).map(mapUser).filter(Boolean),
    addEmoji: async (g: string, n: string, i: string, u: string) => qOne('INSERT INTO custom_emojis (id, gc_id, name, image_url, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [genId(), g, n, i, u]),
    removeEmoji: async (id: string) => { await q('DELETE FROM custom_emojis WHERE id = $1', [id]); },
    getGCEmojis: async (g: string) => qAll('SELECT * FROM custom_emojis WHERE gc_id = $1 ORDER BY name', [g]),
    getEmojiById: async (id: string) => qOne('SELECT * FROM custom_emojis WHERE id = $1', [id]),
    joinVoice: async (g: string, u: string) => { await q('DELETE FROM voice_sessions WHERE user_id = $1', [u]); return qOne('INSERT INTO voice_sessions (id, gc_id, user_id) VALUES ($1,$2,$3) RETURNING *', [genId(), g, u]); },
    leaveVoice: async (g: string, u: string) => { await q('DELETE FROM voice_sessions WHERE gc_id = $1 AND user_id = $2', [g, u]); },
    getVoiceParticipants: async (g: string) => { const rows = await qAll(`SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.gc_id = $1 ORDER BY vs.joined_at`, [g]); return rows.map(r => ({ id: r.id, gc_id: r.gc_id, user_id: r.user_id, joined_at: ts(r.joined_at), user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } })); },
    getUserVoiceSession: async (u: string) => { const r = await qOne(`SELECT vs.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url, u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at FROM voice_sessions vs INNER JOIN users u ON vs.user_id = u.id WHERE vs.user_id = $1`, [u]); if (!r) return null; return { id: r.id, gc_id: r.gc_id, user_id: r.user_id, joined_at: ts(r.joined_at), user: { id: r.uid, username: r.username, display_name: r.display_name, email: r.email, avatar_url: r.avatar_url, banner_url: r.banner_url, bio: r.bio, status: r.status, custom_status: r.custom_status, last_seen: ts(r.last_seen), created_at: ts(r.ucreated_at), updated_at: ts(r.uupdated_at) } }; },
    banUser: async (g: string, u: string, r?: string) => { await q('INSERT INTO gc_bans (id, gc_id, user_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT (gc_id, user_id) DO UPDATE SET reason = EXCLUDED.reason', [genId(), g, u, r || null]); },
    unbanUser: async (g: string, u: string) => { await q('DELETE FROM gc_bans WHERE gc_id = $1 AND user_id = $2', [g, u]); },
    isBanned: async (g: string, u: string) => !!(await qOne('SELECT 1 FROM gc_bans WHERE gc_id = $1 AND user_id = $2', [g, u])),
    get raw() { return pool; },
  };
}

// ─── Export the right implementation ─────────────────────────────────────────

export const db: any = USE_SQLITE ? sqliteDb : (createPgDb() as any);
