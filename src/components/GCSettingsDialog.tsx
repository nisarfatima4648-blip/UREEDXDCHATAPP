'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  SettingsIcon,
  UsersIcon,
  SmilePlusIcon,
  PlusIcon,
  CrownIcon,
  ShieldCheckIcon,
  TrashIcon,
  XIcon,
  SaveIcon,
  ImageIcon,
  Loader2Icon,
  UserPlusIcon,
  GavelIcon,
  LogOutIcon,
  SearchIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  addGCMember,
  removeGCMember,
  banGCMember,
  addEmoji,
  removeEmoji,
} from '@/lib/socket'
import type { GCMember, User, GroupChat, CustomEmoji } from '@/lib/database'

// ─── Props ────────────────────────────────────────────────────────────────────

interface GCSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gcId: string
}

// ─── Inner Content (key={gcId} forces remount on GC switch) ───────────────────

function GCSettingsContent({
  gc,
  gcId,
  onOpenChange,
}: {
  gc: GroupChat
  gcId: string
  onOpenChange: (open: boolean) => void
}) {
  const currentUser = useAppStore((s) => s.currentUser)
  const gcMembers = useAppStore((s) => s.gcMembers)
  const customEmojis = useAppStore((s) => s.customEmojis)
  const setGCMembers = useAppStore((s) => s.setGCMembers)
  const updateGC = useAppStore((s) => s.updateGC)
  const removeGC = useAppStore((s) => s.removeGC)

  const members = gcMembers[gcId] || []
  const emojis = customEmojis[gcId] || []

  const myMember = members.find((m) => m.user_id === currentUser?.id)
  const isOwner = myMember?.role === 'owner'
  const isAdmin = myMember?.role === 'admin'
  const canManage = isOwner || isAdmin

  // ─── Overview state (lazy init from gc) ────────────────────────────────
  const [gcName, setGcName] = useState(() => gc.name)
  const [gcDescription, setGcDescription] = useState(() => gc.description)
  const [gcIconPreview, setGcIconPreview] = useState<string | null>(() => gc.icon_url)
  const [gcIconFile, setGcIconFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // ─── Members state ──────────────────────────────────────────────────────
  const [memberSearch, setMemberSearch] = useState('')
  const [memberResults, setMemberResults] = useState<User[]>([])
  const [searchingMembers, setSearchingMembers] = useState(false)
  const [membersLoaded, setMembersLoaded] = useState(false)

  // ─── Emojis state ───────────────────────────────────────────────────────
  const [emojiName, setEmojiName] = useState('')
  const [emojiUrl, setEmojiUrl] = useState('')
  const [addingEmoji, setAddingEmoji] = useState(false)
  const [emojiFile, setEmojiFile] = useState<File | null>(null)
  const emojiPreview = emojiFile
    ? URL.createObjectURL(emojiFile)
    : emojiUrl.trim() || null

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  // ─── Fetch members on mount ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch(`/api/gcs/${gcId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setGCMembers(gcId, data)
        }
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to fetch members:', err)
      })
      .finally(() => {
        if (!cancelled) setMembersLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [gcId, setGCMembers])

  // ─── Overview handlers ──────────────────────────────────────────────────

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setGcIconFile(file)
    const reader = new FileReader()
    reader.onload = () => setGcIconPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSaveOverview = async () => {
    setSaving(true)
    try {
      let iconUrl = gc.icon_url || null
      if (gcIconFile) {
        const formData = new FormData()
        formData.append('file', gcIconFile)
        formData.append('type', 'gc-icon')
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
        if (uploadRes.ok) {
          const { url } = await uploadRes.json()
          iconUrl = url
        }
      }
      const res = await fetch(`/api/gcs/${gcId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: gcName, description: gcDescription, iconUrl }),
      })
      if (res.ok) {
        updateGC(gcId, { name: gcName, description: gcDescription, icon_url: iconUrl })
        setGcIconFile(null)
      }
    } catch (err) {
      console.error('Failed to save GC settings:', err)
    }
    setSaving(false)
  }

  const handleDeleteGC = async () => {
    try {
      await fetch(`/api/gcs/${gcId}`, { method: 'DELETE' })
      removeGC(gcId)
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to delete GC:', err)
    }
  }

  // ─── Member handlers ────────────────────────────────────────────────────

  const searchMembers = useCallback(
    (query: string) => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

      if (!query.trim() || !currentUser) {
        setMemberResults([])
        return
      }

      setSearchingMembers(true)
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const params = new URLSearchParams({ q: query, excludeUserId: currentUser.id })
          const res = await fetch(`/api/users?${params}`)
          if (res.ok) {
            const data = await res.json()
            const existingIds = new Set(members.map((m) => m.user_id))
            setMemberResults(
              (Array.isArray(data) ? data : []).filter((u: User) => !existingIds.has(u.id))
            )
          }
        } catch (err) {
          console.error('Failed to search users:', err)
        }
        setSearchingMembers(false)
      }, 300)
    },
    [currentUser, members]
  )

  const handleMemberSearchChange = (value: string) => {
    setMemberSearch(value)
    searchMembers(value)
  }

  const handleAddMember = (userId: string) => {
    addGCMember(gcId, userId)
    setMemberResults((prev) => prev.filter((u) => u.id !== userId))
    setMemberSearch('')
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await fetch(`/api/gcs/${gcId}/members/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      })
      const res = await fetch(`/api/gcs/${gcId}/members`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setGCMembers(gcId, data)
      }
    } catch (err) {
      console.error('Failed to change role:', err)
    }
  }

  const handlePermissionChange = async (
    userId: string,
    field: 'can_kick' | 'can_ban' | 'can_add_members' | 'can_manage_emojis',
    value: boolean
  ) => {
    try {
      await fetch(`/api/gcs/${gcId}/members/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
    } catch (err) {
      console.error('Failed to change permission:', err)
    }
  }

  const handleKickMember = (userId: string) => {
    removeGCMember(gcId, userId)
  }

  const handleBanMember = (userId: string) => {
    banGCMember(gcId, userId)
  }

  // ─── Emoji handlers ────────────────────────────────────────────────────

  const handleAddEmoji = () => {
    const name = emojiName.trim()
    if (!name) return

    if (emojiFile) {
      // Upload from file: convert to base64 data URL
      setAddingEmoji(true)
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        addEmoji(gcId, name, dataUrl)
        setEmojiName('')
        setEmojiUrl('')
        setEmojiFile(null)
        setTimeout(() => setAddingEmoji(false), 500)
      }
      reader.readAsDataURL(emojiFile)
      return
    }

    const url = emojiUrl.trim()
    if (!url) return
    setAddingEmoji(true)
    addEmoji(gcId, name, url)
    setEmojiName('')
    setEmojiUrl('')
    setTimeout(() => setAddingEmoji(false), 500)
  }

  const handleDeleteEmoji = (emojiId: string) => {
    removeEmoji(gcId, emojiId)
  }

  // ─── Derived permissions ───────────────────────────────────────────────
  const canAddMembers = isOwner || myMember?.can_add_members
  const canManageEmojis = isOwner || myMember?.can_manage_emojis

  return (
    <>
      {/* Visible title bar */}
      <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-[#202225]">
        {gc.icon_url ? (
          <img src={gc.icon_url} alt="" className="size-10 rounded-full object-cover" />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-full bg-zinc-700 text-lg font-bold text-zinc-300">
            {gc.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-100 truncate">{gc.name}</h2>
          <p className="text-xs text-zinc-400">
            {members.length} member{members.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex flex-col flex-1 overflow-hidden">
        {/* Tab bar */}
        <div className="px-6 border-b border-[#202225] shrink-0">
          <TabsList className="w-full bg-transparent p-0 h-10">
            <TabsTrigger
              value="overview"
              className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-sm text-zinc-400 data-[state=active]:border-white data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <SettingsIcon className="size-4" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger
              value="members"
              className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-sm text-zinc-400 data-[state=active]:border-white data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <UsersIcon className="size-4" />
              <span className="hidden sm:inline">Members</span>
            </TabsTrigger>
            <TabsTrigger
              value="emojis"
              className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-sm text-zinc-400 data-[state=active]:border-white data-[state=active]:text-white data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <SmilePlusIcon className="size-4" />
              <span className="hidden sm:inline">Emojis</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Scrollable tab content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* OVERVIEW TAB                                                  */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="overview" className="mt-0">
            <div className="px-6 py-5 space-y-6 max-w-lg">
              {/* Icon Upload */}
              <div className="flex items-center gap-4">
                <div className="relative group cursor-pointer">
                  {gcIconPreview ? (
                    <img src={gcIconPreview} alt="GC icon" className="size-20 rounded-full object-cover" />
                  ) : (
                    <div className="flex size-20 items-center justify-center rounded-full bg-zinc-700 text-2xl font-bold text-zinc-300">
                      {gcName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                  )}
                  {canManage && (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        <ImageIcon className="size-6 text-white" />
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        onChange={handleIconChange}
                      />
                    </>
                  )}
                </div>
                <div>
                  <Label className="text-sm font-medium text-zinc-200">Group Icon</Label>
                  <p className="text-xs text-zinc-500">
                    {canManage ? 'Click to upload a new icon' : 'Only admins can change the icon'}
                  </p>
                </div>
              </div>

              <div className="h-px bg-[#202225]" />

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="gc-name" className="text-sm font-medium text-zinc-200">
                  Group Name
                </Label>
                <Input
                  id="gc-name"
                  value={gcName}
                  onChange={(e) => setGcName(e.target.value)}
                  disabled={!canManage}
                  className="border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500"
                  placeholder="Enter group name"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="gc-desc" className="text-sm font-medium text-zinc-200">
                  Description
                </Label>
                <Textarea
                  id="gc-desc"
                  value={gcDescription}
                  onChange={(e) => setGcDescription(e.target.value)}
                  disabled={!canManage}
                  className="border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500 min-h-[80px] resize-none"
                  placeholder="What's this group about?"
                />
              </div>

              {/* Stats */}
              <div className="h-px bg-[#202225]" />
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-[#2f3136] p-4 text-center">
                  <p className="text-2xl font-bold text-zinc-100">{members.length}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">Members</p>
                </div>
                <div className="rounded-lg bg-[#2f3136] p-4 text-center">
                  <p className="text-2xl font-bold text-zinc-100">{emojis.length}</p>
                  <p className="text-xs text-zinc-400 mt-0.5">Custom Emojis</p>
                </div>
              </div>

              {/* Save button */}
              {canManage && (
                <>
                  <div className="h-px bg-[#202225]" />
                  <div className="flex justify-end">
                    <Button
                      onClick={handleSaveOverview}
                      disabled={saving}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white"
                    >
                      {saving ? (
                        <Loader2Icon className="size-4 animate-spin mr-1.5" />
                      ) : (
                        <SaveIcon className="size-4 mr-1.5" />
                      )}
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </>
              )}

              {/* Delete GC — owners only */}
              {isOwner && (
                <>
                  <div className="h-px bg-[#202225]" />
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
                      <GavelIcon className="size-4" />
                      Danger Zone
                    </h3>
                    <p className="text-xs text-zinc-400">
                      Once you delete a group, there is no going back. All messages, members, and emojis
                      will be permanently removed.
                    </p>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="gap-2">
                          <TrashIcon className="size-4" />
                          Delete Group Chat
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#36393f] border-[#202225]">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-red-400">
                            Are you absolutely sure?
                          </AlertDialogTitle>
                          <AlertDialogDescription className="text-zinc-400">
                            This will permanently delete &quot;{gc.name}&quot; and remove all members,
                            messages, and emojis. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-[#202225] text-zinc-300 hover:bg-white/5">
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDeleteGC}
                            className="bg-red-600 hover:bg-red-500 text-white"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* MEMBERS TAB                                                   */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="members" className="mt-0">
            <div className="flex flex-col">
              {/* Add Member Search */}
              {canAddMembers && (
                <div className="px-6 pt-4 pb-3 border-b border-[#202225]">
                  <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
                    <Input
                      value={memberSearch}
                      onChange={(e) => handleMemberSearchChange(e.target.value)}
                      placeholder="Search users to add..."
                      className="pl-9 border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500"
                    />
                  </div>
                  {/* Search results dropdown */}
                  {memberSearch.trim() && (
                    <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[#202225] bg-[#2f3136]">
                      {searchingMembers ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-sm text-zinc-400">
                          <Loader2Icon className="size-4 animate-spin" />
                          Searching...
                        </div>
                      ) : memberResults.length === 0 ? (
                        <div className="py-3 text-center text-sm text-zinc-500">No users found</div>
                      ) : (
                        memberResults.map((user) => (
                          <div
                            key={user.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar className="size-7">
                                {user.avatar_url && <AvatarImage src={user.avatar_url} />}
                                <AvatarFallback className="bg-zinc-600 text-xs text-zinc-200">
                                  {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm text-zinc-200">{user.display_name}</p>
                                <p className="truncate text-xs text-zinc-500">@{user.username}</p>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="shrink-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 h-7 px-2"
                              onClick={() => handleAddMember(user.id)}
                            >
                              <UserPlusIcon className="size-4" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Members List */}
              <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
                {!membersLoaded ? (
                  <div className="flex items-center justify-center py-12 text-zinc-400">
                    <Loader2Icon className="size-5 animate-spin mr-2" />
                    Loading members...
                  </div>
                ) : members.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                    <UsersIcon className="size-10 mb-2 opacity-50" />
                    <p className="text-sm">No members yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#202225]">
                    {members.map((member) => {
                      const isSelf = member.user_id === currentUser?.id
                      const isMemberOwner = member.role === 'owner'

                      // Admin has full permissions (can do everything the owner can, except transfer ownership)
                      const canKickThis =
                        (isOwner || isAdmin || myMember?.can_kick) && !isMemberOwner && !isSelf
                      const canBanThis =
                        (isOwner || isAdmin || myMember?.can_ban) && !isMemberOwner && !isSelf
                      const canChangeRole = (isOwner || isAdmin) && !isMemberOwner && !isSelf
                      const canEditPerms = (isOwner || isAdmin) && !isSelf && !isMemberOwner

                      return (
                        <div key={member.id} className="px-6 py-3">
                          {/* Main row */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar className="size-9 shrink-0">
                                {member.user?.avatar_url && <AvatarImage src={member.user.avatar_url} />}
                                <AvatarFallback className="bg-zinc-600 text-sm text-zinc-200">
                                  {member.user?.display_name?.charAt(0)?.toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-zinc-100">
                                  {member.user?.display_name || 'Unknown'}
                                  {isSelf && <span className="ml-1.5 text-xs text-zinc-500">(you)</span>}
                                </p>
                                <p className="truncate text-xs text-zinc-400">
                                  @{member.user?.username || 'unknown'}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Role badge or selector */}
                              {canChangeRole ? (
                                <Select
                                  value={member.role}
                                  onValueChange={(val) => handleRoleChange(member.user_id, val)}
                                >
                                  <SelectTrigger className="w-[90px] h-7 text-xs border-[#202225] bg-[#202225] text-zinc-200">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-[#2f3136] border-[#202225]">
                                    <SelectItem
                                      value="admin"
                                      className="text-zinc-200 focus:bg-white/5 focus:text-white"
                                    >
                                      Admin
                                    </SelectItem>
                                    <SelectItem
                                      value="member"
                                      className="text-zinc-200 focus:bg-white/5 focus:text-white"
                                    >
                                      Member
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-xs font-normal',
                                    isMemberOwner
                                      ? 'border-amber-400/30 text-amber-400 bg-amber-400/5'
                                      : member.role === 'admin'
                                        ? 'border-emerald-400/30 text-emerald-400 bg-emerald-400/5'
                                        : 'border-zinc-600 text-zinc-400 bg-zinc-600/10'
                                  )}
                                >
                                  {isMemberOwner && <CrownIcon className="mr-1 size-3" />}
                                  {!isMemberOwner && member.role === 'admin' && (
                                    <ShieldCheckIcon className="mr-1 size-3" />
                                  )}
                                  {member.role}
                                </Badge>
                              )}

                              {/* Action buttons */}
                              {canKickThis && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-amber-400 hover:text-amber-300 hover:bg-amber-400/10"
                                  onClick={() => handleKickMember(member.user_id)}
                                  title="Kick member"
                                >
                                  <LogOutIcon className="size-3.5" />
                                  <span className="text-xs ml-1 hidden sm:inline">Kick</span>
                                </Button>
                              )}
                              {canBanThis && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                  onClick={() => handleBanMember(member.user_id)}
                                  title="Ban member"
                                >
                                  <GavelIcon className="size-3.5" />
                                  <span className="text-xs ml-1 hidden sm:inline">Ban</span>
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Permission checkboxes (owner only) */}
                          {canEditPerms && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 pl-12">
                              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                                <Checkbox
                                  checked={member.can_kick}
                                  onCheckedChange={(checked) =>
                                    handlePermissionChange(member.user_id, 'can_kick', !!checked)
                                  }
                                  className="border-zinc-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                Can Kick
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                                <Checkbox
                                  checked={member.can_ban}
                                  onCheckedChange={(checked) =>
                                    handlePermissionChange(member.user_id, 'can_ban', !!checked)
                                  }
                                  className="border-zinc-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                Can Ban
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                                <Checkbox
                                  checked={member.can_add_members}
                                  onCheckedChange={(checked) =>
                                    handlePermissionChange(member.user_id, 'can_add_members', !!checked)
                                  }
                                  className="border-zinc-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                Can Add
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                                <Checkbox
                                  checked={member.can_manage_emojis}
                                  onCheckedChange={(checked) =>
                                    handlePermissionChange(member.user_id, 'can_manage_emojis', !!checked)
                                  }
                                  className="border-zinc-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                Emojis
                              </label>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* EMOJIS TAB                                                    */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <TabsContent value="emojis" className="mt-0">
            <div className="flex flex-col">
              {/* Add Emoji Form */}
              {canManageEmojis && (
                <div className="px-6 pt-4 pb-3 border-b border-[#202225]">
                  <p className="text-sm font-medium text-zinc-200 mb-2.5">Add New Emoji</p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-zinc-400">Name</Label>
                      <Input
                        value={emojiName}
                        onChange={(e) => setEmojiName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleAddEmoji()
                        }}
                        placeholder="emoji_name"
                        className="h-9 border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 text-sm focus-visible:ring-zinc-500"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-zinc-400">Image URL or Upload</Label>
                      <div className="flex gap-2">
                        <Input
                          value={emojiFile ? emojiFile.name : emojiUrl}
                          onChange={(e) => {
                            setEmojiFile(null)
                            setEmojiUrl(e.target.value)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddEmoji()
                          }}
                          placeholder={emojiFile ? emojiFile.name : 'https://example.com/emoji.png'}
                          className="h-9 border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 text-sm focus-visible:ring-zinc-500"
                        />
                        <label className="flex items-center justify-center size-9 rounded-md bg-[#202225] border border-[#202225] hover:bg-[#36393f] cursor-pointer shrink-0 transition-colors">
                          <ImageIcon className="size-4 text-zinc-400" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) {
                                setEmojiFile(file)
                                setEmojiUrl('')
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    {emojiPreview && (
                      <div className="flex items-end">
                        <div className="flex size-9 items-center justify-center rounded-md bg-[#2f3136] border border-[#202225]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={emojiPreview}
                            alt="preview"
                            className="size-7 rounded object-contain"
                            onError={(e) => {
                              ;(e.target as HTMLImageElement).style.display = 'none'
                            }}
                          />
                        </div>
                      </div>
                    )}
                    <Button
                      size="sm"
                      onClick={handleAddEmoji}
                      disabled={!emojiName.trim() || (!emojiUrl.trim() && !emojiFile) || addingEmoji}
                      className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
                    >
                      {addingEmoji ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <PlusIcon className="size-4" />
                      )}
                      <span className="ml-1.5">Add</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Emoji List */}
              <div className="max-h-[50vh] overflow-y-auto overscroll-contain px-6 py-4">
                {emojis.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                    <SmilePlusIcon className="size-10 mb-2 opacity-50" />
                    <p className="text-sm">No custom emojis yet</p>
                    {canManageEmojis && (
                      <p className="text-xs text-zinc-600 mt-1">Add one using the form above</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                    {emojis.map((emoji) => (
                      <div
                        key={emoji.id}
                        className="group relative flex flex-col items-center gap-1.5 rounded-lg bg-[#2f3136] p-3 hover:bg-[#34373d] transition-colors"
                      >
                        {canManageEmojis && (
                          <button
                            onClick={() => handleDeleteEmoji(emoji.id)}
                            className="absolute -right-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-400 shadow-lg"
                            title="Remove emoji"
                          >
                            <XIcon className="size-3" />
                          </button>
                        )}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={emoji.image_url}
                          alt={emoji.name}
                          className="size-14 rounded object-contain"
                          onError={(e) => {
                            const el = e.target as HTMLImageElement
                            el.style.display = 'none'
                            el.parentElement?.classList.add(
                              'border',
                              'border-dashed',
                              'border-zinc-600'
                            )
                          }}
                        />
                        <span className="text-center text-[11px] text-zinc-400 truncate max-w-full font-mono">
                          :{emoji.name}:
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GCSettingsDialog({ open, onOpenChange, gcId }: GCSettingsDialogProps) {
  const userGCs = useAppStore((s) => s.userGCs)
  const gc = userGCs.find((g) => g.id === gcId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] bg-[#36393f] border-[#202225] text-zinc-100 p-0 gap-0 overflow-hidden flex flex-col">
        {/* Accessible header (sr-only for visual design) */}
        <DialogHeader className="sr-only">
          <DialogTitle>Group Chat Settings</DialogTitle>
          <DialogDescription>Manage {gc?.name || 'this group'}</DialogDescription>
        </DialogHeader>

        {gc ? (
          <GCSettingsContent key={gcId} gc={gc} gcId={gcId} onOpenChange={onOpenChange} />
        ) : (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            Group not found
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}