import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';
import type { GCMember, UpdateMemberPermissions } from '@/lib/database';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await params;
    const member = await db.getMember(id, userId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    return NextResponse.json(member);
  } catch (error) {
    console.error('Get GC member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await params;
    const member = await db.getMember(id, userId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const body = await request.json();

    // Update role if provided
    if (body.role) {
      const validRoles: GCMember['role'][] = ['owner', 'admin', 'member'];
      if (!validRoles.includes(body.role)) {
        return NextResponse.json(
          { error: 'Invalid role. Must be owner, admin, or member' },
          { status: 400 }
        );
      }
      await db.updateMemberRole(id, userId, body.role);
    }

    // Update permissions if provided
    const perms: UpdateMemberPermissions = {};
    if (body.canKick !== undefined) perms.can_kick = body.canKick;
    if (body.canBan !== undefined) perms.can_ban = body.canBan;
    if (body.canAddMembers !== undefined) perms.can_add_members = body.canAddMembers;
    if (body.canManageEmojis !== undefined) perms.can_manage_emojis = body.canManageEmojis;

    if (Object.keys(perms).length > 0) {
      await db.updateMemberPermissions(id, userId, perms);
    }

    // Re-fetch the updated member with user info
    const updatedMember = await db.getMember(id, userId);
    return NextResponse.json(updatedMember);
  } catch (error) {
    console.error('Update GC member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await params;
    const member = await db.getMember(id, userId);
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Prevent removing the owner
    if (member.role === 'owner') {
      return NextResponse.json(
        { error: 'Cannot remove the owner. Transfer ownership first.' },
        { status: 400 }
      );
    }

    await db.removeMember(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove GC member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}