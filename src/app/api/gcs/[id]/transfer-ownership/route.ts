import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

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
    const { newOwnerId } = body;

    if (!newOwnerId) {
      return NextResponse.json(
        { error: 'newOwnerId is required' },
        { status: 400 }
      );
    }

    // Verify new owner is a member
    if (!await db.isMember(id, newOwnerId)) {
      return NextResponse.json(
        { error: 'New owner must be a member of this group' },
        { status: 400 }
      );
    }

    await db.transferOwnership(id, newOwnerId);

    // Re-fetch the updated GC
    const updatedGC = await db.getGCById(id);
    return NextResponse.json(updatedGC);
  } catch (error) {
    console.error('Transfer ownership error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}