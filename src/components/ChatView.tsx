'use client'

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { EmojiPicker } from '@/components/EmojiPicker'
import { VoiceChannel } from '@/components/VoiceChannel'
import { UserProfileCard } from '@/components/UserProfileCard'
import {
  MentionPopup,
  getMentionQuery,
  insertMention,
  renderContentWithMentions,
  type MentionUser,
} from '@/components/MentionPopup'
import {
  Hash,
  Search,
  Plus,
  Reply,
  Trash2,
  X,
  Phone,
  PhoneOff,
  Users,
  ChevronRight,
  StickyNote,
  Pin,
  Shield,
  ShieldAlert,
  Crown,
  CircleSlash,
  MessageSquare,
  Settings,
  UserPlus,
  Pencil,
  Download,
  Check,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { sendMessage, sendTyping, callUser } from '@/lib/socket'
import { cn } from '@/lib/utils'
import type { Message, User } from '@/lib/database'

// ─── Constants ──────────────────────────────────────────────────────────────

const FIVE_MINUTES_MS = 5 * 60 * 1000
const TYPING_DEBOUNCE_MS = 3000
const MAX_INPUT_LINES = 4

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/[\s_]+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)

  if (date >= today) return 'Today'
  if (date >= yesterday) return 'Yesterday'
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** Parse basic markdown-like formatting + custom emojis to React nodes (used for system messages) */
function renderContent(text: string, customEmojis?: Record<string, string>): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Pattern: **bold**, *italic*, `code`, :emoji_name:
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|:(\w+):)/g
  let lastIndex = 0
  let match
  let keyIdx = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      // **bold**
      parts.push(
        <span key={`b-${keyIdx++}`} className="font-bold">
          {match[2]}
        </span>
      )
    } else if (match[3]) {
      // *italic*
      parts.push(
        <span key={`i-${keyIdx++}`} className="italic">
          {match[3]}
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
      // :emoji_name:
      const name = match[5]
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
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

/** Get role color class */
function getRoleColor(role?: string): string {
  switch (role) {
    case 'owner':
      return 'text-yellow-400'
    case 'admin':
      return 'text-rose-400'
    default:
      return 'text-foreground'
  }
}

function getRoleIcon(role?: string) {
  switch (role) {
    case 'owner':
      return <Crown className="size-3 text-yellow-400" />
    case 'admin':
      return <Shield className="size-3 text-rose-400" />
    default:
      return null
  }
}

// ─── Message Grouping ──────────────────────────────────────────────────────

interface MessageGroup {
  messages: Message[]
  senderId: string
  senderName: string
  senderAvatar: string | null
  senderRole?: string
  isFirstGroup: boolean
}

function groupMessages(messages: Message[], gcMembers?: Record<string, { role?: string }>): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentGroup: MessageGroup | null = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const prev = i > 0 ? messages[i - 1] : null
    const isFirst =
      !prev ||
      prev.sender_id !== msg.sender_id ||
      new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > FIVE_MINUTES_MS ||
      prev.type === 'system' ||
      msg.type === 'system'

    if (isFirst) {
      currentGroup = {
        messages: [msg],
        senderId: msg.sender_id,
        senderName: msg.sender?.display_name || msg.sender?.username || 'Unknown',
        senderAvatar: msg.sender?.avatar_url || null,
        senderRole: gcMembers?.[msg.sender_id]?.role,
        isFirstGroup: groups.length === 0,
      }
      groups.push(currentGroup)
    } else if (currentGroup) {
      currentGroup.messages.push(msg)
    }
  }

  return groups
}

// ─── Typing Indicator ────────────────────────────────────────────────────────

function TypingIndicator({ userIds }: { userIds: string[] }) {
  if (userIds.length === 0) return null

  const text =
    userIds.length === 1
      ? `${userIds[0]} is typing...`
      : userIds.length === 2
        ? `${userIds[0]} and ${userIds[1]} are typing...`
        : `${userIds[0]} and ${userIds.length - 1} others are typing...`

  return (
    <div className="flex items-center gap-2 px-4 py-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block size-1.5 rounded-full bg-muted-foreground animate-bounce"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: '800ms' }}
          />
        ))}
      </div>
      <span>{text}</span>
    </div>
  )
}

// ─── Reply Preview (inline) ─────────────────────────────────────────────────

function ReplyPreview({ message, onDismiss }: { message: Message; onDismiss?: () => void }) {
  const senderName = message.sender?.display_name || message.sender?.username || 'Unknown'
  const preview = message.content.slice(0, 80) + (message.content.length > 80 ? '...' : '')

  return (
    <div className="flex items-start gap-2 px-2 py-1 rounded-md bg-muted/50 border-l-2 border-muted-foreground/30">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <Reply className="size-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground truncate">
            Replying to <span className="text-foreground font-medium">{senderName}</span>
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{preview}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="size-4 flex items-center justify-center rounded hover:bg-muted transition-colors shrink-0"
          onClick={onDismiss}
          aria-label="Cancel reply"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({
  url,
  onClose,
}: {
  url: string
  onClose: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', handleKeyDown as unknown as EventListener)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        className="absolute top-4 right-4 size-10 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors z-10"
        onClick={onClose}
        aria-label="Close lightbox"
      >
        <X className="size-5" />
      </button>

      {/* Download button */}
      <a
        href={url}
        download
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-4 right-16 size-10 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors z-10"
        onClick={(e) => e.stopPropagation()}
        aria-label="Download image"
      >
        <Download className="size-5" />
      </a>

      {/* Image */}
      <img
        src={url}
        alt="Full size"
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

// ─── Message Item ───────────────────────────────────────────────────────────

function MessageItem({
  message,
  isGrouped,
  showHeader,
  senderName,
  senderAvatar,
  senderRole,
  replyMessage,
  currentUser,
  customEmojis,
  onReply,
  onDelete,
  onEdit,
  canModerate,
  onOpenLightbox,
}: {
  message: Message
  isGrouped: boolean
  showHeader: boolean
  senderName: string
  senderAvatar: string | null
  senderRole?: string
  replyMessage?: Message
  currentUser: { id: string } | null
  customEmojis?: Record<string, string>
  onReply: () => void
  onDelete: () => void
  canModerate: boolean
  onOpenLightbox: (url: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [isSaving, setIsSaving] = useState(false)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  const isOwnMessage = message.sender_id === currentUser?.id
  const isSystem = message.type === 'system'
  const canDelete = isOwnMessage || canModerate
  const canEdit = isOwnMessage || canModerate

  // Focus edit textarea when entering edit mode
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus()
      editTextareaRef.current.selectionStart = editTextareaRef.current.value.length
    }
  }, [isEditing])

  const handleSaveEdit = useCallback(async () => {
    const trimmed = editContent.trim()
    if (!trimmed || trimmed === message.content) {
      setIsEditing(false)
      setEditContent(message.content)
      return
    }
    // Don't try to save temp/optimistic messages (wait for real ID)
    if (message.id.startsWith('temp-')) {
      setIsEditing(false)
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch(`/api/messages/${message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      })
      if (res.ok) {
        // Immediately update the local store (don't wait for socket echo)
        const channelId = message.gc_id || message.dm_conversation_id
        if (channelId) {
          useAppStore.getState().updateMessageContent(
            message.id,
            channelId,
            trimmed,
            new Date().toISOString()
          )
        }
        setIsEditing(false)
      }
    } catch {
      // silently ignore
    } finally {
      setIsSaving(false)
    }
  }, [editContent, message.id, message.content, message.gc_id, message.dm_conversation_id])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditContent(message.content)
  }, [message.content])

  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSaveEdit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    },
    [handleSaveEdit, handleCancelEdit]
  )

  // System message: centered, italic, no avatar
  if (isSystem) {
    return (
      <div className="flex justify-center py-1 px-4">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/40">
          <CircleSlash className="size-3 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground italic">
            {renderContent(message.content, customEmojis)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group relative flex gap-3 px-4 hover:bg-accent/20 transition-colors',
        !isGrouped && 'pt-1',
        isGrouped && 'pl-[4.25rem]'
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar - only show for first message in group */}
      {!isGrouped && (
        <div className="shrink-0 pt-0.5">
          <UserProfileCard userId={message.sender_id}>
            <Avatar className="size-10 cursor-pointer">
              {senderAvatar ? <AvatarImage src={senderAvatar} alt={senderName} /> : null}
              <AvatarFallback className="text-sm bg-muted">
                {getInitials(senderName)}
              </AvatarFallback>
            </Avatar>
          </UserProfileCard>
        </div>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Header - only show for first message in group */}
        {showHeader && (
          <div className="flex items-baseline gap-1.5">
            <UserProfileCard userId={message.sender_id}>
              <span className={cn('text-sm font-semibold cursor-pointer hover:underline', getRoleColor(senderRole))}>
                {senderName}
              </span>
            </UserProfileCard>
            {senderRole && senderRole !== 'member' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center">
                    {getRoleIcon(senderRole)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs capitalize">
                  {senderRole}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[11px] text-muted-foreground">
                  {formatDate(message.created_at)} at {formatTime(message.created_at)}
                  {message.edited_at && (
                    <span className="ml-1 text-muted-foreground/60">(edited)</span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {new Date(message.created_at).toLocaleString()}
                {message.edited_at && `\nEdited: ${new Date(message.edited_at).toLocaleString()}`}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Reply preview */}
        {message.reply_to_id && replyMessage && (
          <div className="mt-0.5 mb-0.5">
            <ReplyPreview message={replyMessage} />
          </div>
        )}

        {/* Message content */}
        <div className="relative">
          {isEditing ? (
            /* Edit mode */
            <div className="space-y-2">
              <textarea
                ref={editTextareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
                className="w-full bg-muted/50 rounded-md px-3 py-1.5 text-sm text-foreground resize-none outline-none border border-ring/50 min-h-[32px] max-h-[120px]"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const ta = e.target as HTMLTextAreaElement
                  ta.style.height = 'auto'
                  ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
                }}
              />
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs gap-1"
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editContent.trim()}
                >
                  {isSaving ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Check className="size-3" />
                  )}
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            /* Normal display mode */
            <>
              <p className="text-sm text-foreground/90 leading-relaxed break-words whitespace-pre-wrap">
                {renderContentWithMentions(message.content, customEmojis)}
                {/* Edited indicator for grouped messages (no header) */}
                {isGrouped && message.edited_at && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground/60">(edited)</span>
                )}
              </p>

              {/* Attachment — detect type from file extension as fallback */}
              {message.attachment_url && (() => {
                const url = message.attachment_url.toLowerCase()
                const isImg = message.type === 'image' || url.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)
                const isVid = message.type === 'video' || url.match(/\.(mp4|webm|mov|avi|mkv|m4v)$/)

                if (isImg) {
                  return (
                    <div className="mt-1 relative group/attachment">
                      <div className="relative inline-block">
                        <img
                          src={message.attachment_url}
                          alt="Attachment"
                          className="max-w-[400px] max-h-[300px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          loading="lazy"
                          onClick={() => onOpenLightbox(message.attachment_url!)}
                        />
                        <a
                          href={message.attachment_url}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute top-2 right-2 z-10 size-8 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover/attachment:opacity-100 hover:bg-black/80 transition-all cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Download image"
                        >
                          <Download className="size-4" />
                        </a>
                      </div>
                    </div>
                  )
                }

                if (isVid) {
                  return (
                    <div className="mt-1 relative group/attachment">
                      <div className="relative inline-block">
                        <video
                          src={message.attachment_url}
                          controls
                          preload="metadata"
                          className="max-w-[400px] max-h-[300px] rounded-lg"
                        />
                        <a
                          href={message.attachment_url}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute top-2 right-2 z-10 size-8 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover/attachment:opacity-100 hover:bg-black/80 transition-all cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Download video"
                        >
                          <Download className="size-4" />
                        </a>
                      </div>
                    </div>
                  )
                }

                return (
                  <div className="mt-1 relative group/attachment">
                    <a
                      href={message.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <StickyNote className="size-4" />
                      <span className="truncate max-w-[200px]">
                        {message.attachment_url.split('/').pop() || 'File'}
                      </span>
                      <Download className="size-3.5 shrink-0" />
                    </a>
                  </div>
                )
              })()}
            </>
          )}

          {/* Hover actions (only show when not in edit mode) */}
          {!isEditing && hovered && (
            <div
              className={cn(
                'absolute z-10 flex items-center gap-0.5 bg-card border border-border rounded-md shadow-md',
                !isGrouped ? '-top-4 right-0' : '-top-4 right-0'
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    onClick={onReply}
                  >
                    <Reply className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Reply
                </TooltipContent>
              </Tooltip>
              {canEdit && message.type === 'text' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-foreground"
                      onClick={() => setIsEditing(true)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Edit
                  </TooltipContent>
                </Tooltip>
              )}
              {canDelete && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={onDelete}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Delete
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {/* Timestamp on hover for grouped messages */}
          {isGrouped && !isEditing && hovered && (
            <span className="absolute -left-14 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground whitespace-nowrap">
              {formatTime(message.created_at)}
              {message.edited_at && ' (edited)'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Welcome Screen ─────────────────────────────────────────────────────────

function WelcomeScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2">
        <div className="size-20 rounded-full bg-muted flex items-center justify-center">
          <MessageSquare className="size-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Welcome to Chat</h2>
        <p className="text-muted-foreground text-sm text-center max-w-md">
          Select a conversation from the sidebar to start chatting with your friends or join a group chat.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
        {[
          { icon: <Pin className="size-5" />, title: 'Pin important messages', desc: 'Keep key info visible' },
          { icon: <Reply className="size-5" />, title: 'Reply to messages', desc: 'Thread conversations' },
          { icon: <Phone className="size-5" />, title: 'Voice channels', desc: 'Talk with your friends' },
          { icon: <Search className="size-5" />, title: 'Search messages', desc: 'Find anything fast' },
        ].map((tip) => (
          <div
            key={tip.title}
            className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
          >
            <div className="text-muted-foreground shrink-0">{tip.icon}</div>
            <div>
              <h4 className="text-sm font-medium text-foreground">{tip.title}</h4>
              <p className="text-xs text-muted-foreground">{tip.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main ChatView Component ────────────────────────────────────────────────

interface ChatViewProps {
  onOpenGCSettings?: () => void
  onAddMember?: () => void
}

export function ChatView({ onOpenGCSettings, onAddMember }: ChatViewProps = {}) {
  const currentUser = useAppStore((s) => s.currentUser)
  const currentUserId = currentUser?.id // stable scalar for deps
  const selectedGCId = useAppStore((s) => s.selectedGCId)
  const selectedDMConversationId = useAppStore((s) => s.selectedDMConversationId)
  const activeVCGcId = useAppStore((s) => s.activeVCGcId)
  const userGCs = useAppStore((s) => s.userGCs)
  const gcMembers = useAppStore((s) => s.gcMembers)
  const gcMessages = useAppStore((s) => selectedGCId ? s.gcMessages[selectedGCId] : undefined)
  const dmConversations = useAppStore((s) => s.dmConversations)
  const dmMessages = useAppStore((s) => selectedDMConversationId ? s.dmMessages[selectedDMConversationId] : undefined)
  const typingUsers = useAppStore((s) => s.typingUsers)
  const replyTo = useAppStore((s) => s.replyTo)
  const setReplyTo = useAppStore((s) => s.setReplyTo)
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel)

  const setGCMessages = useAppStore((s) => s.setGCMessages)
  const setDMMessages = useAppStore((s) => s.setDMMessages)
  const prependMessages = useAppStore((s) => s.prependMessages)
  const setCustomEmojis = useAppStore((s) => s.setCustomEmojis)

  const [inputValue, setInputValue] = useState('')
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingInitial, setLoadingInitial] = useState(false)
  const customEmojis = useAppStore((s) => s.customEmojis)
  const currentCustomEmojis = selectedGCId ? (customEmojis[selectedGCId] || []) : []
  const allCustomEmojis = useAppStore((s) => s.customEmojis)
  const friends = useAppStore((s) => s.friends)

  // ─── File upload state ─────────────────────────────────────────────────────
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<{ url: string; type: 'image' | 'video'; fileName: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Lightbox state ────────────────────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // ─── Mention state ────────────────────────────────────────────────────────
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionAtIdx, setMentionAtIdx] = useState(-1)
  const [showMentionPopup, setShowMentionPopup] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isNearBottomRef = useRef(true)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputValueRef = useRef('')

  // ─── Derived values ───────────────────────────────────────────────────────

  const selectedGC = useMemo(
    () => userGCs.find((gc) => gc.id === selectedGCId) || null,
    [userGCs, selectedGCId]
  )

  const selectedDM = useMemo(
    () => dmConversations.find((c) => c.id === selectedDMConversationId) || null,
    [dmConversations, selectedDMConversationId]
  )

  const channelId = selectedGCId || selectedDMConversationId || ''
  const messages = selectedGCId
    ? gcMessages || []
    : selectedDMConversationId
      ? dmMessages || []
      : []

  const currentTypingUsers = (typingUsers[channelId] || []).filter(
    (id) => id !== currentUser?.id
  )

  // Check if current user is admin/owner of the selected GC
  const canModerate = useMemo(() => {
    if (!selectedGCId || !currentUser) return false
    const members = gcMembers[selectedGCId] || []
    const myMember = members.find((m) => m.user_id === currentUser.id)
    return myMember?.role === 'owner' || myMember?.role === 'admin'
  }, [selectedGCId, currentUser, gcMembers])

  // Build a lookup for messages (for reply preview)
  const messageMap = useMemo(() => {
    const map: Record<string, Message> = {}
    for (const m of messages) {
      map[m.id] = m
    }
    return map
  }, [messages])

  // Build a custom emoji name→URL map for rendering (includes all GC emojis user is in)
  const customEmojiMap = useMemo(() => {
    const map: Record<string, string> = {}
    // Include current GC emojis
    for (const e of currentCustomEmojis) {
      map[e.name] = e.image_url
    }
    // In DMs, include ALL GC emojis from all user's GCs
    if (!selectedGCId) {
      for (const gcId of Object.keys(allCustomEmojis)) {
        for (const e of allCustomEmojis[gcId]) {
          if (!map[e.name]) map[e.name] = e.image_url
        }
      }
    }
    return map
  }, [currentCustomEmojis, allCustomEmojis, selectedGCId])

  // Build GC member role lookup
  const memberRoleMap = useMemo(() => {
    const map: Record<string, { role?: string }> = {}
    if (selectedGCId) {
      const members = gcMembers[selectedGCId] || []
      for (const m of members) {
        map[m.user_id] = { role: m.role }
      }
    }
    return map
  }, [selectedGCId, gcMembers])

  // ─── Build mentionable users list ────────────────────────────────────────
  const mentionableUsers = useMemo<MentionUser[]>(() => {
    const seen = new Set<string>()
    const result: MentionUser[] = []

    const addUser = (u: User | undefined | null) => {
      if (!u || u.id === currentUser?.id || seen.has(u.id)) return
      seen.add(u.id)
      result.push({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
        status: u.status,
      })
    }

    if (selectedGCId) {
      // GC members first
      for (const m of gcMembers[selectedGCId] || []) {
        addUser(m.user)
      }
    } else if (selectedDMConversationId && selectedDM?.other_user) {
      // DM partner
      addUser(selectedDM.other_user)
    }

    // Friends list
    for (const f of friends) {
      addUser(f)
    }

    return result
  }, [selectedGCId, selectedDMConversationId, gcMembers, friends, selectedDM, currentUser])

  // ─── Group messages ───────────────────────────────────────────────────────

  const messageGroups = useMemo(
    () => groupMessages(messages, memberRoleMap),
    [messages, memberRoleMap]
  )

  // ─── Fetch initial messages (single request for messages + emojis + members) ─

  const lastFetchedChannel = useRef<string | null>(null)

  useEffect(() => {
    if (!channelId || !currentUserId) return
    // Skip if we already loaded this channel
    if (lastFetchedChannel.current === channelId) return
    lastFetchedChannel.current = channelId

    const fetchData = async () => {
      setLoadingInitial(true)
      try {
        const isGC = !!selectedGCId
        const param = isGC ? `gcId=${selectedGCId}` : `dmConversationId=${selectedDMConversationId}`
        const res = await fetch(`/api/channel?${param}&limit=50`)
        if (res.ok) {
          const data = await res.json()
          // DB returns DESC (newest first); reverse so oldest is at top
          const msgs = [...(data.messages || [])].reverse()
          if (isGC) {
            setGCMessages(selectedGCId!, msgs)
            if (Array.isArray(data.emojis)) setCustomEmojis(selectedGCId!, data.emojis)
            if (Array.isArray(data.members)) useAppStore.getState().setGCMembers(selectedGCId!, data.members)
          } else {
            setDMMessages(selectedDMConversationId!, msgs)
          }
          // Scroll to bottom after initial load
          requestAnimationFrame(() => {
            if (viewportRef.current) {
              viewportRef.current.scrollTop = viewportRef.current.scrollHeight
            }
          })
        }
      } catch {
        // silently ignore
      } finally {
        setLoadingInitial(false)
      }
    }

    fetchData()
  }, [channelId, currentUserId, selectedGCId, selectedDMConversationId, setGCMessages, setDMMessages, setCustomEmojis])

  // ─── Auto-scroll on new messages (page.tsx handles the socket listener) ──

  const prevMessageCountRef = useRef(0)

  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        if (viewportRef.current) {
          viewportRef.current.scrollTop = viewportRef.current.scrollHeight
        }
      })
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length])

  // ─── Load older messages on scroll to top ─────────────────────────────────

  const handleScroll = useCallback(() => {
    const vp = viewportRef.current
    if (!vp || !channelId || !currentUser) return

    // Track if user is near bottom
    const isNearBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 100
    isNearBottomRef.current = isNearBottom

    // Load older messages at top
    if (vp.scrollTop < 100 && !loadingOlder) {
      const currentMessages = selectedGCId
        ? useAppStore.getState().gcMessages[selectedGCId] || []
        : selectedDMConversationId
          ? useAppStore.getState().dmMessages[selectedDMConversationId] || []
          : []
      if (currentMessages.length === 0) return

      setLoadingOlder(true)
      const oldestMessage = currentMessages[0]
      const isGC = !!selectedGCId
      const param = isGC
        ? `gcId=${selectedGCId}&before=${oldestMessage.created_at}&limit=50`
        : `dmConversationId=${selectedDMConversationId}&before=${oldestMessage.created_at}&limit=50`

      fetch(`/api/messages?${param}`)
        .then((res) => res.json())
        .then((data: Message[]) => {
          if (data.length > 0) {
            // DB returns DESC; reverse so oldest of this batch is first
            prependMessages(channelId, [...data].reverse())
          }
        })
        .catch(() => {})
        .finally(() => setLoadingOlder(false))
    }
  }, [channelId, currentUser, selectedGCId, selectedDMConversationId, loadingOlder, prependMessages])

  // ─── Auto-resize textarea ────────────────────────────────────────────────

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setInputValue(newValue)
      inputValueRef.current = newValue

      // Auto-resize
      const ta = textareaRef.current
      if (ta) {
        ta.style.height = 'auto'
        const newHeight = Math.min(ta.scrollHeight, MAX_INPUT_LINES * 24)
        ta.style.height = `${newHeight}px`
      }

      // Detect @mention
      const cursorPos = ta?.selectionStart ?? newValue.length
      const mentionInfo = getMentionQuery(newValue, cursorPos)
      if (mentionInfo && mentionInfo.query.length >= 0) {
        setMentionQuery(mentionInfo.query)
        setMentionAtIdx(mentionInfo.atIndex)
        setShowMentionPopup(true)
      } else {
        setShowMentionPopup(false)
      }

      // Emit typing (debounced)
      if (currentUser && channelId) {
        if (!typingTimeoutRef.current) {
          sendTyping({
            gcId: selectedGCId || undefined,
            dmConversationId: selectedDMConversationId || undefined,
          })
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = setTimeout(() => {
          typingTimeoutRef.current = null
        }, TYPING_DEBOUNCE_MS)
      }
    },
    [currentUser, channelId, selectedGCId, selectedDMConversationId]
  )

  // ─── Send message ────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const content = inputValueRef.current.trim()
    if ((!content && !uploadPreview) || !currentUser || !channelId) return

    if (uploadPreview) {
      // Sending an attachment message
      const optimisticMsg: Message = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        gc_id: selectedGCId || null,
        dm_conversation_id: selectedDMConversationId || null,
        sender_id: currentUser.id,
        content: content || uploadPreview.fileName,
        type: uploadPreview.type,
        attachment_url: uploadPreview.url,
        reply_to_id: replyTo?.id || null,
        created_at: new Date().toISOString(),
        sender: {
          id: currentUser.id,
          username: currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
        },
      }
      useAppStore.getState().addMessage(optimisticMsg)

      sendMessage({
        gcId: selectedGCId || undefined,
        dmConversationId: selectedDMConversationId || undefined,
        content: content || uploadPreview.fileName,
        type: uploadPreview.type,
        attachmentUrl: uploadPreview.url,
        replyToId: replyTo?.id || undefined,
      })

      setUploadPreview(null)
    } else {
      // Sending a text message
      const optimisticMsg: Message = {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        gc_id: selectedGCId || null,
        dm_conversation_id: selectedDMConversationId || null,
        sender_id: currentUser.id,
        content,
        type: 'text',
        attachment_url: null,
        reply_to_id: replyTo?.id || null,
        created_at: new Date().toISOString(),
        sender: {
          id: currentUser.id,
          username: currentUser.username,
          display_name: currentUser.display_name,
          avatar_url: currentUser.avatar_url,
        },
      }
      useAppStore.getState().addMessage(optimisticMsg)

      sendMessage({
        gcId: selectedGCId || undefined,
        dmConversationId: selectedDMConversationId || undefined,
        content,
        replyToId: replyTo?.id || undefined,
      })
    }

    setInputValue('')
    inputValueRef.current = ''
    setReplyTo(null)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Auto-scroll
    isNearBottomRef.current = true
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight
      }
    })
  }, [currentUser, channelId, selectedGCId, selectedDMConversationId, replyTo, setReplyTo, uploadPreview])

  // ─── Mention handlers (declared before handleKeyDown which uses them) ────

  const handleMentionClose = useCallback(() => {
    setShowMentionPopup(false)
    setMentionQuery('')
    textareaRef.current?.focus()
  }, [])

  const handleMentionSelect = useCallback(
    (user: MentionUser) => {
      const ta = textareaRef.current
      const cursorPos = ta?.selectionStart ?? inputValue.length
      const result = insertMention(inputValue, mentionAtIdx, cursorPos, user.username)
      setInputValue(result.newValue)
      inputValueRef.current = result.newValue
      setShowMentionPopup(false)
      setMentionQuery('')

      // Restore focus and cursor
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus()
          ta.selectionStart = result.newCursorPos
          ta.selectionEnd = result.newCursorPos
          // Auto-resize
          ta.style.height = 'auto'
          const newHeight = Math.min(ta.scrollHeight, MAX_INPUT_LINES * 24)
          ta.style.height = `${newHeight}px`
        }
      })
    },
    [inputValue, mentionAtIdx]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Let the mention popup handle Enter if it's open
        if (showMentionPopup) return
        e.preventDefault()
        handleSend()
      }
      if (e.key === 'Escape' && showMentionPopup) {
        e.preventDefault()
        handleMentionClose()
      }
    },
    [handleSend, showMentionPopup, handleMentionClose]
  )

  // ─── Handle reply ────────────────────────────────────────────────────────

  const handleReply = useCallback(
    (message: Message) => {
      setReplyTo(message)
      textareaRef.current?.focus()
    },
    [setReplyTo]
  )

  // ─── Handle delete ───────────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (message: Message) => {
      if (message.id.startsWith('temp-')) {
        // Just remove from local store
        useAppStore.getState().removeMessage(message.id, channelId)
        return
      }
      try {
        const res = await fetch(`/api/messages/${message.id}`, { method: 'DELETE' })
        if (res.ok) {
          useAppStore.getState().removeMessage(message.id, channelId)
        }
      } catch {
        // silently ignore
      }
    },
    [channelId]
  )

  // ─── Handle edit ─────────────────────────────────────────────────────────

  // Edit is handled inside MessageItem via local state; onEdit just triggers entering edit mode

  // ─── Emoji insert ────────────────────────────────────────────────────────

  const handleEmojiSelect = useCallback((emoji: string) => {
    setInputValue((prev) => {
      const next = prev + emoji
      inputValueRef.current = next
      return next
    })
    textareaRef.current?.focus()
  }, [])

  // ─── File upload ──────────────────────────────────────────────────────────

  const handleAttachment = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      // Reset input so the same file can be re-selected
      e.target.value = ''

      // Validate file type
      const isImage = file.type.startsWith('image/')
      const isVideo = file.type.startsWith('video/')
      if (!isImage && !isVideo) return

      // Validate file size (50MB)
      if (file.size > 50 * 1024 * 1024) return

      setUploadingFile(true)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('type', 'attachment')

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const data = await res.json()
          // IMPORTANT: determine type from the file's MIME type, NOT from the API response.
          // The upload API returns type='attachment' (the FormData type parameter),
          // which would cause the message to render as a file download link.
          setUploadPreview({
            url: data.url,
            type: isImage ? 'image' : 'video',
            fileName: file.name,
          })
          textareaRef.current?.focus()
        }
      } catch {
        // silently ignore
      } finally {
        setUploadingFile(false)
      }
    },
    []
  )

  const handleCancelUpload = useCallback(() => {
    setUploadPreview(null)
  }, [])

  // ─── Lightbox handler ────────────────────────────────────────────────────

  const handleOpenLightbox = useCallback((url: string) => {
    setLightboxUrl(url)
  }, [])

  const handleCloseLightbox = useCallback(() => {
    setLightboxUrl(null)
  }, [])

  // ─── Placeholder text ────────────────────────────────────────────────────

  const inputPlaceholder = selectedGCId
    ? `Message #${selectedGC?.name || 'general'}`
    : selectedDMConversationId
      ? `Message @${selectedDM?.other_user?.display_name || selectedDM?.other_user?.username || 'user'}`
      : ''

  // ─── Nothing selected: welcome ───────────────────────────────────────────

  if (!selectedGCId && !selectedDMConversationId) {
    return <WelcomeScreen />
  }

  const otherUser = selectedDM?.other_user
  const isOnline = otherUser ? (useAppStore.getState().onlineUsers || []).includes(otherUser.id) : false

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ─── Lightbox ──────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} onClose={handleCloseLightbox} />
      )}

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between h-12 px-4 border-b border-border/50 shrink-0 shadow-sm">
        {selectedGCId ? (
          <div className="flex items-center gap-2 min-w-0">
            {selectedGC?.icon_url ? (
              <img
                src={selectedGC.icon_url}
                alt=""
                className="size-6 rounded-md object-cover"
              />
            ) : (
              <Hash className="size-5 text-muted-foreground shrink-0" />
            )}
            <h1 className="text-sm font-semibold truncate">{selectedGC?.name || 'General'}</h1>
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 shrink-0">
              {(gcMembers[selectedGCId] || []).length} members
            </Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative">
              <Avatar className="size-6">
                {otherUser?.avatar_url ? (
                  <AvatarImage src={otherUser.avatar_url} alt={otherUser.display_name || ''} />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {otherUser ? getInitials(otherUser.display_name || otherUser.username) : '?'}
                </AvatarFallback>
              </Avatar>
              {/* Online status dot */}
              <div
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background',
                  isOnline ? 'bg-green-500' : 'bg-muted-foreground'
                )}
              />
            </div>
            <h1 className="text-sm font-semibold truncate">
              {otherUser?.display_name || otherUser?.username || 'Unknown'}
            </h1>
            {otherUser && (
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                {isOnline ? 'Online' : 'Offline'}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          {selectedGCId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={() => onOpenGCSettings?.()}
                >
                  <Settings className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Group Settings
              </TooltipContent>
            </Tooltip>
          )}
          {selectedGCId && onAddMember && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-green-400"
                  onClick={onAddMember}
                  aria-label="Add member"
                >
                  <UserPlus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Add Member
              </TooltipContent>
            </Tooltip>
          )}
          {selectedDMConversationId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-green-400"
                  onClick={() => {
                    const store = useAppStore.getState()
                    if (store.activeCall || store.incomingCall) return
                    const dm = store.dmConversations.find((c) => c.id === selectedDMConversationId)
                    if (!dm?.other_user) return
                    store.setActiveCall({
                      dmConversationId: selectedDMConversationId,
                      callerId: dm.other_user.id,
                      callerName: dm.other_user.display_name || dm.other_user.username,
                      callerAvatar: dm.other_user.avatar_url,
                      status: 'ringing',
                      isCaller: true,
                    })
                    callUser(selectedDMConversationId)
                  }}
                  aria-label="Start voice call"
                >
                  <Phone className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Start Voice Call
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                onClick={() => toggleRightPanel()}
              >
                <Users className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Members
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ─── Voice Channel Banner ─────────────────────────────────────────── */}
      {/* Always show in GC view so users can see/join VC. When the user is in
          VC for a DIFFERENT GC, page.tsx shows a compact floating indicator. */}
      {selectedGCId && (
        <VoiceChannel gcId={selectedGCId} showFull />
      )}

      {/* ─── Message Area ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div
          ref={viewportRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleScroll}
        >
            {/* Loading older indicator */}
            {loadingOlder && (
              <div className="flex justify-center py-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  Loading older messages...
                </div>
              </div>
            )}

            {/* Initial loading */}
            {loadingInitial && messages.length === 0 && (
              <div className="flex items-center justify-center h-32">
                <div className="size-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              </div>
            )}

            {/* Messages */}
            {messageGroups.map((group, groupIdx) => {
              // Date separator before first message of group if date differs from previous
              const firstMsg = group.messages[0]
              const prevGroupLastMsg = groupIdx > 0 ? messageGroups[groupIdx - 1].messages.at(-1) : null
              const showDateSep =
                !prevGroupLastMsg || !isSameDay(prevGroupLastMsg.created_at, firstMsg.created_at)

              return (
                <div key={`g-${firstMsg.id}-${group.senderId}`}>
                  {/* Date separator */}
                  {showDateSep && (
                    <div className="flex items-center gap-3 px-4 py-2">
                      <Separator className="flex-1 bg-border/30" />
                      <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                        {formatDate(firstMsg.created_at)}
                      </span>
                      <Separator className="flex-1 bg-border/30" />
                    </div>
                  )}

                  {/* Message items */}
                  {group.messages.map((msg, msgIdx) => (
                    <MessageItem
                      key={msg.id}
                      message={msg}
                      isGrouped={msgIdx > 0}
                      showHeader={msgIdx === 0}
                      senderName={group.senderName}
                      senderAvatar={group.senderAvatar}
                      senderRole={group.senderRole}
                      replyMessage={msg.reply_to_id ? messageMap[msg.reply_to_id] : undefined}
                      currentUser={currentUser}
                      customEmojis={customEmojiMap}
                      onReply={() => handleReply(msg)}
                      onDelete={() => handleDelete(msg)}
                      canModerate={canModerate}
                      onOpenLightbox={handleOpenLightbox}
                    />
                  ))}
                </div>
              )
            })}

            {/* Empty state */}
            {!loadingInitial && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <MessageSquare className="size-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No messages yet. Start the conversation!</p>
              </div>
            )}

            {/* Bottom spacer for scroll */}
            <div className="h-4" />
          </div>

        {/* ─── Typing Indicator ──────────────────────────────────────────── */}
        <TypingIndicator userIds={currentTypingUsers} />
      </div>

      {/* ─── Input Area ──────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border/50 px-4 pt-0 pb-4 relative">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Mention Popup */}
        <MentionPopup
          query={mentionQuery}
          users={mentionableUsers}
          open={showMentionPopup}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />

        {/* Reply bar */}
        {replyTo && (
          <div className="mb-2">
            <ReplyPreview
              message={replyTo}
              onDismiss={() => setReplyTo(null)}
            />
          </div>
        )}

        {/* Upload preview */}
        {uploadPreview && (
          <div className="mb-2 flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/50">
            {uploadPreview.type === 'image' ? (
              <img
                src={uploadPreview.url}
                alt={uploadPreview.fileName}
                className="size-12 rounded object-cover shrink-0"
              />
            ) : (
              <div className="size-12 rounded bg-muted flex items-center justify-center shrink-0">
                <StickyNote className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{uploadPreview.fileName}</p>
              <p className="text-[10px] text-muted-foreground">Ready to send</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={handleCancelUpload}
              aria-label="Cancel upload"
            >
              <X className="size-3" />
            </Button>
          </div>
        )}

        {/* Upload progress indicator */}
        {uploadingFile && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
            <Loader2 className="size-4 text-muted-foreground animate-spin shrink-0" />
            <span className="text-xs text-muted-foreground">Uploading file...</span>
          </div>
        )}

        <div className="flex items-end gap-2 bg-muted/50 rounded-xl px-3 py-2 border border-border/50 focus-within:border-ring/50 transition-colors">
          {/* Left side buttons */}
          <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-8 text-muted-foreground hover:text-foreground',
                    uploadingFile && 'pointer-events-none opacity-50'
                  )}
                  onClick={handleAttachment}
                  disabled={uploadingFile}
                >
                  {uploadingFile ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Plus className="size-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Upload
              </TooltipContent>
            </Tooltip>

            <EmojiPicker onSelect={handleEmojiSelect} allCustomEmojis={allCustomEmojis} userGCs={userGCs} selectedGCId={selectedGCId} />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            rows={1}
            className={cn(
              'flex-1 bg-transparent resize-none outline-none',
              'text-sm text-foreground placeholder:text-muted-foreground',
              'min-h-[24px] max-h-[96px] leading-6',
              'scrollbar-thin'
            )}
          />

          {/* Right side buttons */}
          <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'size-8',
                    (inputValue.trim() || uploadPreview)
                      ? 'text-green-400 hover:text-green-300 hover:bg-green-500/10'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  disabled={!inputValue.trim() && !uploadPreview}
                  onClick={handleSend}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="size-5"
                  >
                    <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Send
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}