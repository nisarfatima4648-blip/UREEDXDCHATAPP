'use client'

import { useState, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { UserPlusIcon, SearchIcon, LoaderIcon } from 'lucide-react'
import { addGCMember } from '@/lib/socket'
import type { User } from '@/lib/database'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gcId: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddMemberDialog({ open, onOpenChange, gcId }: AddMemberDialogProps) {
  const currentUser = useAppStore((s) => s.currentUser)
  const gcMembers = useAppStore((s) => s.gcMembers)

  const members = gcMembers[gcId] || []
  const existingIds = new Set(members.map((m) => m.user_id))

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())

  const searchUsers = useCallback(
    async (q: string) => {
      if (!q.trim() || !currentUser) {
        setResults([])
        return
      }
      setSearching(true)
      try {
        const res = await fetch(
          `/api/users?q=${encodeURIComponent(q)}&exclude=${currentUser.id}`
        )
        if (res.ok) {
          const data = await res.json()
          // Filter out users already in the GC
          const filtered = (Array.isArray(data) ? data : []).filter(
            (u: User) => !existingIds.has(u.id)
          )
          setResults(filtered)
        }
      } catch {
        setResults([])
      }
      setSearching(false)
    },
    [currentUser, existingIds]
  )

  const handleSearch = (value: string) => {
    setQuery(value)
    searchUsers(value)
  }

  const handleAdd = async (userId: string) => {
    setAddingIds((prev) => new Set(prev).add(userId))
    addGCMember(gcId, userId)
    // Optimistic update: remove from results
    setResults((prev) => prev.filter((u) => u.id !== userId))
    // Clear adding state after a short delay
    setTimeout(() => {
      setAddingIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }, 1500)
  }

  const handleClose = () => {
    setQuery('')
    setResults([])
    setAddingIds(new Set())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm bg-[#36393f] border-[#202225] text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Add Members</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Search for users to add to this group chat
          </DialogDescription>
        </DialogHeader>

        {/* Search Input */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by username..."
            className="border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500 pl-9"
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="max-h-64 min-h-[120px] overflow-hidden">
          {searching ? (
            <div className="flex items-center justify-center py-8">
              <LoaderIcon className="size-5 animate-spin text-zinc-400" />
            </div>
          ) : results.length === 0 && query.trim() ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              No users found
            </p>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">
              Type a username to search
            </p>
          ) : (
            <ScrollArea className="max-h-64">
              <div className="flex flex-col gap-0.5">
                {results.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-white/5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="size-8">
                        {user.avatar_url && <AvatarImage src={user.avatar_url} />}
                        <AvatarFallback className="bg-zinc-600 text-sm text-zinc-200">
                          {user.display_name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {user.display_name}
                        </p>
                        <p className="truncate text-xs text-zinc-400">
                          @{user.username}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={addingIds.has(user.id)}
                      className="shrink-0 gap-1.5 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                      onClick={() => handleAdd(user.id)}
                    >
                      {addingIds.has(user.id) ? (
                        <LoaderIcon className="size-3.5 animate-spin" />
                      ) : (
                        <UserPlusIcon className="size-3.5" />
                      )}
                      {addingIds.has(user.id) ? 'Adding...' : 'Add'}
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}