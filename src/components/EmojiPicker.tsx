'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { SmilePlus, Search, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CustomEmoji {
  id: string
  name: string
  image_url: string
  gc_id?: string
}

interface GroupChat {
  id: string
  name: string
  icon_url: string | null
}

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  /** All GC custom emojis keyed by gcId */
  allCustomEmojis?: Record<string, CustomEmoji[]>
  /** User's GCs (used to show GC categories) */
  userGCs?: GroupChat[]
  /** Current GC ID (if in a GC chat, its emojis are auto-selected) */
  selectedGCId?: string | null
}

// ─── Extended Standard Emoji List ────────────────────────────────────────────

const STANDARD_EMOJIS: { emoji: string; name: string }[] = [
  { emoji: '😀', name: 'grinning' }, { emoji: '😃', name: 'smiley' },
  { emoji: '😄', name: 'smile' }, { emoji: '😁', name: 'grin' },
  { emoji: '😂', name: 'joy' }, { emoji: '🤣', name: 'rofl' },
  { emoji: '😅', name: 'sweat_smile' }, { emoji: '🥲', name: 'smiling_face_with_tear' },
  { emoji: '😉', name: 'wink' }, { emoji: '😊', name: 'blush' },
  { emoji: '😇', name: 'innocent' }, { emoji: '🥰', name: 'smiling_face_with_hearts' },
  { emoji: '😍', name: 'heart_eyes' }, { emoji: '🤩', name: 'star_struck' },
  { emoji: '😘', name: 'kissing_heart' }, { emoji: '😗', name: 'kissing' },
  { emoji: '😚', name: 'relieved' }, { emoji: '😙', name: 'kissing_smiling_eyes' },
  { emoji: '🥲', name: 'upside_down' }, { emoji: '😋', name: 'yum' },
  { emoji: '😛', name: 'stuck_out_tongue' }, { emoji: '😜', name: 'stuck_out_tongue_wink' },
  { emoji: '🤪', name: 'zany' }, { emoji: '😝', name: 'squint' },
  { emoji: '🤑', name: 'money_mouth' }, { emoji: '🤗', name: 'hugs' },
  { emoji: '🤭', name: 'hand_over_mouth' }, { emoji: '🫢', name: 'shushing' },
  { emoji: '🤫', name: 'shushing_face' }, { emoji: '🤔', name: 'thinking' },
  { emoji: '🫡', name: 'salute' }, { emoji: '🤐', name: 'zipper_mouth' },
  { emoji: '🤨', name: 'raised_eyebrow' }, { emoji: '😐', name: 'neutral' },
  { emoji: '😑', name: 'expressionless' }, { emoji: '😶', name: 'no_mouth' },
  { emoji: '🫥', name: 'dotted_face' }, { emoji: '😏', name: 'smirk' },
  { emoji: '😒', name: 'unamused' }, { emoji: '🙄', name: 'roll_eyes' },
  { emoji: '😬', name: 'grimacing' }, { emoji: '😮‍💨', name: 'exhale' },
  { emoji: '🤥', name: 'lying' }, { emoji: '😌', name: 'relieved' },
  { emoji: '😔', name: 'pensive' }, { emoji: '😪', name: 'sleepy' },
  { emoji: '🤤', name: 'drool' }, { emoji: '😴', name: 'sleeping' },
  { emoji: '😷', name: 'mask' }, { emoji: '🤒', name: 'thermometer' },
  { emoji: '🤕', name: 'head_bandage' }, { emoji: '🤢', name: 'nausea' },
  { emoji: '🤮', name: 'vomit' }, { emoji: '🥵', name: 'hot' },
  { emoji: '🥶', name: 'cold' }, { emoji: '🥴', name: 'woozy' },
  { emoji: '😵', name: 'dizzy' }, { emoji: '🤯', name: 'exploding_head' },
  { emoji: '🤠', name: 'cowboy' }, { emoji: '🥳', name: 'party' },
  { emoji: '🥸', name: 'disguised' }, { emoji: '😎', name: 'sunglasses' },
  { emoji: '🤓', name: 'nerd' }, { emoji: '🧐', name: 'monocle' },
  { emoji: '😕', name: 'confused' }, { emoji: '🫤', name: 'diagonal_mouth' },
  { emoji: '😟', name: 'worried' }, { emoji: '🙁', name: 'frown' },
  { emoji: '😮', name: 'open_mouth' }, { emoji: '😯', name: 'hushed' },
  { emoji: '😲', name: 'astonished' }, { emoji: '😳', name: 'flushed' },
  { emoji: '🥺', name: 'pleading' }, { emoji: '🥹', name: 'holding_tears' },
  { emoji: '😦', name: 'frowning_open' }, { emoji: '😧', name: 'anguished' },
  { emoji: '😨', name: 'fearful' }, { emoji: '😰', name: 'anxious' },
  { emoji: '😥', name: 'sad_relieved' }, { emoji: '😢', name: 'cry' },
  { emoji: '😭', name: 'sob' }, { emoji: '😱', name: 'scream' },
  { emoji: '😖', name: 'confounded' }, { emoji: '😣', name: 'persevere' },
  { emoji: '😞', name: 'disappointed' }, { emoji: '😓', name: 'sweat' },
  { emoji: '😩', name: 'weary' }, { emoji: '😫', name: 'tired' },
  { emoji: '🥱', name: 'yawning' }, { emoji: '😤', name: 'triumph' },
  { emoji: '😡', name: 'rage' }, { emoji: '😠', name: 'angry' },
  { emoji: '🤬', name: 'cursing' }, { emoji: '😈', name: 'smiling_imp' },
  { emoji: '👿', name: 'imp' }, { emoji: '💀', name: 'skull' },
  { emoji: '☠️', name: 'skull_crossbones' }, { emoji: '💩', name: 'poop' },
  { emoji: '🤡', name: 'clown' }, { emoji: '👹', name: 'ogre' },
  { emoji: '👺', name: 'goblin' }, { emoji: '👻', name: 'ghost' },
  { emoji: '👽', name: 'alien' }, { emoji: '🤖', name: 'robot' },
  { emoji: '😺', name: 'smile_cat' }, { emoji: '😸', name: 'joy_cat' },
  { emoji: '😹', name: 'smile_cat' }, { emoji: '😻', name: 'heart_eyes_cat' },
  { emoji: '😼', name: 'smirk_cat' }, { emoji: '😽', name: 'kissing_cat' },
  { emoji: '🙀', name: 'scream_cat' }, { emoji: '😿', name: 'crying_cat' },
  { emoji: '😾', name: 'pouting_cat' },
  // Hands & gestures
  { emoji: '👋', name: 'wave' }, { emoji: '🤚', name: 'raised_hand' },
  { emoji: '🖐️', name: 'hand_splayed' }, { emoji: '✋', name: 'hand' },
  { emoji: '🖖', name: 'vulcan' }, { emoji: '👌', name: 'ok_hand' },
  { emoji: '🤌', name: 'pinched' }, { emoji: '🤏', name: 'pinching' },
  { emoji: '✌️', name: 'peace' }, { emoji: '🤞', name: 'crossed_fingers' },
  { emoji: '🤟', name: 'love_you' }, { emoji: '🤘', name: 'metal' },
  { emoji: '🤙', name: 'call_hand' }, { emoji: '👈', name: 'point_left' },
  { emoji: '👉', name: 'point_right' }, { emoji: '👆', name: 'point_up' },
  { emoji: '🖕', name: 'middle_finger' }, { emoji: '👇', name: 'point_down' },
  { emoji: '☝️', name: 'index_up' }, { emoji: '👍', name: 'thumbsup' },
  { emoji: '👎', name: 'thumbsdown' }, { emoji: '✊', name: 'fist' },
  { emoji: '👊', name: 'punch' }, { emoji: '🤛', name: 'left_fist' },
  { emoji: '🤜', name: 'right_fist' }, { emoji: '👏', name: 'clap' },
  { emoji: '🙌', name: 'raised_hands' }, { emoji: '🤝', name: 'handshake' },
  { emoji: '🙏', name: 'pray' }, { emoji: '💪', name: 'muscle' },
  { emoji: '🦾', name: 'mechanical_arm' }, { emoji: '🦿', name: 'mechanical_leg' },
  // Hearts
  { emoji: '❤️', name: 'heart' }, { emoji: '🧡', name: 'orange_heart' },
  { emoji: '💛', name: 'yellow_heart' }, { emoji: '💚', name: 'green_heart' },
  { emoji: '💙', name: 'blue_heart' }, { emoji: '💜', name: 'purple_heart' },
  { emoji: '🖤', name: 'black_heart' }, { emoji: '🤍', name: 'white_heart' },
  { emoji: '🤎', name: 'brown_heart' }, { emoji: '💔', name: 'broken_heart' },
  { emoji: '❤️‍🔥', name: 'heart_fire' }, { emoji: '❤️‍🩹', name: 'mending_heart' },
  { emoji: '💕', name: 'two_hearts' }, { emoji: '💞', name: 'revolving_hearts' },
  { emoji: '💓', name: 'heartbeat' }, { emoji: '💗', name: 'growing_heart' },
  { emoji: '💖', name: 'sparkling_heart' }, { emoji: '💘', name: 'cupid' },
  { emoji: '💝', name: 'gift_heart' }, { emoji: '💟', name: 'heart_decoration' },
  // Objects & symbols
  { emoji: '⭐', name: 'star' }, { emoji: '🌟', name: 'glowing_star' },
  { emoji: '✨', name: 'sparkles' }, { emoji: '💫', name: 'dizzy_star' },
  { emoji: '🔥', name: 'fire' }, { emoji: '💯', name: '100' },
  { emoji: '🎉', name: 'party' }, { emoji: '🎊', name: 'confetti' },
  { emoji: '🎵', name: 'music' }, { emoji: '🎶', name: 'notes' },
  { emoji: '🎸', name: 'guitar' }, { emoji: '🥁', name: 'drum' },
  { emoji: '👑', name: 'crown' }, { emoji: '💎', name: 'gem' },
  { emoji: '🏆', name: 'trophy' }, { emoji: '🎯', name: 'target' },
  { emoji: '🚀', name: 'rocket' }, { emoji: '💡', name: 'bulb' },
  { emoji: '👀', name: 'eyes' }, { emoji: '🧠', name: 'brain' },
  { emoji: '🗣️', name: 'speaking' }, { emoji: '💬', name: 'speech' },
  { emoji: '🗯️', name: 'anger' }, { emoji: '💭', name: 'thought' },
  { emoji: '💤', name: 'zzz' },
  // Animals
  { emoji: '🐱', name: 'cat' }, { emoji: '🐶', name: 'dog' },
  { emoji: '🐭', name: 'mouse' }, { emoji: '🐹', name: 'hamster' },
  { emoji: '🐰', name: 'rabbit' }, { emoji: '🦊', name: 'fox' },
  { emoji: '🐻', name: 'bear' }, { emoji: '🐼', name: 'panda' },
  { emoji: '🐨', name: 'koala' }, { emoji: '🐯', name: 'tiger' },
  { emoji: '🦁', name: 'lion' }, { emoji: '🐮', name: 'cow' },
  { emoji: '🐷', name: 'pig' }, { emoji: '🐸', name: 'frog' },
  { emoji: '🐵', name: 'monkey' }, { emoji: '🐔', name: 'chicken' },
  { emoji: '🐧', name: 'penguin' }, { emoji: '🐦', name: 'bird' },
  { emoji: '🦅', name: 'eagle' }, { emoji: '🦋', name: 'butterfly' },
  { emoji: '🐌', name: 'snail' }, { emoji: '🐛', name: 'bug' },
  { emoji: '🐝', name: 'bee' }, { emoji: '🐢', name: 'turtle' },
  { emoji: '🐍', name: 'snake' }, { emoji: '🦎', name: 'lizard' },
  { emoji: '🐙', name: 'octopus' }, { emoji: '🦑', name: 'squid' },
  { emoji: '🦀', name: 'crab' }, { emoji: '🦞', name: 'lobster' },
  { emoji: '🐬', name: 'dolphin' }, { emoji: '🐳', name: 'whale' },
  { emoji: '🦈', name: 'shark' }, { emoji: '🐊', name: 'crocodile' },
  // Food & drink
  { emoji: '🍎', name: 'apple' }, { emoji: '🍊', name: 'orange' },
  { emoji: '🍋', name: 'lemon' }, { emoji: '🍌', name: 'banana' },
  { emoji: '🍉', name: 'watermelon' }, { emoji: '🍇', name: 'grapes' },
  { emoji: '🍓', name: 'strawberry' }, { emoji: '🍑', name: 'peach' },
  { emoji: '🍒', name: 'cherries' }, { emoji: '🥝', name: 'kiwi' },
  { emoji: '🍕', name: 'pizza' }, { emoji: '🍔', name: 'hamburger' },
  { emoji: '🍟', name: 'fries' }, { emoji: '🌭', name: 'hotdog' },
  { emoji: '🍿', name: 'popcorn' }, { emoji: '🧁', name: 'cupcake' },
  { emoji: '🍰', name: 'cake' }, { emoji: '🍩', name: 'donut' },
  { emoji: '🍪', name: 'cookie' }, { emoji: '🍫', name: 'chocolate' },
  { emoji: '🍬', name: 'candy' }, { emoji: '☕', name: 'coffee' },
  { emoji: '🍵', name: 'tea' }, { emoji: '🧃', name: 'juice' },
  { emoji: '🍺', name: 'beer' }, { emoji: '🍻', name: 'beers' },
  { emoji: '🥂', name: 'champagne' }, { emoji: '🍷', name: 'wine' },
  // Places & travel
  { emoji: '🏠', name: 'house' }, { emoji: '🏢', name: 'office' },
  { emoji: '🏰', name: 'castle' }, { emoji: '⛪', name: 'church' },
  { emoji: '🕌', name: 'mosque' }, { emoji: '⛩️', name: 'temple' },
  { emoji: '🌎', name: 'earth_americas' },
  { emoji: '🌍', name: 'earth_africa' }, { emoji: '🌏', name: 'earth_asia' },
  { emoji: '🏔️', name: 'mountain' }, { emoji: '⛰️', name: 'mountain_snow' },
  { emoji: '🌋', name: 'volcano' }, { emoji: '🏖️', name: 'beach' },
  { emoji: '🏜️', name: 'desert' }, { emoji: '🌄', name: 'sunrise' },
  { emoji: '🌃', name: 'city_night' },
  // Misc
  { emoji: '🎨', name: 'art' }, { emoji: '🎮', name: 'game' },
  { emoji: '🎲', name: 'dice' }, { emoji: '🧩', name: 'puzzle' },
  { emoji: '🎭', name: 'theater' }, { emoji: '🎪', name: 'circus' },
  { emoji: '🎥', name: 'movie' }, { emoji: '📸', name: 'camera' },
  { emoji: '💻', name: 'computer' }, { emoji: '📱', name: 'phone' },
  { emoji: '⚡', name: 'zap' }, { emoji: '💨', name: 'dash' },
  { emoji: '🌈', name: 'rainbow' }, { emoji: '☀️', name: 'sun' },
  { emoji: '🌙', name: 'moon' }, { emoji: '⏰', name: 'alarm' },
  { emoji: '📅', name: 'calendar' }, { emoji: '📌', name: 'pushpin' },
  { emoji: '📎', name: 'paperclip' }, { emoji: '🔑', name: 'key' },
  { emoji: '🔒', name: 'lock' }, { emoji: '💰', name: 'money' },
  { emoji: '🎁', name: 'gift' }, { emoji: '📝', name: 'memo' },
  { emoji: '📊', name: 'chart' }, { emoji: '✅', name: 'check' },
  { emoji: '❌', name: 'x' }, { emoji: '❓', name: 'question' },
  { emoji: '❗', name: 'exclamation' }, { emoji: '⚠️', name: 'warning' },
  { emoji: '🚫', name: 'no_entry' }, { emoji: '♻️', name: 'recycle' },
]

// Clean up the list - remove any entries with space-prefixed names
const EMOJI_LIST = STANDARD_EMOJIS.filter(e => !e.emoji.includes(' ')).map(e => ({
  emoji: e.emoji.trim(),
  name: e.name.trim().startsWith(' ') ? e.name.trim().slice(1) : e.name.trim(),
})).filter(e => e.emoji.length > 0 && e.emoji.length < 10)

// Category tab type
type EmojiTab = 'gcs' | 'standard'

// ─── Component ──────────────────────────────────────────────────────────────

export function EmojiPicker({
  onSelect,
  allCustomEmojis = {},
  userGCs = [],
  selectedGCId,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<EmojiTab>('gcs')
  const [selectedGCEmojiId, setSelectedGCEmojiId] = useState<string | null>(
    selectedGCId || null
  )

  // Reset selected GC when in a new GC chat
  const effectiveSelectedGC = selectedGCId || selectedGCEmojiId

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji)
      setOpen(false)
    },
    [onSelect]
  )

  // Get GCs that have custom emojis
  const gcsWithEmojis = useMemo(() => {
    return userGCs.filter((gc) => {
      const emojis = allCustomEmojis[gc.id]
      return emojis && emojis.length > 0
    })
  }, [userGCs, allCustomEmojis])

  // Auto-select first GC if none selected but GCs with emojis exist
  const displayedGCId = effectiveSelectedGC || (gcsWithEmojis.length > 0 ? gcsWithEmojis[0].id : null)

  // Filtered standard emojis based on search
  const filteredStandardEmojis = useMemo(() => {
    if (!search.trim()) return EMOJI_LIST
    const q = search.toLowerCase().trim()
    return EMOJI_LIST.filter((e) => e.name.includes(q) || e.emoji.includes(q))
  }, [search])

  // Displayed GC emojis (filtered by search)
  const displayedGCEmojis = useMemo(() => {
    if (!displayedGCId) return []
    if (!search.trim()) return allCustomEmojis[displayedGCId] || []
    const q = search.toLowerCase().trim()
    return (allCustomEmojis[displayedGCId] || []).filter((e) => e.name.toLowerCase().includes(q))
  }, [displayedGCId, allCustomEmojis, search])

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); setSearch('') }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center justify-center size-9 rounded-md',
            'text-muted-foreground hover:text-foreground',
            'hover:bg-accent/50 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label="Pick emoji"
        >
          <SmilePlus className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        align="end"
        className="w-[420px] max-h-[420px] p-0 bg-popover border-border shadow-xl overflow-hidden"
      >
        {/* Search Bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search emojis..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        <div className="flex max-h-[370px]">
          {/* Left panel: GC categories */}
          <div className="w-[120px] shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
            {/* GC Emojis tab */}
            <button
              type="button"
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
                activeTab === 'gcs' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
              onClick={() => setActiveTab('gcs')}
            >
              <Hash className="size-3.5" />
              <span className="truncate">GC Emojis</span>
            </button>

            {/* GC list (only shown in gcs tab) */}
            {activeTab === 'gcs' && (
              <div className="py-1">
                {gcsWithEmojis.length === 0 ? (
                  <p className="px-3 py-2 text-[10px] text-muted-foreground">
                    No GC emojis yet
                  </p>
                ) : (
                  gcsWithEmojis.map((gc) => (
                    <button
                      key={gc.id}
                      type="button"
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
                        displayedGCId === gc.id
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                      onClick={() => {
                        setSelectedGCEmojiId(gc.id)
                        setSearch('')
                      }}
                    >
                      {gc.icon_url ? (
                        <img
                          src={gc.icon_url}
                          alt=""
                          className="size-5 rounded shrink-0 object-cover"
                        />
                      ) : (
                        <div className="size-5 rounded bg-primary/20 flex items-center justify-center shrink-0">
                          <Hash className="size-3 text-primary" />
                        </div>
                      )}
                      <span className="text-xs truncate">{gc.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            <Separator />

            {/* Standard Emojis tab */}
            <button
              type="button"
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
                activeTab === 'standard' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
              onClick={() => setActiveTab('standard')}
            >
              <span className="text-sm">😀</span>
              <span className="truncate">Standard</span>
            </button>
          </div>

          {/* Right panel: emoji grid */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'gcs' && (
              <div className="p-3">
                {displayedGCId && displayedGCEmojis.length > 0 ? (
                  <div className="grid grid-cols-5 gap-1">
                    {displayedGCEmojis.map((emoji) => (
                      <button
                        key={emoji.id}
                        type="button"
                        className={cn(
                          'flex flex-col items-center gap-1 px-1 py-1.5 rounded-md',
                          'hover:bg-accent transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                        onClick={() => handleSelect(`:${emoji.name}:`)}
                        title={`:${emoji.name}:`}
                      >
                        <img
                          src={emoji.image_url}
                          alt={emoji.name}
                          className="size-8 rounded object-contain"
                          loading="lazy"
                        />
                        <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                          {emoji.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : displayedGCId ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-xs text-muted-foreground">
                      {search ? 'No matching emojis' : 'No custom emojis in this GC'}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-xs text-muted-foreground">
                      Select a GC to see its emojis
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'standard' && (
              <div className="p-3">
                {filteredStandardEmojis.length > 0 ? (
                  <div className="grid grid-cols-8 gap-0.5">
                    {filteredStandardEmojis.map((item, i) => (
                      <button
                        key={`${item.emoji}-${i}`}
                        type="button"
                        className={cn(
                          'flex items-center justify-center size-9 rounded-md',
                          'text-xl hover:bg-accent transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                        onClick={() => handleSelect(item.emoji)}
                        title={item.name}
                      >
                        {item.emoji}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-xs text-muted-foreground">
                      No emojis found for &quot;{search}&quot;
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}