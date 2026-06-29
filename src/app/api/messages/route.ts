import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gcId = searchParams.get('gcId');
    const dmId = searchParams.get('dmId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const before = searchParams.get('before') || undefined;

    if (gcId) {
      const messages = db.getGCMessages(gcId, limit, before);
      return NextResponse.json(messages);
    }

    if (dmId) {
      const messages = db.getDMMessages(dmId, limit, before);
      return NextResponse.json(messages);
    }

    return NextResponse.json(
      { error: 'Provide ?gcId=xxx or ?dmId=xxx' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}