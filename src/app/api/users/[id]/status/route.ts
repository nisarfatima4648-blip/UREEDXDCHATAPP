import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';
import type { User } from '@/lib/database';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await db.getUserById(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const validStatuses: User['status'][] = ['online', 'idle', 'dnd', 'invisible', 'offline'];

    if (!body.status || !validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be online, idle, dnd, or invisible' },
        { status: 400 }
      );
    }

    const updatedUser = await db.updateUserStatus(id, body.status);
    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Update status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}