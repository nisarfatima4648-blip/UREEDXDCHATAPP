import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const userId = searchParams.get('userId');

    // Get single user by ID
    if (userId) {
      const user = db.getUserById(userId);
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      return NextResponse.json(user);
    }

    // Search users by query
    if (q) {
      const excludeUserId = searchParams.get('excludeUserId');
      let users = db.searchUsers(q);

      if (excludeUserId) {
        users = users.filter((u) => u.id !== excludeUserId);
      }

      return NextResponse.json(users);
    }

    return NextResponse.json(
      { error: 'Provide ?q=searchterm or ?userId=xxx' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Users search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}