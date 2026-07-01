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

    const gcs = await db.getUserGCs(userId);
    return NextResponse.json(gcs);
  } catch (error) {
    console.error('Get GCs error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, ownerId, description, iconUrl } = body;

    if (!name || !ownerId) {
      return NextResponse.json(
        { error: 'name and ownerId are required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const gc = await db.createGC(id, name, ownerId, description, iconUrl);

    // Add the owner as a member with 'owner' role
    await db.addMember(id, ownerId, 'owner');

    // Re-fetch to include member_count
    const gcWithCount = await db.getGCById(id);
    return NextResponse.json(gcWithCount, { status: 201 });
  } catch (error) {
    console.error('Create GC error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}