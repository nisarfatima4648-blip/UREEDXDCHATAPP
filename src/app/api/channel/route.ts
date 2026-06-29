import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

/**
 * Single endpoint for channel data: messages + emojis + members.
 * Cuts 3 round-trips → 1 when switching channels.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gcId = searchParams.get('gcId');
    const dmConversationId = searchParams.get('dmConversationId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const before = searchParams.get('before') || undefined;

    if (gcId) {
      const [messages, emojis, members] = await Promise.all([
        Promise.resolve(db.getGCMessages(gcId, limit, before)),
        Promise.resolve(db.getGCEmojis(gcId)),
        Promise.resolve(db.getGCMembers(gcId)),
      ]);
      return NextResponse.json({ messages, emojis, members });
    }

    if (dmConversationId) {
      const messages = db.getDMMessages(dmConversationId, limit, before);
      return NextResponse.json({ messages });
    }

    return NextResponse.json({ error: 'Provide gcId or dmConversationId' }, { status: 400 });
  } catch (error) {
    console.error('Channel data error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}