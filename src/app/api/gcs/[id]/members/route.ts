import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';
import type { GCMember } from '@/lib/database';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const members = await db.getGCMembers(id);
    return NextResponse.json(members);
  } catch (error) {
    console.error('Get GC members error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gc = await db.getGCById(id);
    if (!gc) {
      return NextResponse.json({ error: 'Group chat not found' }, { status: 404 });
    }

    const body = await request.json();
    const { userId, role } = body as { userId: string; role?: GCMember['role'] };

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Check if user is already a member
    if (await db.isMember(id, userId)) {
      return NextResponse.json(
        { error: 'User is already a member' },
        { status: 409 }
      );
    }

    // Check if user is banned
    if (await db.isBanned(id, userId)) {
      return NextResponse.json(
        { error: 'User is banned from this group' },
        { status: 403 }
      );
    }

    const member = await db.addMember(id, userId, role || 'member');
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    console.error('Add GC member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}