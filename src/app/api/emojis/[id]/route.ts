import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const emoji = db.getEmojiById(id);
    if (!emoji) {
      return NextResponse.json({ error: 'Emoji not found' }, { status: 404 });
    }

    db.removeEmoji(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove emoji error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}