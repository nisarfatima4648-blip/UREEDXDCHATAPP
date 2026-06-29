import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ gcId: string }> }
) {
  try {
    const { gcId } = await params;
    const participants = db.getVoiceParticipants(gcId);
    return NextResponse.json(participants);
  } catch (error) {
    console.error('Get voice participants error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}