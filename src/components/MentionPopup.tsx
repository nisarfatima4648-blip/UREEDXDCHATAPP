'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/UserAvatar'
import type { User } from '@/lib/database'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface MentionUser {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  status?: string
}

interface MentionPopupProps {
  /** The query typed after @ (e.g. "al" from "@al") */
  query: string
  /** List of mentionable users */
  users: MentionUser[]
  /** Whether the popup is visible */
  open: boolean
  /** Called when a user is selected */
  onSelect: (user: MentionUser) => void
  /** Called to close the popup */
  onClose: () => void
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function filterUsers(users: MentionUser[], query: string): MentionUser[] {
  if (!query) return users.slice(0, 10)
  const q = query.toLowerCase()
  return users
    .filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q)
    )
    .slice(0, 10)
}

// ─── Component ────────────────────────────────────────────────────────────

export function MentionPopup({
  query,
  users,
  open,
  onSelect,
  onClose,
}: MentionPopupProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = filterUsers(users, query)
  const safeIndex = filtered.length > 0 ? selectedIndex % filtered.length : 0

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[safeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || filtered.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => (i + 1) % filtered.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          onSelect(filtered[safeIndex])
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          onClose()
          break
      }
    },
    [open, filtered, safeIndex, onSelect, onClose]
  )

  // Register keyboard listener on the document
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open || filtered.length === 0) return null

  return (
    <div
      className={cn(
        'absolute bottom-full left-4 right-4 mb-1 z-50',
        'rounded-lg border border-border/60 bg-card shadow-xl shadow-black/40',
        'max-h-48 overflow-y-auto',
        'scrollbar-thin scrollbar-thumb-muted-foreground/30'
      )}
      role="listbox"
      aria-label="Mention users"
    >
      {/* Header */}
      <div className="px-2.5 py-1.5 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Mention Users
        </span>
      </div>

      {/* User list */}
      <div ref={listRef}>
        {filtered.map((user, idx) => (
          <button
            key={user.id}
            type="button"
            role="option"
            aria-selected={idx === safeIndex}
            className={cn(
              'flex items-center gap-2.5 w-full px-2.5 py-1.5 text-left transition-colors',
              idx === safeIndex
                ? 'bg-sky-500/15 text-foreground'
                : 'text-foreground/80 hover:bg-accent/30'
            )}
            onMouseEnter={() => setSelectedIndex(idx)}
            onClick={() => onSelect(user)}
          >
            <UserAvatar
              user={{ avatar_url: user.avatar_url, username: user.username, status: user.status }}
              size="sm"
              showStatus={false}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user.display_name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                @{user.username}
              </div>
            </div>
            {idx === safeIndex && (
              <span className="text-[10px] text-muted-foreground shrink-0">Enter ↵</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Exported helpers ──────────────────────────────────────────────────────

/**
 * Extracts the @mention query from the input value at a given cursor position.
 * Returns the query string (without @) and the start index of the @, or null if no active @mention.
 */
export function getMentionQuery(
  value: string,
  cursorPosition: number
): { query: string; atIndex: number } | null {
  // Walk backwards from cursor to find the @ sign
  let atIndex = -1
  for (let i = cursorPosition - 1; i >= 0; i--) {
    if (/\s/.test(value[i]) && i !== cursorPosition - 1) break
    if (value[i] === '@') {
      atIndex = i
      break
    }
  }

  if (atIndex === -1) return null

  // The query is everything between @ and cursor
  const query = value.slice(atIndex + 1, cursorPosition)

  // Only show popup if @ is at start of input or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(value[atIndex - 1])) return null

  return { query, atIndex }
}

/**
 * Replaces the @mention query with the selected username at the given position.
 * Returns the new value and the cursor position after the replacement.
 */
export function insertMention(
  value: string,
  atIndex: number,
  cursorPosition: number,
  username: string
): { newValue: string; newCursorPos: number } {
  const before = value.slice(0, atIndex)
  const after = value.slice(cursorPosition)
  const mention = `@${username} `
  return {
    newValue: before + mention + after,
    newCursorPos: before.length + mention.length,
  }
}

/**
 * Renders text content with @username mentions highlighted in blue and custom emojis as images.
 */
export function renderContentWithMentions(
  text: string,
  customEmojis?: Record<string, string>
): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Pattern: **bold**, *italic*, `code`, @username, :emoji_name:
  const combinedRegex =
    /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|@(\w+)|:(\w+):)/g
  let lastIndex = 0
  let match
  let keyIdx = 0

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${keyIdx++}`}>{text.slice(lastIndex, match.index)}</span>
      )
    }

    if (match[2]) {
      // **bold**
      parts.push(
        <span key={`b-${keyIdx++}`} className="font-bold">
          {renderInlineMentions(match[2])}
        </span>
      )
    } else if (match[3]) {
      // *italic*
      parts.push(
        <span key={`i-${keyIdx++}`} className="italic">
          {renderInlineMentions(match[3])}
        </span>
      )
    } else if (match[4]) {
      // `code`
      parts.push(
        <code
          key={`c-${keyIdx++}`}
          className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-green-300"
        >
          {match[4]}
        </code>
      )
    } else if (match[5]) {
      // @mention
      parts.push(
        <span
          key={`m-${keyIdx++}`}
          className="rounded-sm bg-sky-500/15 px-0.5 text-sky-400 font-medium hover:bg-sky-500/25 cursor-pointer"
        >
          @{match[5]}
        </span>
      )
    } else if (match[6]) {
      // :emoji_name:
      const name = match[6]
      const imageUrl = customEmojis?.[name]
      if (imageUrl) {
        parts.push(
          <img
            key={`emoji-${keyIdx++}`}
            src={imageUrl}
            alt={name}
            className="inline size-15 align-text-bottom rounded"
            title={`:${name}:`}
          />
        )
      } else {
        parts.push(<span key={`et-${keyIdx++}`}>{match[0]}</span>)
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={`e-${keyIdx++}`}>{text.slice(lastIndex)}</span>
    )
  }

  return parts.length > 0 ? parts : [text]
}

/**
 * Handle mentions within bold/italic segments
 */
function renderInlineMentions(text: string): React.ReactNode[] {
  const mentionRegex = /@(\w+)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match
  let keyIdx = 0

  while ((match = mentionRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <span
        key={`im-${keyIdx++}`}
        className="rounded-sm bg-sky-500/15 px-0.5 text-sky-400 hover:bg-sky-500/25 cursor-pointer"
      >
        @{match[1]}
      </span>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}
