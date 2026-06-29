import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gc = db.getGCById(id);
    if (!gc) {
      return NextResponse.json({ error: 'Group chat not found' }, { status: 404 });
    }

    // Get banned users with user info via raw query
    const bannedUsers = db.raw
      .query(`
        SELECT b.*, u.id as uid, u.username, u.display_name, u.email, u.avatar_url, u.banner_url,
          u.bio, u.status, u.custom_status, u.last_seen, u.created_at as ucreated_at, u.updated_at as uupdated_at
        FROM gc_bans b
        INNER JOIN users u ON b.user_id = u.id
        WHERE b.gc_id = ?
        ORDER BY b.created_at DESC
      `)
      .all(id) as Record<string, unknown>[];

    const result = bannedUsers.map((row) => ({
      id: row.id as string,
      gc_id: row.gc_id as string,
      user_id: row.user_id as string,
      reason: row.reason as string | null,
      created_at: row.created_at as string,
      user: {
        id: row.uid as string,
        username: row.username as string,
        display_name: row.display_name as string,
        email: row.email as string,
        avatar_url: row.avatar_url as string | null,
        banner_url: row.banner_url as string | null,
        bio: row.bio as string,
        status: row.status as string,
        custom_status: row.custom_status as string | null,
        last_seen: row.last_seen as string,
        created_at: row.ucreated_at as string,
        updated_at: row.uupdated_at as string,
      },
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get banned users error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}