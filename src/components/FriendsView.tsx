'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  UserPlusIcon,
  MessageSquareIcon,
  UserMinusIcon,
  CheckIcon,
  XIcon,
  BanIcon,
  UserSearchIcon,
  ClockIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  onSocketEvent,
  offSocketEvent,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
} from '@/lib/socket'
import type { User, FriendRequest, Block } from '@/lib/database'

// ─── Status helpers ──────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-amber-500',
  dnd: 'bg-red-500',
  invisible: 'bg-zinc-500',
  offline: 'bg-zinc-600',
}

function FriendAvatar({ user, className }: { user?: User; className?: string }) {
  const onlineUsers = useAppStore((s) => s.onlineUsers)
  const isOnline = user ? onlineUsers.includes(user.id) : false

  return (
    <div className={cn('relative shrink-0', className)}>
      <Avatar className="size-10">
        {user?.avatar_url && <AvatarImage src={user.avatar_url} alt={user.display_name} />}
        <AvatarFallback className="bg-zinc-600 text-zinc-200">
          {user?.display_name?.charAt(0)?.toUpperCase() || '?'}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 block size-3.5 rounded-full ring-2 ring-[#202225]',
          isOnline ? statusColors[user?.status === 'invisible' ? 'offline' : (user?.status || 'offline')] : 'bg-zinc-600'
        )}
      />
    </div>
  )
}

function formatLastSeen(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

// ─── FriendsView ─────────────────────────────────────────────────────────────

export default function FriendsView() {
  const currentUser = useAppStore((s) => s.currentUser)
  const friends = useAppStore((s) => s.friends)
  const pendingFriendRequests = useAppStore((s) => s.pendingFriendRequests)
  const onlineUsers = useAppStore((s) => s.onlineUsers)

  const [blockedUsers, setBlockedUsers] = useState<User[]>([])
  const [addQuery, setAddQuery] = useState('')
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)

  // Fetch blocked users
  const fetchBlocked = useCallback(async () => {
    try {
      const res = await fetch('/api/blocks')
      if (res.ok) {
        const data = await res.json()
        setBlockedUsers((data as Block[]).map((b) => b.blocked_user).filter(Boolean) as User[])
      }
    } catch {}
  }, [])

  useEffect(() => {
    fetchBlocked()
  }, [fetchBlocked])

  // Search users for add friend
  const searchUsers = useCallback(
    async (query: string) => {
      if (!query.trim() || !currentUser) {
        setSearchResults([])
        return
      }
      setSearching(true)
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(query)}&exclude=${currentUser.id}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(Array.isArray(data) ? data : [])
        }
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    },
    [currentUser]
  )

  // Socket events for friend updates
  useEffect(() => {
    const handleFriendAdded = (data: unknown) => {
      const { user } = data as { user: User }
      if (user) useAppStore.getState().addFriend(user)
    }
    const handleFriendRemoved = (data: unknown) => {
      const { userId } = data as { userId: string }
      useAppStore.getState().removeFriend(userId)
    }
    const handleRequestReceived = (data: unknown) => {
      const request = data as FriendRequest
      useAppStore.getState().addPendingRequest(request)
    }
    const handleRequestAccepted = (data: unknown) => {
      const { requestId, friend } = data as { requestId: string; friend: User }
      useAppStore.getState().updatePendingRequest(requestId, 'accepted')
      if (friend) useAppStore.getState().addFriend(friend)
    }
    const handleRequestDeclined = (data: unknown) => {
      const { requestId } = data as { requestId: string }
      useAppStore.getState().updatePendingRequest(requestId, 'declined')
    }

    onSocketEvent('friend:added', handleFriendAdded)
    onSocketEvent('friend:removed', handleFriendRemoved)
    onSocketEvent('friend:request:received', handleRequestReceived)
    onSocketEvent('friend:request:accepted', handleRequestAccepted)
    onSocketEvent('friend:request:declined', handleRequestDeclined)

    return () => {
      offSocketEvent('friend:added', handleFriendAdded)
      offSocketEvent('friend:removed', handleFriendRemoved)
      offSocketEvent('friend:request:received', handleRequestReceived)
      offSocketEvent('friend:request:accepted', handleRequestAccepted)
      offSocketEvent('friend:request:declined', handleRequestDeclined)
    }
  }, [])

  // Categorize pending requests
  const incomingRequests = pendingFriendRequests.filter(
    (r) => r.status === 'pending' && r.receiver_id === currentUser?.id
  )
  const outgoingRequests = pendingFriendRequests.filter(
    (r) => r.status === 'pending' && r.sender_id === currentUser?.id
  )

  const onlineFriends = friends.filter((f) => onlineUsers.includes(f.id))
  const isAlreadyFriend = (userId: string) => friends.some((f) => f.id === userId)
  const isPendingSent = (userId: string) =>
    outgoingRequests.some((r) => r.receiver_id === userId)

  // ─── Actions ───────────────────────────────────────────────────────────

  const handleSendRequest = (userId: string) => {
    sendFriendRequest(userId)
  }

  const handleAccept = (requestId: string) => {
    acceptFriendRequest(requestId)
  }

  const handleDecline = (requestId: string) => {
    declineFriendRequest(requestId)
  }

  const handleCancelRequest = async (requestId: string) => {
    try {
      await fetch(`/api/friends/requests/${requestId}`, { method: 'DELETE' })
      useAppStore.getState().updatePendingRequest(requestId, 'declined')
    } catch {}
  }

  const handleUnblock = async (userId: string) => {
    try {
      await fetch('/api/blocks/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedId: userId }),
      })
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch {}
  }

  const handleRemoveFriend = async (userId: string) => {
    try {
      await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId: userId }),
      })
      useAppStore.getState().removeFriend(userId)
    } catch {}
  }

  return (
    <div className="flex h-full flex-col bg-[#36393f]">
      {/* Header */}
      <div className="flex items-center border-b border-[#202225] px-4 py-3">
        <div className="flex items-center gap-2 rounded bg-[#202225] px-3 py-1.5">
          <UserSearchIcon className="size-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Find or start a conversation"
            className="w-48 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none"
            value={addQuery}
            onChange={(e) => {
              setAddQuery(e.target.value)
              searchUsers(e.target.value)
            }}
          />
        </div>
      </div>

      {/* Search Results Dropdown */}
      {searchResults.length > 0 && addQuery.trim() && (
        <div className="mx-4 mt-2 rounded-md border border-[#202225] bg-[#2f3136] shadow-lg">
          <ScrollArea className="max-h-48">
            {searchResults.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-white/5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FriendAvatar user={user} className="size-7 [&_svg]:size-7 [&>div]:size-7" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-100">{user.display_name}</p>
                    <p className="truncate text-xs text-zinc-400">@{user.username}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isAlreadyFriend(user.id) || isPendingSent(user.id)}
                  onClick={() => handleSendRequest(user.id)}
                >
                  <UserPlusIcon className="size-4" />
                  {isAlreadyFriend(user.id)
                    ? 'Friends'
                    : isPendingSent(user.id)
                    ? 'Pending'
                    : 'Add'}
                </Button>
              </div>
            ))}
          </ScrollArea>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="online" className="flex flex-1 flex-col overflow-hidden px-4 pt-2">
        <TabsList className="w-full bg-transparent p-0">
          <div className="flex w-full border-b border-[#202225]">
            <TabsTrigger
              value="online"
              className="flex-1 rounded-none border-b-2 border-transparent px-0 py-2 text-sm font-medium text-zinc-400 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Online
              {onlineFriends.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 rounded-full px-1 text-[10px]">
                  {onlineFriends.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="all"
              className="flex-1 rounded-none border-b-2 border-transparent px-0 py-2 text-sm font-medium text-zinc-400 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              All
              {friends.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 rounded-full px-1 text-[10px]">
                  {friends.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="pending"
              className="flex-1 rounded-none border-b-2 border-transparent px-0 py-2 text-sm font-medium text-zinc-400 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Pending
              {incomingRequests.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 rounded-full px-1 text-[10px]">
                  {incomingRequests.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="blocked"
              className="flex-1 rounded-none border-b-2 border-transparent px-0 py-2 text-sm font-medium text-zinc-400 data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-400 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Blocked
              {blockedUsers.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 rounded-full px-1 text-[10px]">
                  {blockedUsers.length}
                </Badge>
              )}
            </TabsTrigger>
          </div>
        </TabsList>

        {/* Online Tab */}
        <TabsContent value="online" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full max-h-[calc(100vh-180px)]">
            <div className="pb-2">
              <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Online — {onlineFriends.length}
              </h3>
              {onlineFriends.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-zinc-500">
                  No friends online
                </p>
              )}
              {onlineFriends.map((friend) => (
                <FriendItem
                  key={friend.id}
                  user={friend}
                  isOnline
                  onMessage={() => {}}
                  onRemove={() => handleRemoveFriend(friend.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* All Tab */}
        <TabsContent value="all" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full max-h-[calc(100vh-180px)]">
            <div className="pb-2">
              {onlineFriends.length > 0 && (
                <>
                  <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Online — {onlineFriends.length}
                  </h3>
                  {onlineFriends.map((friend) => (
                    <FriendItem
                      key={friend.id}
                      user={friend}
                      isOnline
                      onMessage={() => {}}
                      onRemove={() => handleRemoveFriend(friend.id)}
                    />
                  ))}
                </>
              )}
              {friends
                .filter((f) => !onlineUsers.includes(f.id))
                .length > 0 && (
                <>
                  <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Offline — {friends.length - onlineFriends.length}
                  </h3>
                  {friends
                    .filter((f) => !onlineUsers.includes(f.id))
                    .map((friend) => (
                      <FriendItem
                        key={friend.id}
                        user={friend}
                        isOnline={false}
                        onMessage={() => {}}
                        onRemove={() => handleRemoveFriend(friend.id)}
                      />
                    ))}
                </>
              )}
              {friends.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-zinc-500">
                  No friends yet. Use the search above to add some!
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Pending Tab */}
        <TabsContent value="pending" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full max-h-[calc(100vh-180px)]">
            <div className="pb-2">
              {incomingRequests.length > 0 && (
                <>
                  <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Incoming — {incomingRequests.length}
                  </h3>
                  {incomingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FriendAvatar user={req.sender} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {req.sender?.display_name || 'Unknown'}
                          </p>
                          <p className="truncate text-xs text-zinc-400">
                            Incoming Friend Request
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10 hover:text-emerald-300" onClick={() => handleAccept(req.id)}>
                          <CheckIcon className="size-4" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-red-400 border-red-400/30 hover:bg-red-400/10 hover:text-red-300" onClick={() => handleDecline(req.id)}>
                          <XIcon className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {outgoingRequests.length > 0 && (
                <>
                  <h3 className="mb-1 mt-3 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Outgoing — {outgoingRequests.length}
                  </h3>
                  {outgoingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FriendAvatar user={req.receiver} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-100">
                            {req.receiver?.display_name || 'Unknown'}
                          </p>
                          <p className="truncate text-xs text-zinc-400">
                            Outgoing Friend Request
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 text-zinc-400 hover:text-zinc-200"
                        onClick={() => handleCancelRequest(req.id)}
                      >
                        <XIcon className="size-4" />
                        Cancel
                      </Button>
                    </div>
                  ))}
                </>
              )}

              {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-zinc-500">
                  No pending requests
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Blocked Tab */}
        <TabsContent value="blocked" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full max-h-[calc(100vh-180px)]">
            <div className="pb-2">
              {blockedUsers.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-zinc-500">
                  No blocked users
                </p>
              )}
              {blockedUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FriendAvatar user={user} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {user.display_name}
                      </p>
                      <p className="truncate text-xs text-zinc-400">@{user.username}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-zinc-400 hover:text-zinc-200"
                    onClick={() => handleUnblock(user.id)}
                  >
                    <BanIcon className="size-4" />
                    Unblock
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Friend item row ─────────────────────────────────────────────────────────

function FriendItem({
  user,
  isOnline,
  onMessage,
  onRemove,
}: {
  user: User
  isOnline: boolean
  onMessage: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/5">
      <div className="flex items-center gap-3 min-w-0">
        <FriendAvatar user={user} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{user.display_name}</p>
          {user.custom_status ? (
            <p className="truncate text-xs text-zinc-400">{user.custom_status}</p>
          ) : !isOnline ? (
            <p className="flex items-center gap-1 text-xs text-zinc-500">
              <ClockIcon className="size-3" />
              {formatLastSeen(user.last_seen)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {isOnline && (
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-zinc-400 hover:text-zinc-100"
            onClick={onMessage}
          >
            <MessageSquareIcon className="size-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-zinc-400 hover:text-red-400"
          onClick={onRemove}
        >
          <UserMinusIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}