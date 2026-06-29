// ─── Runtime-adaptive SQLite import ─────────────────────────────────────────
// Bun runtime uses bun:sqlite; Next.js/webpack uses better-sqlite3.
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteDb = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _createDb: (path: string) => SqliteDb;

if (typeof Bun !== 'undefined') {
  // Bun runtime — native bun:sqlite
  // @ts-expect-error — bun:sqlite is a Bun-only built-in
  const bunMod = require(/* webpackIgnore: true */ 'bun:sqlite');
  _createDb = (p: string) => new bunMod.Database(p, { create: true });
} else {
  // Node.js / webpack runtime — better-sqlite3
  const betterSqlite3Mod = require('better-sqlite3');
  // When webpack externalizes, the module itself is the constructor
  const Ctor = betterSqlite3Mod.default || betterSqlite3Mod;
  _createDb = (p: string) => new Ctor(p);
}

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
  last_message?: Message;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  sender?: User;
  receiver?: User;
}

export interface Block {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: string;
  blocked_user?: User;
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

// Input types
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
// Helper: generate UUID
// =============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

// =============================================================================
// Database Class
// =============================================================================

export class Database {
  private db: SqliteDb;

  constructor(dbPath: string) {
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = _createDb(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.initializeTables();
  }

  // ---------------------------------------------------------------------------
  // Table Initialization
  // ---------------------------------------------------------------------------

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        avatar_url TEXT,
        banner_url TEXT,
        bio TEXT DEFAULT '',
        status TEXT DEFAULT 'offline',
        custom_status TEXT,
        last_seen TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS group_chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon_url TEXT,
        description TEXT DEFAULT '',
        owner_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS gc_members (
        id TEXT PRIMARY KEY,
        gc_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        can_kick INTEGER DEFAULT 0,
        can_ban INTEGER DEFAULT 0,
        can_add_members INTEGER DEFAULT 0,
        can_manage_emojis INTEGER DEFAULT 0,
        joined_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (gc_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(gc_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS dm_conversations (
        id TEXT PRIMARY KEY,
        user1_id TEXT NOT NULL,
        user2_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user1_id) REFERENCES users(id),
        FOREIGN KEY (user2_id) REFERENCES users(id),
        UNIQUE(user1_id, user2_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        gc_id TEXT,
        dm_conversation_id TEXT,
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'text',
        attachment_url TEXT,
        reply_to_id TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        edited_at TEXT,
        FOREIGN KEY (gc_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (dm_conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (reply_to_id) REFERENCES messages(id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_gc ON messages(gc_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_dm ON messages(dm_conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(sender_id, receiver_id)
      );

      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        blocker_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS custom_emojis (
        id TEXT PRIMARY KEY,
        gc_id TEXT NOT NULL,
        name TEXT NOT NULL,
        image_url TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (gc_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id),
        UNIQUE(gc_id, name)
      );

      CREATE TABLE IF NOT EXISTS voice_sessions (
        id TEXT PRIMARY KEY,
        gc_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (gc_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_voice_sessions_gc ON voice_sessions(gc_id);

      CREATE TABLE IF NOT EXISTS gc_bans (
        id TEXT PRIMARY KEY,
        gc_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (gc_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        UNIQUE(gc_id, user_id)
      );
    `);

    // ─── Migrations for existing databases ────────────────────────────────
    try {
      this.db.exec(`ALTER TABLE messages ADD COLUMN edited_at TEXT`);
    } catch {
      // Column already exists — ignore
    }
  }

  // ===========================================================================
  // Users
  // ===========================================================================

  createUser(id: string, username: string, displayName: string, email: string): User {
    const sql = `
      INSERT INTO users (id, username, display_name, email)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, username, displayName, email) as User;
  }

  getUserById(id: string): User | null {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null;
  }

  getUserByUsername(username: string): User | null {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | null;
  }

  updateUser(id: string, data: UpdateUserData): User {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(data.display_name);
    }
    if (data.avatar_url !== undefined) {
      fields.push('avatar_url = ?');
      values.push(data.avatar_url);
    }
    if (data.banner_url !== undefined) {
      fields.push('banner_url = ?');
      values.push(data.banner_url);
    }
    if (data.bio !== undefined) {
      fields.push('bio = ?');
      values.push(data.bio);
    }
    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }
    if (data.custom_status !== undefined) {
      fields.push('custom_status = ?');
      values.push(data.custom_status);
    }

    fields.push("updated_at = datetime('now')");
    values.push(id);

    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ? RETURNING *`;
    return this.db.prepare(sql).get(...values) as User;
  }

  updateUserStatus(id: string, status: User['status']): User {
    const sql = `
      UPDATE users SET status = ?, last_seen = datetime('now'), updated_at = datetime('now')
      WHERE id = ? RETURNING *
    `;
    return this.db.prepare(sql).get(status, id) as User;
  }

  deleteUser(id: string): void {
    // Delete all user data in proper order (respect FK constraints)
    this.db.prepare('DELETE FROM voice_sessions WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM gc_bans WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM custom_emojis WHERE uploaded_by = ?').run(id)
    this.db.prepare('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?').run(id, id)
    this.db.prepare('DELETE FROM messages WHERE sender_id = ?').run(id)
    // Remove from DMs
    this.db.prepare("DELETE FROM dm_conversations WHERE user1_id = ? OR user2_id = ?").run(id, id)
    // gc_members and friend_requests have ON DELETE CASCADE, but delete explicitly to be safe
    this.db.prepare('DELETE FROM gc_members WHERE user_id = ?').run(id)
    this.db.prepare('DELETE FROM friend_requests WHERE sender_id = ? OR receiver_id = ?').run(id, id)
    // Delete groups owned by this user
    const ownedGCs = this.db.prepare('SELECT id FROM group_chats WHERE owner_id = ?').all(id) as { id: string }[]
    for (const gc of ownedGCs) {
      this.db.prepare('DELETE FROM gc_members WHERE gc_id = ?').run(gc.id)
      this.db.prepare('DELETE FROM gc_bans WHERE gc_id = ?').run(gc.id)
      this.db.prepare('DELETE FROM custom_emojis WHERE gc_id = ?').run(gc.id)
      this.db.prepare('DELETE FROM messages WHERE gc_id = ?').run(gc.id)
      this.db.prepare('DELETE FROM voice_sessions WHERE gc_id = ?').run(gc.id)
      this.db.prepare('DELETE FROM group_chats WHERE id = ?').run(gc.id)
    }
    // Finally delete the user
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
  }

  searchUsers(query: string): User[] {
    const pattern = `%${query}%`;
    return this.db.prepare(
      `SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 50`
    ).all(pattern, pattern) as User[];
  }

  getAllUsers(): User[] {
    return this.db.prepare('SELECT * FROM users ORDER BY username').all() as User[];
  }

  // ===========================================================================
  // Group Chats
  // ===========================================================================

  createGC(id: string, name: string, ownerId: string, description?: string, iconUrl?: string): GroupChat {
    const sql = `
      INSERT INTO group_chats (id, name, description, icon_url, owner_id)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, name, description || '', iconUrl || null, ownerId) as GroupChat;
  }

  getGCById(id: string): GroupChat | null {
    const gc = this.db.prepare('SELECT * FROM group_chats WHERE id = ?').get(id) as GroupChat | null;
    if (gc) {
      const count = this.getMemberCount(id);
      return { ...gc, member_count: count };
    }
    return null;
  }

  getUserGCs(userId: string): GroupChat[] {
    const sql = `
      SELECT gc.*, COUNT(gm.user_id) as member_count
      FROM group_chats gc
      INNER JOIN gc_members gm ON gc.id = gm.gc_id
      WHERE gm.user_id = ?
      GROUP BY gc.id
      ORDER BY gc.name
    `;
    return this.db.prepare(sql).all(userId) as GroupChat[];
  }

  updateGC(id: string, data: UpdateGCData): GroupChat {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      fields.push('name = ?');
      values.push(data.name);
    }
    if (data.icon_url !== undefined) {
      fields.push('icon_url = ?');
      values.push(data.icon_url);
    }
    if (data.description !== undefined) {
      fields.push('description = ?');
      values.push(data.description);
    }

    fields.push("updated_at = datetime('now')");
    values.push(id);

    const sql = `UPDATE group_chats SET ${fields.join(', ')} WHERE id = ? RETURNING *`;
    return this.db.prepare(sql).get(...values) as GroupChat;
  }

  deleteGC(id: string): void {
    this.db.prepare('DELETE FROM group_chats WHERE id = ?').run(id);
  }

  // ===========================================================================
  // GC Members
  // ===========================================================================

  addMember(gcId: string, userId: string, role: GCMember['role'] = 'member'): GCMember {
    const id = generateId();
    const sql = `
      INSERT INTO gc_members (id, gc_id, user_id, role)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, gcId, userId, role) as GCMember;
  }

  removeMember(gcId: string, userId: string): void {
    this.db.prepare('DELETE FROM gc_members WHERE gc_id = ? AND user_id = ?').run(gcId, userId);
  }

  getMember(gcId: string, userId: string): GCMember | null {
    const sql = `
      SELECT gm.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
        u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
      FROM gc_members gm
      INNER JOIN users u ON gm.user_id = u.id
      WHERE gm.gc_id = ? AND gm.user_id = ?
    `;
    const row = this.db.prepare(sql).get(gcId, userId) as Record<string, unknown> | null;
    if (!row) return null;

    return {
      id: row.id as string,
      gc_id: row.gc_id as string,
      user_id: row.user_id as string,
      role: row.role as GCMember['role'],
      can_kick: Boolean(row.can_kick),
      can_ban: Boolean(row.can_ban),
      can_add_members: Boolean(row.can_add_members),
      can_manage_emojis: Boolean(row.can_manage_emojis),
      joined_at: row.joined_at as string,
      user: {
        id: row.uid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.ucreated_at as string,
        updated_at: row.uupdated_at as string,
      },
    };
  }

  getGCMembers(gcId: string): GCMember[] {
    const sql = `
      SELECT gm.*,
        u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
        u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
      FROM gc_members gm
      INNER JOIN users u ON gm.user_id = u.id
      WHERE gm.gc_id = ?
      ORDER BY
        CASE gm.role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          ELSE 2
        END,
        gm.joined_at
    `;
    const rows = this.db.prepare(sql).all(gcId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      gc_id: row.gc_id as string,
      user_id: row.user_id as string,
      role: row.role as GCMember['role'],
      can_kick: Boolean(row.can_kick),
      can_ban: Boolean(row.can_ban),
      can_add_members: Boolean(row.can_add_members),
      can_manage_emojis: Boolean(row.can_manage_emojis),
      joined_at: row.joined_at as string,
      user: {
        id: row.uid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.ucreated_at as string,
        updated_at: row.uupdated_at as string,
      },
    }));
  }

  updateMemberRole(gcId: string, userId: string, role: GCMember['role']): GCMember {
    const sql = `
      UPDATE gc_members SET role = ? WHERE gc_id = ? AND user_id = ? RETURNING *
    `;
    return this.db.prepare(sql).get(role, gcId, userId) as GCMember;
  }

  updateMemberPermissions(gcId: string, userId: string, perms: UpdateMemberPermissions): GCMember {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (perms.can_kick !== undefined) {
      fields.push('can_kick = ?');
      values.push(perms.can_kick ? 1 : 0);
    }
    if (perms.can_ban !== undefined) {
      fields.push('can_ban = ?');
      values.push(perms.can_ban ? 1 : 0);
    }
    if (perms.can_add_members !== undefined) {
      fields.push('can_add_members = ?');
      values.push(perms.can_add_members ? 1 : 0);
    }
    if (perms.can_manage_emojis !== undefined) {
      fields.push('can_manage_emojis = ?');
      values.push(perms.can_manage_emojis ? 1 : 0);
    }

    values.push(gcId, userId);

    const sql = `UPDATE gc_members SET ${fields.join(', ')} WHERE gc_id = ? AND user_id = ? RETURNING *`;
    const row = this.db.prepare(sql).get(...values) as Record<string, unknown>;
    return {
      id: row.id as string,
      gc_id: row.gc_id as string,
      user_id: row.user_id as string,
      role: row.role as GCMember['role'],
      can_kick: Boolean(row.can_kick),
      can_ban: Boolean(row.can_ban),
      can_add_members: Boolean(row.can_add_members),
      can_manage_emojis: Boolean(row.can_manage_emojis),
      joined_at: row.joined_at as string,
    };
  }

  transferOwnership(gcId: string, newOwnerId: string): void {
    const db = this.db;
    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE gc_members SET role = 'admin'
        WHERE gc_id = ? AND role = 'owner'
      `).run(gcId);
      db.prepare(`
        UPDATE gc_members SET role = 'owner'
        WHERE gc_id = ? AND user_id = ?
      `).run(gcId, newOwnerId);
      db.prepare(`
        UPDATE group_chats SET owner_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newOwnerId, gcId);
    });
    transaction();
  }

  isMember(gcId: string, userId: string): boolean {
    const result = this.db.prepare(
      'SELECT 1 as row_exists FROM gc_members WHERE gc_id = ? AND user_id = ?'
    ).get(gcId, userId) as { row_exists: number } | undefined;
    return !!result;
  }

  getMemberCount(gcId: string): number {
    const result = this.db.prepare(
      'SELECT COUNT(*) as count FROM gc_members WHERE gc_id = ?'
    ).get(gcId) as { count: number };
    return result.count;
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  createMessage(id: string, data: CreateMessageData): Message {
    const sql = `
      INSERT INTO messages (id, gc_id, dm_conversation_id, sender_id, content, type, attachment_url, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(
      id,
      data.gc_id || null,
      data.dm_conversation_id || null,
      data.sender_id,
      data.content,
      data.type || 'text',
      data.attachment_url || null,
      data.reply_to_id || null,
    ) as Message;
  }

  getGCMessages(gcId: string, limit: number = 50, before?: string): Message[] {
    let sql: string;
    let params: unknown[];

    if (before) {
      sql = `
        SELECT m.*,
          u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
          u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
        FROM messages m
        INNER JOIN users u ON m.sender_id = u.id
        WHERE m.gc_id = ? AND m.created_at < ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = [gcId, before, limit];
    } else {
      sql = `
        SELECT m.*,
          u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
          u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
        FROM messages m
        INNER JOIN users u ON m.sender_id = u.id
        WHERE m.gc_id = ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = [gcId, limit];
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.mapMessageRow(row));
  }

  getDMMessages(conversationId: string, limit: number = 50, before?: string): Message[] {
    let sql: string;
    let params: unknown[];

    if (before) {
      sql = `
        SELECT m.*,
          u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
          u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
        FROM messages m
        INNER JOIN users u ON m.sender_id = u.id
        WHERE m.dm_conversation_id = ? AND m.created_at < ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = [conversationId, before, limit];
    } else {
      sql = `
        SELECT m.*,
          u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
          u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
        FROM messages m
        INNER JOIN users u ON m.sender_id = u.id
        WHERE m.dm_conversation_id = ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `;
      params = [conversationId, limit];
    }

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.mapMessageRow(row));
  }

  getMessageById(id: string): Message | null {
    const sql = `
      SELECT m.*,
        u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
        u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
      FROM messages m
      INNER JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `;
    const row = this.db.prepare(sql).get(id) as Record<string, unknown> | null;
    if (!row) return null;
    return this.mapMessageRow(row);
  }

  deleteMessage(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }

  updateMessageContent(id: string, content: string): Message | null {
    this.db.prepare('UPDATE messages SET content = ?, edited_at = datetime(\'now\') WHERE id = ?').run(content, id);
    return this.getMessageById(id);
  }

  private mapMessageRow(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      gc_id: row.gc_id as string | null,
      dm_conversation_id: row.dm_conversation_id as string | null,
      sender_id: row.sender_id as string,
      content: row.content as string,
      type: row.type as Message['type'],
      attachment_url: row.attachment_url as string | null,
      reply_to_id: row.reply_to_id as string | null,
      created_at: row.created_at as string,
      edited_at: (row.edited_at as string) || null,
      sender: {
        id: row.uid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.ucreated_at as string,
        updated_at: row.uupdated_at as string,
      },
    };
  }

  // ===========================================================================
  // DM Conversations
  // ===========================================================================

  getOrCreateDM(user1Id: string, user2Id: string): DMConversation {
    const [u1, u2] = user1Id < user2Id ? [user1Id, user2Id] : [user2Id, user1Id];

    const existing = this.db.prepare(
      'SELECT * FROM dm_conversations WHERE user1_id = ? AND user2_id = ?'
    ).get(u1, u2) as DMConversation | undefined;

    if (existing) return existing;

    const id = generateId();
    const sql = `
      INSERT INTO dm_conversations (id, user1_id, user2_id)
      VALUES (?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, u1, u2) as DMConversation;
  }

  getDMConversation(userId1: string, userId2: string): DMConversation | null {
    const [u1, u2] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];

    return this.db.prepare(
      'SELECT * FROM dm_conversations WHERE user1_id = ? AND user2_id = ?'
    ).get(u1, u2) as DMConversation | null;
  }

  getDMById(id: string): DMConversation | null {
    return this.db.prepare(
      'SELECT * FROM dm_conversations WHERE id = ?'
    ).get(id) as DMConversation | null;
  }

  getUserDMs(userId: string): DMConversation[] {
    const sql = `
      SELECT dc.*,
        u.id as ouid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
        u.bio, u.status, u.custom_status, u.last_seen, u.created_at as oucreated_at, u.updated_at as ouupdated_at
      FROM dm_conversations dc
      INNER JOIN users u ON (CASE WHEN dc.user1_id = ? THEN dc.user2_id ELSE dc.user1_id END) = u.id
      WHERE dc.user1_id = ? OR dc.user2_id = ?
      ORDER BY dc.created_at DESC
    `;
    const rows = this.db.prepare(sql).all(userId, userId, userId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      user1_id: row.user1_id as string,
      user2_id: row.user2_id as string,
      created_at: row.created_at as string,
      other_user: {
        id: row.ouid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.oucreated_at as string,
        updated_at: row.ouupdated_at as string,
      },
    }));
  }

  // ===========================================================================
  // Friends
  // ===========================================================================

  sendFriendRequest(senderId: string, receiverId: string): FriendRequest {
    const id = generateId();
    const sql = `
      INSERT INTO friend_requests (id, sender_id, receiver_id)
      VALUES (?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, senderId, receiverId) as FriendRequest;
  }

  acceptFriendRequest(id: string): void {
    this.db.prepare(
      "UPDATE friend_requests SET status = 'accepted' WHERE id = ?"
    ).run(id);
  }

  declineFriendRequest(id: string): void {
    this.db.prepare(
      "UPDATE friend_requests SET status = 'declined' WHERE id = ?"
    ).run(id);
  }

  getPendingRequests(userId: string): FriendRequest[] {
    const sql = `
      SELECT fr.*,
        s.id as sid, s.username, s.display_name, s.email, s.avatar_url, s.banner_url,
        s.bio, s.status, s.custom_status, s.last_seen, s.created_at as screated_at, s.updated_at as supdated_at
      FROM friend_requests fr
      INNER JOIN users s ON fr.sender_id = s.id
      WHERE fr.receiver_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `;
    const rows = this.db.prepare(sql).all(userId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      sender_id: row.sender_id as string,
      receiver_id: row.receiver_id as string,
      status: row.status as FriendRequest['status'],
      created_at: row.created_at as string,
      sender: {
        id: row.sid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.screated_at as string,
        updated_at: row.supdated_at as string,
      },
    }));
  }

  getFriends(userId: string): User[] {
    const sql = `
      SELECT u.* FROM users u
      INNER JOIN friend_requests fr ON (
        (fr.sender_id = ? AND fr.receiver_id = u.id)
        OR (fr.receiver_id = ? AND fr.sender_id = u.id)
      )
      WHERE fr.status = 'accepted'
      ORDER BY u.display_name
    `;
    return this.db.prepare(sql).all(userId, userId) as User[];
  }

  removeFriend(userId: string, otherUserId: string): void {
    this.db.prepare(`
      DELETE FROM friend_requests
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
    `).run(userId, otherUserId, otherUserId, userId);
  }

  areFriends(userId1: string, userId2: string): boolean {
    const result = this.db.prepare(`
      SELECT 1 as row_exists FROM friend_requests
      WHERE status = 'accepted'
        AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
    `).get(userId1, userId2, userId2, userId1) as { row_exists: number } | undefined;

    return !!result;
  }

  // ===========================================================================
  // Blocks
  // ===========================================================================

  blockUser(blockerId: string, blockedId: string): void {
    const id = generateId();
    this.db.prepare(`
      INSERT OR IGNORE INTO blocks (id, blocker_id, blocked_id)
      VALUES (?, ?, ?)
    `).run(id, blockerId, blockedId);
  }

  unblockUser(blockerId: string, blockedId: string): void {
    this.db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId);
  }

  isBlocked(blockerId: string, blockedId: string): boolean {
    const result = this.db.prepare(
      'SELECT 1 as row_exists FROM blocks WHERE blocker_id = ? AND blocked_id = ?'
    ).get(blockerId, blockedId) as { row_exists: number } | undefined;
    return !!result;
  }

  getBlockedUsers(userId: string): User[] {
    const sql = `
      SELECT u.* FROM users u
      INNER JOIN blocks b ON b.blocked_id = u.id
      WHERE b.blocker_id = ?
      ORDER BY u.display_name
    `;
    return this.db.prepare(sql).all(userId) as User[];
  }

  // ===========================================================================
  // Custom Emojis
  // ===========================================================================

  addEmoji(gcId: string, name: string, imageUrl: string, uploadedBy: string): CustomEmoji {
    const id = generateId();
    const sql = `
      INSERT INTO custom_emojis (id, gc_id, name, image_url, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, gcId, name, imageUrl, uploadedBy) as CustomEmoji;
  }

  removeEmoji(emojiId: string): void {
    this.db.prepare('DELETE FROM custom_emojis WHERE id = ?').run(emojiId);
  }

  getGCEmojis(gcId: string): CustomEmoji[] {
    return this.db.prepare(
      'SELECT * FROM custom_emojis WHERE gc_id = ? ORDER BY name'
    ).all(gcId) as CustomEmoji[];
  }

  getEmojiById(emojiId: string): CustomEmoji | null {
    return this.db.prepare('SELECT * FROM custom_emojis WHERE id = ?').get(emojiId) as CustomEmoji | null;
  }

  // ===========================================================================
  // Voice Sessions
  // ===========================================================================

  joinVoice(gcId: string, userId: string): VoiceSession {
    this.db.prepare('DELETE FROM voice_sessions WHERE user_id = ?').run(userId);

    const id = generateId();
    const sql = `
      INSERT INTO voice_sessions (id, gc_id, user_id)
      VALUES (?, ?, ?)
      RETURNING *
    `;
    return this.db.prepare(sql).get(id, gcId, userId) as VoiceSession;
  }

  leaveVoice(gcId: string, userId: string): void {
    this.db.prepare('DELETE FROM voice_sessions WHERE gc_id = ? AND user_id = ?').run(gcId, userId);
  }

  getVoiceParticipants(gcId: string): VoiceSession[] {
    const sql = `
      SELECT vs.*,
        u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
        u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
      FROM voice_sessions vs
      INNER JOIN users u ON vs.user_id = u.id
      WHERE vs.gc_id = ?
      ORDER BY vs.joined_at
    `;
    const rows = this.db.prepare(sql).all(gcId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      gc_id: row.gc_id as string,
      user_id: row.user_id as string,
      joined_at: row.joined_at as string,
      user: {
        id: row.uid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.ucreated_at as string,
        updated_at: row.uupdated_at as string,
      },
    }));
  }

  getUserVoiceSession(userId: string): VoiceSession | null {
    const sql = `
      SELECT vs.*,
        u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
        u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
      FROM voice_sessions vs
      INNER JOIN users u ON vs.user_id = u.id
      WHERE vs.user_id = ?
    `;
    const row = this.db.prepare(sql).get(userId) as Record<string, unknown> | null;
    if (!row) return null;

    return {
      id: row.id as string,
      gc_id: row.gc_id as string,
      user_id: row.user_id as string,
      joined_at: row.joined_at as string,
      user: {
        id: row.uid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as User['status'],
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.ucreated_at as string,
        updated_at: row.uupdated_at as string,
      },
    };
  }

  // ===========================================================================
  // GC Bans
  // ===========================================================================

  banUser(gcId: string, userId: string, reason?: string): void {
    const id = generateId();
    this.db.prepare(`
      INSERT OR REPLACE INTO gc_bans (id, gc_id, user_id, reason)
      VALUES (?, ?, ?, ?)
    `).run(id, gcId, userId, reason || null);
  }

  unbanUser(gcId: string, userId: string): void {
    this.db.prepare('DELETE FROM gc_bans WHERE gc_id = ? AND user_id = ?').run(gcId, userId);
  }

  isBanned(gcId: string, userId: string): boolean {
    const result = this.db.prepare(
      'SELECT 1 as row_exists FROM gc_bans WHERE gc_id = ? AND user_id = ?'
    ).get(gcId, userId) as { row_exists: number } | undefined;
    return !!result;
  }

  // ===========================================================================
  // Raw database access (for advanced queries)
  // ===========================================================================

  get raw(): BunSQLiteType {
    return this.db;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

const DB_PATH = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace('file:', '')
  : '/tmp/ureedxdchat-db/custom.db';

export const db = new Database(DB_PATH);
