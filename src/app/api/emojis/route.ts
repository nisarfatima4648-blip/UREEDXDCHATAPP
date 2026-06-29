import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gcId = searchParams.get('gcId');

    if (!gcId) {
      return NextResponse.json(
        { error: 'gcId query parameter is required' },
        { status: 400 }
      );
    }

    const emojis = db.getGCEmojis(gcId);
    return NextResponse.json(emojis);
  } catch (error) {
    console.error('Get emojis error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gcId, name, imageUrl, uploadedBy } = body;

    if (!gcId || !name || !imageUrl || !uploadedBy) {
      return NextResponse.json(
        { error: 'gcId, name, imageUrl, and uploadedBy are required' },
        { status: 400 }
      );
    }

    const emoji = db.addEmoji(gcId, name, imageUrl, uploadedBy);
    return NextResponse.json(emoji, { status: 201 });
  } catch (error) {
    console.error('Add emoji error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}