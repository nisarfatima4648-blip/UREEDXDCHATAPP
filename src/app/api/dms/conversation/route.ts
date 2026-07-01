import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

/** Notify chat-service about a new DM conversation (fire-and-forget) */
async function notifyChatService(conversation: any, creatorId: string, otherUser: any) {
  try {
    const creatorUser = await db.getUserById(creatorId);
    fetch(`http://localhost:3004/api/internal/dm-conversation-created`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversation.id,
        user1Id: conversation.user1_id,
        user2Id: conversation.user2_id,
        creatorId,
        otherUser: otherUser ? {
          id: otherUser.id,
          username: otherUser.username,
          displayName: otherUser.display_name,
          avatarUrl: otherUser.avatar_url,
          status: otherUser.status,
        } : null,
        creatorUser: creatorUser ? {
          id: creatorUser.id,
          username: creatorUser.username,
          displayName: creatorUser.display_name,
          avatarUrl: creatorUser.avatar_url,
          status: creatorUser.status,
        } : null,
      }),
    }).catch(() => {}); // fire-and-forget
  } catch {
    // ignore
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user1Id = searchParams.get('user1Id');
    const user2Id = searchParams.get('user2Id');

    if (!user1Id || !user2Id) {
      return NextResponse.json(
        { error: 'user1Id and user2Id query parameters are required' },
        { status: 400 }
      );
    }

    if (user1Id === user2Id) {
      return NextResponse.json(
        { error: 'Cannot create a DM conversation with yourself' },
        { status: 400 }
      );
    }

    const conversation = await db.getOrCreateDM(user1Id, user2Id);

    // Also get the other user's info
    const otherUserId = conversation.user1_id === user1Id ? conversation.user2_id : conversation.user1_id;
    const otherUser = await db.getUserById(otherUserId);

    // Check if this is a newly created DM (no messages yet and very recent)
    // Always notify so the other user gets the DM in their sidebar in real-time
    // The client's addDMConversation handler deduplicates by ID
    await notifyChatService(conversation, user1Id, otherUser);

    return NextResponse.json({
      ...conversation,
      other_user: otherUser,
    });
  } catch (error) {
    console.error('Get/create DM conversation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}