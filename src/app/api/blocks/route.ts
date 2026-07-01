import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId query parameter is required' },
        { status: 400 }
      );
    }

    const blockedUsers = await db.getBlockedUsers(userId);
    return NextResponse.json(blockedUsers);
  } catch (error) {
    console.error('Get blocked users error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blockerId, blockedId } = body;

    if (!blockerId || !blockedId) {
      return NextResponse.json(
        { error: 'blockerId and blockedId are required' },
        { status: 400 }
      );
    }

    if (blockerId === blockedId) {
      return NextResponse.json(
        { error: 'Cannot block yourself' },
        { status: 400 }
      );
    }

    await db.blockUser(blockerId, blockedId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Block user error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}