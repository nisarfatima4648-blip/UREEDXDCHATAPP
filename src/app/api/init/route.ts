import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

/**
 * Single endpoint that returns ALL initial data in one request.
 * Cuts 4 sequential round-trips → 1.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Fire all queries in parallel
    const [gcs, dms, friends, requests] = await Promise.all([
      Promise.resolve(db.getUserGCs(userId)),
      Promise.resolve(db.getUserDMs(userId)),
      Promise.resolve(db.getFriends(userId)),
      Promise.resolve(db.getPendingRequests(userId)),
    ]);

    // Load all custom emojis for every GC the user is in
    const allGCEmojis: Record<string, any[]> = {};
    for (const gc of gcs) {
      allGCEmojis[gc.id] = db.getGCEmojis(gc.id);
    }

    return NextResponse.json({
      gcs,
      dms,
      friends,
      requests,
      gcEmojis: allGCEmojis,
    });
  } catch (error) {
    console.error('Init error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}