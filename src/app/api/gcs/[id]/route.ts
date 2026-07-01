import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';
import type { UpdateGCData } from '@/lib/database';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gc = await db.getGCById(id);
    if (!gc) {
      return NextResponse.json({ error: 'Group chat not found' }, { status: 404 });
    }
    return NextResponse.json(gc);
  } catch (error) {
    console.error('Get GC error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
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
    const data: UpdateGCData = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.iconUrl !== undefined) data.icon_url = body.iconUrl;

    const updatedGC = await db.updateGC(id, data);
    // Re-fetch to include member_count
    const gcWithCount = await db.getGCById(id);
    return NextResponse.json(gcWithCount);
  } catch (error) {
    console.error('Update GC error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gc = await db.getGCById(id);
    if (!gc) {
      return NextResponse.json({ error: 'Group chat not found' }, { status: 404 });
    }

    await db.deleteGC(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete GC error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}