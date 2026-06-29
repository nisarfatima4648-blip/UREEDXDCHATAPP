'use client'

import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import type { GroupChat } from '@/lib/database'

// ─── Types ─────────────────────────────────────────────────────────────────

interface CreateGCDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Component ────────────────────────────────────────────────────────────

export function CreateGCDialog({ open, onOpenChange }: CreateGCDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const addGC = useAppStore((s) => s.addGC)
  const selectGC = useAppStore((s) => s.selectGC)
  const currentUser = useAppStore((s) => s.currentUser)

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/gcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ownerId: currentUser?.id,
          description: description.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create group chat')
        return
      }

      const gc: GroupChat = await res.json()
      addGC(gc)
      selectGC(gc.id)
      setName('')
      setDescription('')
      onOpenChange(false)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [name, description, addGC, selectGC, onOpenChange])

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setName('')
        setDescription('')
        setError('')
      }
      onOpenChange(newOpen)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Group Chat</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Create a new group chat and invite your friends.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
            <p className="text-sm text-rose-400">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome group"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">
              Description{' '}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              className="min-h-[80px] resize-none"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {loading ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
