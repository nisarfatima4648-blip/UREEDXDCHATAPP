import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, displayName, email } = body;

    if (!username || !displayName) {
      return NextResponse.json(
        { error: 'Username and display name are required' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existing = await db.getUserByUsername(username);
    if (existing) {
      return NextResponse.json(
        { error: 'Username already taken' },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    // Auto-generate a placeholder email if not provided
    const userEmail = email || `${username}@gc.local`;
    const user = await db.createUser(id, username, displayName, userEmail);
    await db.updateUserStatus(id, 'online');

    const updatedUser = await db.getUserById(id);
    return NextResponse.json(updatedUser, { status: 201 });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}