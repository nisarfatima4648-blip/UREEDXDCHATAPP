'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { UserAvatar } from '@/components/UserAvatar'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────

interface StartDMDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SearchUser {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  status: string
}

// ─── Component ────────────────────────────────────────────────────────────

export function StartDMDialog({ open, onOpenChange }: StartDMDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const currentUser = useAppStore((s) => s.currentUser)
  const onlineUsers = useAppStore((s) => s.onlineUsers)
  const addDMConversation = useAppStore((s) => s.addDMConversation)
  const selectDM = useAppStore((s) => s.selectDM)

  // Search users with debounce
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setError('')
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query.trim() || query.length < 2) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setError('')
      try {
        const res = await fetch(
          `/api/users?q=${encodeURIComponent(query.trim())}&exclude=${currentUser?.id || ''}`
        )
        if (!res.ok) {
          setError('Failed to search users')
          return
        }
        const users = await res.json()
        setResults(users)
      } catch {
        setError('Network error')
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open, currentUser?.id])

  const handleSelectUser = useCallback(
    async (user: SearchUser) => {
      if (!currentUser) return

      try {
        const res = await fetch(
          `/api/dms/conversation?user1Id=${currentUser.id}&user2Id=${user.id}`
        )

        if (!res.ok) {
          setError('Failed to start conversation')
          return
        }

        const conversation = await res.json()
        addDMConversation(conversation)
        selectDM(conversation.id)
        onOpenChange(false)
      } catch {
        setError('Network error')
      }
    },
    [currentUser, addDMConversation, selectDM, onOpenChange]
  )

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setQuery('')
        setResults([])
        setError('')
      }
      onOpenChange(newOpen)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#2a2a4a] border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Find or Start a Conversation</DialogTitle>
          <DialogDescription className="text-slate-400">
            Search for a user to start a direct message.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a username to search..."
            className="border-white/10 bg-white/5 pl-10 pr-9 text-white placeholder:text-slate-500 focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
            autoFocus
            maxLength={50}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
            <p className="text-sm text-rose-400">{error}</p>
          </div>
        )}

        {/* Results */}
        <ScrollArea className="max-h-64">
          {searching && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              <span className="text-sm text-slate-400">Searching...</span>
            </div>
          )}

          {!searching && query.trim().length >= 2 && results.length === 0 && !error && (
            <p className="py-8 text-center text-sm text-slate-500">
              No users found for &quot;{query}&quot;
            </p>
          )}

          {!searching && results.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {results.map((user) => {
                const isOnline = onlineUsers.includes(user.id)

                return (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all',
                      'text-slate-300 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <UserAvatar
                      user={{
                        avatar_url: user.avatar_url,
                        username: user.username,
                        status: isOnline ? 'online' : 'offline',
                      }}
                      size="md"
                      showStatus
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user.display_name}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {user.username}
                      </p>
                    </div>
                    {isOnline && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {!searching && query.trim().length < 2 && (
            <p className="py-8 text-center text-sm text-slate-500">
              Type at least 2 characters to search
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
