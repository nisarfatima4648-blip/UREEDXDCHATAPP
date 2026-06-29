'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  predefinedThemes,
  hslToHex,
  hexToHsl,
  generateRandomTheme,
} from '@/lib/themes'
import type { CustomTheme } from '@/lib/themes'
import {
  Palette,
  Check,
  Shuffle,
  RotateCcw,
  ArrowLeft,
  Plus,
  Minus,
  Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── HSL Color Picker ─────────────────────────────────────────────────────────

interface HSLPickerProps {
  color: string
  onChange: (hex: string) => void
  onDone?: () => void
}

function HSLColorPicker({ color, onChange, onDone }: HSLPickerProps) {
  const { h, s, l } = hexToHsl(color)
  const [hue, setHue] = useState(h)
  const [sat, setSat] = useState(s)
  const [lit, setLit] = useState(l)

  const sqRef = useRef<HTMLCanvasElement>(null)
  const draggingSq = useRef(false)
  const barRef = useRef<HTMLCanvasElement>(null)
  const draggingBar = useRef(false)

  // Draw saturation/lightness square
  const drawSquare = useCallback(() => {
    const canvas = sqRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const hh = canvas.height

    // Base hue fill
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`
    ctx.fillRect(0, 0, w, hh)

    // White gradient left→right
    const whiteGrad = ctx.createLinearGradient(0, 0, w, 0)
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)')
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = whiteGrad
    ctx.fillRect(0, 0, w, hh)

    // Black gradient top→bottom
    const blackGrad = ctx.createLinearGradient(0, 0, 0, hh)
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)')
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = blackGrad
    ctx.fillRect(0, 0, w, hh)

    // Draw selector
    const x = (sat / 100) * w
    const y = (1 - lit / 100) * hh
    ctx.beginPath()
    ctx.arc(x, y, 7, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [hue, sat, lit])

  // Draw hue bar
  const drawBar = useCallback(() => {
    const canvas = barRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const hh = canvas.height

    const grad = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= 360; i += 30) {
      grad.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, hh)

    // Draw selector
    const x = (hue / 360) * w
    ctx.beginPath()
    ctx.roundRect(x - 3, 0, 6, hh, 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.roundRect(x - 2, 1, 4, hh - 2, 1)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [hue])

  useEffect(() => {
    drawSquare()
  }, [drawSquare])
  useEffect(() => {
    drawBar()
  }, [drawBar])

  const handleSquareMove = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = sqRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      const newSat = Math.round(x * 100)
      const newLit = Math.round((1 - y) * 100)
      setSat(newSat)
      setLit(newLit)
      onChange(hslToHex(hue, newSat, newLit))
    },
    [hue, onChange]
  )

  const handleBarMove = useCallback(
    (clientX: number) => {
      const canvas = barRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const newHue = Math.round(x * 360)
      setHue(newHue)
      onChange(hslToHex(newHue, sat, lit))
    },
    [sat, lit, onChange]
  )

  const hex = hslToHex(hue, sat, lit)

  return (
    <div className="space-y-3">
      {/* Saturation/Lightness square */}
      <div
        className="relative w-full aspect-square rounded-lg cursor-crosshair overflow-hidden border border-[#202225]"
        onMouseDown={(e) => {
          draggingSq.current = true
          handleSquareMove(e.clientX, e.clientY)
        }}
        onMouseMove={(e) => {
          if (draggingSq.current) handleSquareMove(e.clientX, e.clientY)
        }}
        onMouseUp={() => {
          draggingSq.current = false
          onDone?.()
        }}
        onMouseLeave={() => {
          draggingSq.current = false
        }}
        onTouchStart={(e) => {
          draggingSq.current = true
          handleSquareMove(e.touches[0].clientX, e.touches[0].clientY)
        }}
        onTouchMove={(e) => {
          if (draggingSq.current) handleSquareMove(e.touches[0].clientX, e.touches[0].clientY)
        }}
        onTouchEnd={() => {
          draggingSq.current = false
          onDone?.()
        }}
      >
        <canvas ref={sqRef} width={256} height={256} className="w-full h-full" />
      </div>

      {/* Hue slider */}
      <div
        className="relative w-full h-6 rounded-md cursor-pointer overflow-hidden border border-[#202225]"
        onMouseDown={(e) => {
          draggingBar.current = true
          handleBarMove(e.clientX)
        }}
        onMouseMove={(e) => {
          if (draggingBar.current) handleBarMove(e.clientX)
        }}
        onMouseUp={() => {
          draggingBar.current = false
          onDone?.()
        }}
        onMouseLeave={() => {
          draggingBar.current = false
        }}
        onTouchStart={(e) => {
          draggingBar.current = true
          handleBarMove(e.touches[0].clientX)
        }}
        onTouchMove={(e) => {
          if (draggingBar.current) handleBarMove(e.touches[0].clientX)
        }}
        onTouchEnd={() => {
          draggingBar.current = false
          onDone?.()
        }}
      >
        <canvas ref={barRef} width={256} height={24} className="w-full h-full" />
      </div>

      {/* Current color preview */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg border border-[#202225] shrink-0"
          style={{ backgroundColor: hex }}
        />
        <span className="text-sm font-mono text-zinc-300 uppercase">{hex}</span>
      </div>
    </div>
  )
}

// ─── Predefined Theme Card ────────────────────────────────────────────────────

function ThemeCard({
  themeId,
  name,
  colors,
  isSelected,
  onSelect,
}: {
  themeId: string
  name: string
  colors: Record<string, string> | import('@/lib/themes').ThemeColors
  isSelected: boolean
  onSelect: () => void
}) {
  const bg = colors.background || '#313338'
  const fg = colors.foreground || '#dbdee1'
  const primary = colors.primary || '#23a559'
  const card = colors.card || '#2b2d31'
  const border = colors.border || '#3f4147'
  const muted = colors['muted-foreground'] || '#949ba4'

  return (
    <button
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col items-center gap-2 rounded-xl p-3 transition-all border-2',
        isSelected
          ? 'border-white/60 bg-white/5'
          : 'border-transparent hover:border-white/20 hover:bg-white/[0.02]'
      )}
    >
      {/* Mini preview */}
      <div
        className="w-full h-16 rounded-lg overflow-hidden relative"
        style={{ backgroundColor: bg, border: `1px solid ${border}` }}
      >
        {/* Simulated sidebar */}
        <div
          className="absolute left-0 top-0 bottom-0 w-6"
          style={{ backgroundColor: card, borderRight: `1px solid ${border}` }}
        />
        {/* Simulated content */}
        <div className="absolute left-8 top-2 right-2 space-y-1.5">
          <div className="h-2 w-12 rounded-sm" style={{ backgroundColor: fg, opacity: 0.7 }} />
          <div className="h-1.5 w-20 rounded-sm" style={{ backgroundColor: muted, opacity: 0.5 }} />
          <div className="h-1.5 w-16 rounded-sm" style={{ backgroundColor: muted, opacity: 0.4 }} />
          <div className="mt-2 h-2 w-10 rounded-full" style={{ backgroundColor: primary }} />
        </div>
      </div>

      {/* Name */}
      <span className="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors">
        {name}
      </span>

      {/* Checkmark */}
      {isSelected && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
          <Check className="size-3 text-white" />
        </div>
      )}
    </button>
  )
}

// ─── Main Theme Editor ────────────────────────────────────────────────────────

export default function ThemeEditor() {
  const activeThemeId = useAppStore((s) => s.activeThemeId)
  const customTheme = useAppStore((s) => s.customTheme)
  const setActiveThemeId = useAppStore((s) => s.setActiveThemeId)
  const setCustomTheme = useAppStore((s) => s.setCustomTheme)

  const [mode, setMode] = useState<'predefined' | 'custom'>('predefined')

  // Custom theme editing state
  const [editColors, setEditColors] = useState<string[]>(['#667eea', '#764ba2'])
  const [editAngle, setEditAngle] = useState(135)
  const [editIntensity, setEditIntensity] = useState(70)
  const [editingColorIndex, setEditingColorIndex] = useState<number | null>(null)

  // Initialize edit state from existing custom theme when switching to custom mode
  useEffect(() => {
    if (mode === 'custom') {
      if (customTheme) {
        setEditColors([...customTheme.gradient.colors])
        setEditAngle(customTheme.gradient.angle)
        setEditIntensity(customTheme.gradient.intensity)
      } else {
        // Default starting colors
        setEditColors(['#667eea', '#764ba2'])
        setEditAngle(135)
        setEditIntensity(70)
      }
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPredefined = (id: string) => {
    setActiveThemeId(id)
  }

  const handleSurpriseMe = () => {
    const random = generateRandomTheme()
    setEditColors([...random.gradient.colors])
    setEditAngle(random.gradient.angle)
    setEditIntensity(random.gradient.intensity)
  }

  const handleReset = () => {
    setActiveThemeId('midnight')
    setMode('predefined')
    setCustomTheme(null)
  }

  const handleApplyCustom = () => {
    const baseHue = hexToHsl(editColors[0]).h
    const h2 = editColors.length > 1 ? hexToHsl(editColors[1]).h : (baseHue + 60) % 360
    const h3 = editColors.length > 2 ? hexToHsl(editColors[2]).h : (h2 + 60) % 360

    const darkBg = hslToHex(baseHue, 18, 12)
    const fg = hslToHex(baseHue, 10, 88)
    const primary = hslToHex(h2, 65, 58)
    const card = hslToHex(baseHue, 18, 15)
    const secondary = hslToHex(baseHue, 14, 20)
    const muted = hslToHex(baseHue, 10, 25)
    const mutedFg = hslToHex(baseHue, 8, 58)
    const accent = hslToHex(h3, 55, 55)
    const border = hslToHex(baseHue, 14, 22)
    const input = hslToHex(baseHue, 14, 18)

    const theme: CustomTheme = {
      colors: {
        background: darkBg,
        foreground: fg,
        card: card,
        'card-foreground': fg,
        popover: card,
        'popover-foreground': fg,
        primary: primary,
        'primary-foreground': '#ffffff',
        secondary: secondary,
        'secondary-foreground': fg,
        muted: muted,
        'muted-foreground': mutedFg,
        accent: accent,
        'accent-foreground': fg,
        destructive: '#f23f43',
        border: border,
        input: input,
        ring: primary,
        sidebar: darkBg,
        'sidebar-foreground': fg,
        'sidebar-primary': primary,
        'sidebar-primary-foreground': '#ffffff',
        'sidebar-accent': secondary,
        'sidebar-accent-foreground': fg,
        'sidebar-border': border,
        'sidebar-ring': primary,
      },
      gradient: {
        colors: [...editColors],
        angle: editAngle,
        intensity: editIntensity,
      },
    }

    setCustomTheme(theme)
    setActiveThemeId('custom')
    setMode('predefined')
  }

  const handleAddColor = () => {
    if (editColors.length < 3) {
      const randomHue = Math.floor(Math.random() * 360)
      setEditColors([...editColors, hslToHex(randomHue, 60, 50)])
    }
  }

  const handleRemoveColor = (index: number) => {
    if (editColors.length > 1) {
      setEditColors(editColors.filter((_, i) => i !== index))
      if (editingColorIndex === index) setEditingColorIndex(null)
      else if (editingColorIndex !== null && editingColorIndex > index) {
        setEditingColorIndex(editingColorIndex - 1)
      }
    }
  }

  // Gradient preview
  const gradientPreview = `linear-gradient(${editAngle}deg, ${editColors
    .map((c, i) => `${c} ${(i / Math.max(editColors.length - 1, 1)) * 100}%`)
    .join(', ')})`

  return (
    <div className="px-4 pb-5 sm:px-6">
      {mode === 'predefined' ? (
        <>
          {/* Section: Predefined Themes */}
          <div className="mb-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <Palette className="size-3.5" />
              Theme
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {predefinedThemes.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  themeId={theme.id}
                  name={theme.name}
                  colors={theme.colors}
                  isSelected={activeThemeId === theme.id}
                  onSelect={() => handleSelectPredefined(theme.id)}
                />
              ))}
              {/* Custom theme card */}
              <ThemeCard
                themeId="custom"
                name="Custom"
                colors={customTheme?.colors || {
                  background: '#1a1a2e',
                  foreground: '#e0d4ff',
                  primary: '#7c5cfc',
                  card: '#2a2a50',
                  border: '#3a3a60',
                  'muted-foreground': '#7f8fa6',
                }}
                isSelected={activeThemeId === 'custom'}
                onSelect={() => setMode('custom')}
              />
            </div>
          </div>

          <Separator className="bg-[#202225] my-4" />

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              onClick={handleSurpriseMe}
            >
              <Shuffle className="size-4" />
              Surprise Me!
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              onClick={handleReset}
            >
              <RotateCcw className="size-4" />
              Reset to Midnight
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Custom Theme Editor */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
              <Pencil className="size-3.5" />
              Create Custom Theme
            </h3>
          </div>

          {/* Gradient Preview */}
          <div
            className="w-full h-20 rounded-xl mb-4 border border-[#202225]"
            style={{
              background: gradientPreview,
              opacity: editIntensity / 100,
            }}
          />

          {/* Color stops */}
          <div className="space-y-3 mb-5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Gradient Colors
            </Label>

            {/* Color swatches row */}
            <div className="flex items-center gap-2 flex-wrap">
              {editColors.map((color, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <button
                    onClick={() => setEditingColorIndex(editingColorIndex === i ? null : i)}
                    className={cn(
                      'w-9 h-9 rounded-lg border-2 transition-all',
                      editingColorIndex === i
                        ? 'border-white scale-110 shadow-lg'
                        : 'border-[#202225] hover:border-white/40'
                    )}
                    style={{ backgroundColor: color }}
                  />
                  {editColors.length > 1 && (
                    <button
                      onClick={() => handleRemoveColor(i)}
                      className="text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      <Minus className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {editColors.length < 3 && (
                <button
                  onClick={handleAddColor}
                  className="w-9 h-9 rounded-lg border border-dashed border-zinc-600 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:border-zinc-400 transition-colors"
                >
                  <Plus className="size-4" />
                </button>
              )}
            </div>

            {/* Color picker (shown when a color is selected) */}
            {editingColorIndex !== null && (
              <div className="mt-3 p-3 rounded-xl bg-[#1e1f22] border border-[#202225]">
                <HSLColorPicker
                  color={editColors[editingColorIndex]}
                  onChange={(hex) => {
                    setEditColors((prev) => {
                      const next = [...prev]
                      next[editingColorIndex] = hex
                      return next
                    })
                  }}
                />
              </div>
            )}
          </div>

          <Separator className="bg-[#202225] my-4" />

          {/* Gradient Direction */}
          <div className="space-y-3 mb-5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Gradient Direction
              </Label>
              <span className="text-xs text-zinc-500">{editAngle}°</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Circular preview */}
              <div
                className="w-12 h-12 rounded-full border border-[#202225] shrink-0 relative overflow-hidden"
                style={{ background: gradientPreview, opacity: 0.9 }}
              >
                <div
                  className="absolute top-1/2 left-1/2 w-1 h-1 bg-white rounded-full -translate-x-1/2 -translate-y-1/2"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${editAngle}deg) translateY(-18px)`,
                  }}
                >
                  <div className="w-2 h-2 bg-white rounded-full -ml-[3px] -mt-[3px]" />
                </div>
              </div>
              <Slider
                value={[editAngle]}
                onValueChange={([v]) => setEditAngle(v)}
                min={0}
                max={360}
                step={1}
                className="flex-1"
              />
            </div>
          </div>

          {/* Intensity */}
          <div className="space-y-3 mb-5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Intensity
              </Label>
              <span className="text-xs text-zinc-500">{editIntensity}%</span>
            </div>
            <Slider
              value={[editIntensity]}
              onValueChange={([v]) => setEditIntensity(v)}
              min={0}
              max={100}
              step={1}
            />
          </div>

          <Separator className="bg-[#202225] my-4" />

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 mb-5">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              onClick={handleSurpriseMe}
            >
              <Shuffle className="size-4" />
              Surprise Me!
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              onClick={handleReset}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </div>

          {/* Bottom buttons */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
              onClick={() => setMode('predefined')}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              onClick={handleApplyCustom}
            >
              <Check className="size-4" />
              Apply
            </Button>
          </div>
        </>
      )}
    </div>
  )
}