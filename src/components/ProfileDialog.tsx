'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  CameraIcon,
  SaveIcon,
  MessageSquareIcon,
  UserPlusIcon,
  UserMinusIcon,
  BanIcon,
  ImageIcon,
  UserIcon,
  Palette,
  Volume2,
  AlertTriangle,
  LogOut,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { changePresence, disconnectSocket } from '@/lib/socket'
import type { User } from '@/lib/database'
import ThemeEditor from './ThemeEditor'
import AudioSettings from './AudioSettings'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** If provided, shows another user's profile (read-only). If null/undefined, shows current user. */
  userId?: string | null
}

// ─── Status options ───────────────────────────────────────────────────────────

const statusOptions = [
  { value: 'online' as const, label: 'Online', color: 'bg-emerald-500' },
  { value: 'idle' as const, label: 'Idle', color: 'bg-amber-500' },
  { value: 'dnd' as const, label: 'Do Not Disturb', color: 'bg-red-500' },
  { value: 'invisible' as const, label: 'Invisible', color: 'bg-zinc-500' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProfileDialog({ open, onOpenChange, userId }: ProfileDialogProps) {
  const currentUser = useAppStore((s) => s.currentUser)
  const friends = useAppStore((s) => s.friends)

  const [profileUser, setProfileUser] = useState<User | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [loading, setLoading] = useState(false)

  const isOwnProfile = !userId || userId === currentUser?.id
  const targetUser = isOwnProfile ? currentUser : profileUser

  // ─── Editable fields (own profile only) ─────────────────────────────────
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [customStatus, setCustomStatus] = useState('')
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ─── Fetch other user's profile ────────────────────────────────────────

  const fetchProfile = useCallback(async () => {
    if (isOwnProfile) {
      if (currentUser) {
        setProfileUser(null)
        setDisplayName(currentUser.display_name)
        setBio(currentUser.bio)
        setCustomStatus(currentUser.custom_status || '')
        setBannerPreview(currentUser.banner_url)
        setAvatarPreview(currentUser.avatar_url)
      }
      return
    }
    if (!userId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/users/${userId}`)
      if (res.ok) {
        const user = (await res.json()) as User
        setProfileUser(user)
      }
    } catch {}
    // Check if blocked
    try {
      const blockRes = await fetch('/api/blocks')
      if (blockRes.ok) {
        const blocks = await blockRes.json()
        setBlocked(blocks.some((b: { blocked_id: string }) => b.blocked_id === userId))
      }
    } catch {}
    setLoading(false)
  }, [isOwnProfile, userId, currentUser])

  useEffect(() => {
    if (open) fetchProfile()
  }, [open, fetchProfile])

  // Sync own profile fields when currentUser changes — but skip avatar/banner
  // to prevent black flash when the store updates with server URLs
  useEffect(() => {
    if (isOwnProfile && currentUser && !avatarFile && !bannerFile) {
      setDisplayName(currentUser.display_name)
      setBio(currentUser.bio)
      setCustomStatus(currentUser.custom_status || '')
      setBannerPreview(currentUser.banner_url)
      setAvatarPreview(currentUser.avatar_url)
    }
  }, [isOwnProfile, currentUser, avatarFile, bannerFile])

  // ─── Handlers ──────────────────────────────────────────────────────────

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBannerFile(file)
    const reader = new FileReader()
    reader.onload = () => setBannerPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = () => setAvatarPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!currentUser) return
    setSaving(true)
    try {
      let avatarUrl = currentUser.avatar_url
      let bannerUrl = currentUser.banner_url

      if (avatarFile) {
        const fd = new FormData()
        fd.append('file', avatarFile)
        fd.append('type', 'avatar')
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        if (res.ok) {
          const { url } = await res.json()
          avatarUrl = url
          setAvatarFile(null)
        } else {
          const errData = await res.json().catch(() => ({}))
          console.error('Avatar upload failed:', errData)
        }
      }

      if (bannerFile) {
        const fd = new FormData()
        fd.append('file', bannerFile)
        fd.append('type', 'banner')
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        if (res.ok) {
          const { url } = await res.json()
          bannerUrl = url
          setBannerFile(null)
        } else {
          const errData = await res.json().catch(() => ({}))
          console.error('Banner upload failed:', errData)
        }
      }

      await fetch(`/api/users/${currentUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          bio,
          customStatus,
          avatarUrl,
          bannerUrl,
        }),
      })

      // Update store
      const updatedUser = {
        ...currentUser,
        display_name: displayName,
        bio,
        custom_status: customStatus,
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
        updated_at: new Date().toISOString(),
      }
      useAppStore.getState().setCurrentUser(updatedUser)

      // Broadcast profile update to other users via socket
      try {
        const { getSocket } = await import('@/lib/socket')
        getSocket().emit('user:profile:update', {
          userId: currentUser.id,
          displayName,
          bio,
          customStatus,
          avatarUrl,
          bannerUrl,
        })
      } catch {}

      // Keep the data URL previews (already showing the correct image).
      // Don't replace with server URL — that would cause a black flash while loading.
    } catch (err) {
      console.error('Save profile error:', err)
    }
    setSaving(false)
  }

  const handleStatusChange = (status: 'online' | 'idle' | 'dnd' | 'invisible') => {
    // Update local store immediately
    if (currentUser) {
      const updated = { ...currentUser, status }
      useAppStore.getState().setCurrentUser(updated)
    }
    // Broadcast via socket for other users
    changePresence(status)
    // Persist to DB
    if (currentUser) {
      fetch(`/api/users/${currentUser.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }).catch(() => {})
    }
  }

  // ─── Logout Handler ───────────────────────────────────────────────
  const handleLogout = useCallback(() => {
    disconnectSocket()
    localStorage.removeItem('ureedxdchat_user_id')
    localStorage.removeItem('ureedxdchat_selected_gc')
    localStorage.removeItem('ureedxdchat_selected_dm')
    useAppStore.getState().setCurrentUser(null)
    onOpenChange(false)
  }, [onOpenChange])

  // ─── Delete Account Handler ─────────────────────────────────────────
  const handleDeleteAccount = useCallback(async () => {
    if (!currentUser) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/users/${currentUser.id}`, { method: 'DELETE' })
      if (res.ok) {
        disconnectSocket()
        localStorage.removeItem('ureedxdchat_user_id')
        localStorage.removeItem('ureedxdchat_selected_gc')
        localStorage.removeItem('ureedxdchat_selected_dm')
        useAppStore.getState().setCurrentUser(null)
        onOpenChange(false)
      }
    } catch (err) {
      console.error('Delete account error:', err)
    }
    setDeleting(false)
  }, [currentUser, onOpenChange])

  const isFriend = targetUser ? friends.some((f) => f.id === targetUser.id) : false

  const handleSendMessage = () => {
    if (!targetUser || isOwnProfile) return
    onOpenChange(false)
  }

  const handleToggleFriend = async () => {
    if (!targetUser || isOwnProfile) return
    if (isFriend) {
      await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId: targetUser.id }),
      })
      useAppStore.getState().removeFriend(targetUser.id)
    } else {
      const { sendFriendRequest } = await import('@/lib/socket')
      sendFriendRequest(targetUser.id)
    }
  }

  const handleToggleBlock = async () => {
    if (!targetUser || isOwnProfile) return
    if (blocked) {
      await fetch('/api/blocks/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedId: targetUser.id }),
      })
      setBlocked(false)
    } else {
      await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockedId: targetUser.id }),
      })
      setBlocked(true)
    }
  }

  if (!targetUser) return null

  const currentStatus =
    (targetUser.status === 'invisible' || targetUser.status === 'offline') ? 'offline' : targetUser.status
  const statusObj = statusOptions.find((s) => s.value === (targetUser.status === 'offline' ? 'offline' : targetUser.status))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto bg-[#36393f] border-[#202225] text-zinc-100 p-0 gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Profile</DialogTitle>
          <DialogDescription>Edit your profile settings</DialogDescription>
        </DialogHeader>

        {/* Banner */}
        <div className="relative h-24 w-full overflow-hidden bg-zinc-800 sm:h-28">
          {bannerPreview ? (
            <img src={bannerPreview} alt="banner" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-800">
              <ImageIcon className="size-8 text-zinc-600" />
            </div>
          )}
          {isOwnProfile && (
            <label className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/0 transition-colors hover:bg-black/40">
              <CameraIcon className="size-6 text-white opacity-0 transition-opacity hover:opacity-100" />
              <input type="file" accept="image/*" className="hidden" onChange={handleBannerChange} />
            </label>
          )}
        </div>

        <div className="px-4 pb-5 sm:px-6">
          {/* Avatar overlapping banner */}
          <div className="relative -mt-12 mb-3">
            <div className="relative group">
              <Avatar className="size-24 ring-4 ring-[#36393f]">
                {avatarPreview ? (
                  <AvatarImage src={avatarPreview} alt={targetUser.display_name} />
                ) : null}
                <AvatarFallback className="bg-zinc-600 text-3xl font-bold text-zinc-200">
                  {targetUser.display_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {isOwnProfile && (
                <label className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/0 transition-colors hover:bg-black/40">
                  <CameraIcon className="size-5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </label>
              )}
            </div>
          </div>

          {/* Display Name & Username */}
          <h2 className="text-xl font-bold text-zinc-100">{targetUser.display_name}</h2>
          <p className="text-sm text-zinc-400">@{targetUser.username}</p>

          {/* Status indicator for other users */}
          {!isOwnProfile && currentStatus && (
            <div className="mt-1 flex items-center gap-1.5">
              <span
                className={cn(
                  'size-2.5 rounded-full',
                  statusObj?.color || 'bg-zinc-600'
                )}
              />
              <span className="text-xs capitalize text-zinc-400">
                {targetUser.status === 'invisible' ? 'Offline' : targetUser.status}
              </span>
            </div>
          )}

          {isOwnProfile ? (
            /* ─── Own Profile with Tabs ─────────────────────────────────────── */
            <Tabs defaultValue="profile" className="mt-4">
              <TabsList className="w-full bg-[#202225] h-9 p-1">
                <TabsTrigger
                  value="profile"
                  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-[#36393f] data-[state=active]:text-zinc-100 text-zinc-400"
                >
                  <UserIcon className="size-3.5" />
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  value="themes"
                  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-[#36393f] data-[state=active]:text-zinc-100 text-zinc-400"
                >
                  <Palette className="size-3.5" />
                  Themes
                </TabsTrigger>
                <TabsTrigger
                  value="audio"
                  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-[#36393f] data-[state=active]:text-zinc-100 text-zinc-400"
                >
                  <Volume2 className="size-3.5" />
                  Audio
                </TabsTrigger>
                <TabsTrigger
                  value="danger"
                  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400 text-zinc-500 hover:text-red-400"
                >
                  <AlertTriangle className="size-3.5" />
                  Danger
                </TabsTrigger>
              </TabsList>

              {/* Profile Tab */}
              <TabsContent value="profile" className="mt-4 space-y-0">
                {/* Status buttons */}
                <div className="mb-3 flex flex-wrap gap-2">
                  {statusOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      size="sm"
                      variant={targetUser.status === opt.value ? 'secondary' : 'ghost'}
                      className={cn(
                        'gap-1.5 text-xs',
                        targetUser.status === opt.value && 'text-white'
                      )}
                      onClick={() => handleStatusChange(opt.value)}
                    >
                      <span className={cn('size-2.5 rounded-full', opt.color)} />
                      {opt.label}
                    </Button>
                  ))}
                </div>

                <Separator className="bg-[#202225]" />

                {/* Editable fields */}
                <div className="space-y-4 mt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-display-name" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Display Name
                    </Label>
                    <Input
                      id="profile-display-name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="profile-email" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Email
                    </Label>
                    <Input
                      id="profile-email"
                      value={targetUser.email}
                      disabled
                      className="border-[#202225] bg-[#1e1f22] text-zinc-500 cursor-not-allowed"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="profile-custom-status" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Custom Status
                    </Label>
                    <Input
                      id="profile-custom-status"
                      value={customStatus}
                      onChange={(e) => setCustomStatus(e.target.value)}
                      placeholder="What are you up to?"
                      className="border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="profile-bio" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Bio
                    </Label>
                    <Textarea
                      id="profile-bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Tell the world about yourself"
                      className="border-[#202225] bg-[#202225] text-zinc-100 placeholder-zinc-500 focus-visible:ring-zinc-500 min-h-[80px] resize-none"
                    />
                  </div>
                </div>

                <DialogFooter className="mt-5">
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                    <SaveIcon className="size-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </Button>
                </DialogFooter>
              </TabsContent>

              {/* Themes Tab */}
              <TabsContent value="themes" className="mt-4">
                <ThemeEditor />
              </TabsContent>

              {/* Audio Tab */}
              <TabsContent value="audio" className="mt-4">
                <AudioSettings />
              </TabsContent>

              {/* DANGEROUS Tab */}
              <TabsContent value="danger" className="mt-4">
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-red-400" />
                    <h3 className="text-sm font-bold uppercase tracking-wider text-red-400">
                      Dangerous Zone
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-400">
                    These actions are irreversible. Proceed with caution.
                  </p>

                  <Separator className="bg-red-500/20" />

                  {/* Logout Button */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200">Log Out</p>
                      <p className="text-xs text-zinc-500">Sign out of your account on this device</p>
                    </div>
                    <Button
                      variant="outline"
                      className="shrink-0 gap-1.5 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 hover:text-yellow-300 hover:border-yellow-500/50"
                      onClick={handleLogout}
                    >
                      <LogOut className="size-4" />
                      Log Out
                    </Button>
                  </div>

                  <Separator className="bg-red-500/20" />

                  {/* Delete Account Button */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200">Delete Account</p>
                      <p className="text-xs text-zinc-500">Permanently delete your account and all associated data</p>
                    </div>
                    {!deleteConfirm ? (
                      <Button
                        variant="outline"
                        className="shrink-0 gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/50"
                        onClick={() => setDeleteConfirm(true)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-red-400">Are you sure?</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-zinc-600 text-zinc-300 hover:bg-zinc-700"
                          onClick={() => setDeleteConfirm(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-red-600 hover:bg-red-500 text-white"
                          onClick={handleDeleteAccount}
                          disabled={deleting}
                        >
                          {deleting ? 'Deleting...' : 'Yes, Delete'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            /* ─── Other User's Profile (read-only, no tabs) ────────────────── */
            <>
              <Separator className="my-4 bg-[#202225]" />

              <div className="space-y-3">
                {targetUser.custom_status && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                      Custom Status
                    </p>
                    <p className="text-sm text-zinc-200">{targetUser.custom_status}</p>
                  </div>
                )}

                {targetUser.bio && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                      About Me
                    </p>
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap">{targetUser.bio}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Member Since
                  </p>
                  <p className="text-sm text-zinc-200">
                    {new Date(targetUser.created_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              </div>

              {/* Action buttons for other user */}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                  onClick={handleSendMessage}
                >
                  <MessageSquareIcon className="size-4" />
                  Send Message
                </Button>
                <Button
                  variant="outline"
                  className={cn(
                    'gap-1.5',
                    isFriend
                      ? 'border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300'
                      : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                  )}
                  onClick={handleToggleFriend}
                >
                  {isFriend ? (
                    <>
                      <UserMinusIcon className="size-4" />
                      Remove Friend
                    </>
                  ) : (
                    <>
                      <UserPlusIcon className="size-4" />
                      Add Friend
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className={cn(
                    'gap-1.5',
                    blocked
                      ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                      : 'border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300'
                  )}
                  onClick={handleToggleBlock}
                >
                  <BanIcon className="size-4" />
                  {blocked ? 'Unblock' : 'Block'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}