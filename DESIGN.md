# Design System: Synapse Network

## 1. Visual Theme & Atmosphere

Synapse Network is an AI agent payment infrastructure platform — the visual language
is a **premium developer dark theme** that draws inspiration from the X Developer
Platform. The interface communicates institutional trust, technical precision, and
machine-native density. Every pixel is calibrated for developers reading API docs
at midnight.

The canvas is near-black (`#08090b`) with a faint cool undertone — darker than
typical dark themes, creating maximum contrast for the mint-green accent (`#7ff7be`).
This mint is used with surgical restraint on active states, badges, icons, and
high-signal interactive elements — it reads as "system online" against the dark
surface.

Typography density is deliberately high: 13px body text, 15px section headers,
11-14px navigation items. Information is compressed, not spread. Code blocks are
first-class citizens — cURL examples and JSON responses are the hero content of
every API endpoint view.

**Key Characteristics:**
- Near-black canvas (`#08090b`) with barely-perceptible surface layering
- Single-accent identity: Mint Green (`#7ff7be`) as the sole brand energy
- White-alpha border system (`rgba(255,255,255,0.05–0.08)`) for ghostly containment
- Rounded-xl (12px) as the standard card radius — X-developer-platform native
- Code syntax: blue strings, white keys/numbers — matching X API docs
- Typography: Inter/system UI, extremely tight, developer-grade hierarchy

---

## 2. Color Palette & Roles

### Brand Accent
| Name | Hex | Role |
|------|-----|------|
| Mint Active | `#7ff7be` | Active states, icons, CTA text, badges, indicators |
| CTA Button BG | `#1d7a4f` | Primary action button backgrounds |
| CTA Hover    | `#1b8f5a` | Button hover state |

### Surfaces & Backgrounds
| Name | Hex | Role |
|------|-----|------|
| Page Canvas | `#08090b` | Root background, sidebar background |
| Card Surface | `#09090c` | All card and panel backgrounds |
| Card Header | `#0d0d10` | Card header bars, topnav bar |

### Text Hierarchy
| Name | Hex | Role |
|------|-----|------|
| Bright White | `#e7e9ea` | Primary headings, H1, active nav, high-emphasis |
| Mid-White | `#c0c5cc` | Section labels, param names, code identifiers |
| Cool Mid | `#c0c8d0` | Parent nav items (sidebar) |
| Dim Text | `#8b98a5` | Child nav items, secondary body |
| Muted | `#71767b` | Body descriptions, captions, disabled |
| Ghost | `#4e535a` | Placeholders, metadata, deepest muted |
| Section Labels | `#636870` | Sidebar section group uppercase labels |

### Borders
| Name | Alpha | Role |
|------|-------|------|
| Standard Border | `rgba(255,255,255,0.08)` = `border-white/[0.08]` | Cards, inputs, method row |
| Subtle Border | `rgba(255,255,255,0.06)` = `border-white/[0.06]` | Card internal dividers |
| Ghost Border | `rgba(255,255,255,0.05)` = `border-white/[0.05]` | Sidebar right border |
| Focus Border | `rgba(255,255,255,0.20)` = `border-white/20` | Input focus ring |

### Semantic & Syntax Colors
| Name | Hex | Role |
|------|-----|------|
| Sky Blue | `#6eb6f6` | Query params, cURL flags, info callouts |
| Amber | `#f4a261` | cURL quoted values, body param labels |
| Lavender | `#c084fc` | Path params |
| Yellow | `#f9c74f` | Body param labels |
| Red | `#f87171` | Error states, DELETE method |

### HTTP Method Badges (solid)
| Method | Background | Text |
|--------|-----------|------|
| GET | `#00ba7c` | `#0f1419` (dark) |
| POST | `#1d9bf0` | `#ffffff` |
| PUT | `#f9c74f` | `#0f1419` (dark) |
| DELETE | `#f87171` | `#ffffff` |
| PATCH | `#f4a261` | `#0f1419` (dark) |

### Code Syntax (JSON + cURL)
| Token | Hex | Notes |
|-------|-----|-------|
| JSON keys | `#e7e9ea` | Bright white |
| JSON string values | `#6ab0f5` | Blue — X-style |
| JSON numbers | `#e7e9ea` | White |
| JSON booleans | `#e7e9ea` | White |
| JSON null | `#71767b` | Dim |
| JSON punctuation | `#6e7680` | Medium gray |
| cURL keyword `curl` | `#e7e9ea` | White |
| cURL flags `--header` | `#6eb6f6` | Blue |
| cURL quoted values | `#f4a261` | Amber |
| cURL continuation `\` | `#4e535a` | Ghost |

---

## 3. Typography Rules

### Font Stack
- **UI / Body**: `Inter`, `-apple-system, BlinkMacSystemFont, system-ui, sans-serif`
- **Monospace**: `SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace`

### Hierarchy

| Role | Size | Weight | Color | Notes |
|------|------|--------|-------|-------|
| Page H1 | `36px` | `700` | `#e7e9ea` | Endpoint title |
| Section header | `15px` | `600` | `#e7e9ea` | "Parameters", "Response" dividers |
| Nav parent items | `14px` | `400–500` | `#c0c8d0` | Sidebar top-level links |
| Nav child items | `13px` | `400` | `#8b98a5` | Sidebar endpoint sub-links |
| Body / descriptions | `13px` | `400` | `#71767b` | Leading `1.65` |
| Param names | `13px` | `600` mono | `#c0c5cc` | Inline code look |
| Code inline | `12px` | `400` mono | `#c0c5cc` | Input fields, badges |
| Card header labels | `12px` | `500` | `#c0c5cc` | cURL card / response card title |
| Badges / tags | `10–11px` | `600` | varies | Uppercase capsule labels |
| Sidebar section labels | `11px` | `600` | `#636870` | `tracking-[0.1em]` uppercase |
| Syntax code blocks | `11.5px` | `400` mono | various | `leading-[1.75]` |
| Micro / metadata | `9–10px` | `600` | `#4e535a` | Role badges, phase badges |

### Principles
- **Dense, not airy**: Body text is 13px — developer density, not marketing whitespace
- **Monospace is hero content**: Code blocks and parameter names use `SFMono-Regular`, identical to what developers see in their terminals
- **Uppercase is earned**: Only sidebar section group labels use uppercase + wide tracking — never headings
- **Active = Bright White**: When a nav item is selected, text steps up to `#e7e9ea` (full brightness)

---

## 4. Component Stylings

### Cards
```
background: #09090c
border: 1px solid rgba(255,255,255,0.08)
border-radius: 12px (rounded-xl)
overflow: hidden
```
Card header bar:
```
background: #0d0d10
border-bottom: 1px solid rgba(255,255,255,0.06)
padding: 12px 16px
```

### Sidebar
```
width: 240px
background: #08090b
border-right: 1px solid rgba(255,255,255,0.05)
position: sticky, top: 100px
overflow-y: auto
```
Section group label:
```
font-size: 11px, font-weight: 600, uppercase, letter-spacing: 0.1em
color: #636870
padding: 7px 8px
```
Parent nav item (inactive):
```
font-size: 14px, color: #c0c8d0
padding: 7px 12px, border-radius: 8px
hover: bg rgba(255,255,255,0.04), color white
```
Parent nav item (active):
```
color: white, bg: rgba(255,255,255,0.06)
left bar: 2px solid #7ff7be, absolute left-0
```
Child nav item:
```
font-size: 13px, color: #8b98a5
padding: 5px 12px, margin-left: 22px
border-left: 1px solid rgba(255,255,255,0.06)
active: color white + 2px mint green left indicator
```

### Method Row (API endpoint)
```
container: flex, flex-1, min-w-0, max-w-[640px]
border-radius: 12px, border: 1px solid rgba(255,255,255,0.08)
background: rgba(255,255,255,0.015), overflow: hidden
```
- Method badge: solid color (see HTTP Method Badges table), `px-3 py-2.5`, `text-[12px] font-bold font-mono`
- Path: `flex-1 min-w-0 truncate`, `text-[13px] font-mono`, color `#c0c5cc`, `border-l rgba(255,255,255,0.06)`
- Try it button: `bg-[#1d7a4f]` → hover `bg-[#1b8f5a]`, text `#7ff7be`, `border-l rgba(255,255,255,0.06)`

### Inputs / Form Fields
```
background: rgba(255,255,255,0.03)
border: 1px solid rgba(255,255,255,0.08)
border-radius: 8px (rounded-lg)
padding: 8px 12px
font-family: monospace, font-size: 12px
color: #c0c5cc
placeholder: #4e535a
focus: border rgba(255,255,255,0.20), no outline ring
```

### Badges & Capsule Tags
```
border-radius: 4px (rounded) — inline
border + background: color at 12–30% opacity, text at 100%
font-size: 9–11px, font-weight: 600, uppercase
padding: 1.5px 6px (rounded badge) or 4px 10px (full capsule)
```

### Buttons (standalone CTAs)
Primary action (e.g. "Try it", "Connect"):
```
background: #1d7a4f → hover: #1b8f5a
text: #7ff7be, font-size: 13px, font-weight: 600
padding: 10px 16px, border-radius: 12px
disabled: opacity 50%
```

Ghost / outline button:
```
background: transparent → hover: rgba(255,255,255,0.04)
text: #71767b → hover: white
border: 1px solid rgba(255,255,255,0.06) → hover: rgba(255,255,255,0.10)
border-radius: 8px, font-size: 13px, padding: 8px 16px
```

### 200 Response Status Badge
```
background: rgba(127,247,190,0.12) = #7ff7be/12
color: #7ff7be
font-size: 11px, font-weight: 700, font-family: mono
padding: 2px 8px, border-radius: 4px
```

---

## 5. Layout Principles

### Spacing Scale (Tailwind base = 4px)
```
2px, 4px, 6px, 8px, 10px, 12px, 14px, 16px, 20px, 24px, 40px, 64px
```
- Card internal padding: `16px 16px` for body, `12px 16px` for header
- Section gap: `gap-10` (40px) between left and right panels
- Sidebar padding: `py-3 px-2` nav wrapper, `px-3 py-[7px]` items

### Two-Column API Detail Layout
```
grid: grid-cols-1 xl:grid-cols-[1fr_380px]
gap: 40px (gap-10)
align: items-start
```
- LEFT col: breadcrumb → H1 → method row → params → sections (full-width)
- RIGHT col: sticky `top-[108px]`, cURL card + response card stacked, width `380px`

### Grid Containers
- Content max-width: `1180px`, centered, full width on smaller screens
- Sidebar: fixed `240px`, outside grid
- Right panel: fixed `380px`
- Left content: `1fr` (fills remaining)

### Whitespace Philosophy
- **Headers are compact**: Section dividers at 15px `pt-2 pb-1` — tight
- **Rows breathe**: Parameter rows `py-4` with `border-b border-white/[0.04]`
- **Cards stack with gap-4**: Between cURL card and response card: `space-y-4`
- **Page padding**: `pt-8` top, sides from container

### Border Radius Scale
| Token | Value | Used for |
|-------|-------|---------|
| `rounded` | 4px | Inline badges, capsule tags, small indicators |
| `rounded-md` | 6px | Small buttons, icon buttons |
| `rounded-lg` | 8px | Inputs, form fields, nav items |
| `rounded-xl` | 12px | Cards, panels, method row container |

---

## 6. Depth & Elevation

Synapse uses **border opacity** (not box-shadow) as the primary elevation signal —
identical to X Developer Platform.

| Level | Treatment | Used for |
|-------|-----------|----------|
| Flat (0) | No border | Page background |
| Ghost (1) | `1px solid rgba(255,255,255,0.05)` | Sidebar divider |
| Standard (2) | `1px solid rgba(255,255,255,0.08)` | Cards, inputs, method row |
| Divider (internal) | `1px solid rgba(255,255,255,0.06)` | Card internal sections |
| Active (accent) | `1px solid #7ff7be` or left `2px` bar | Active nav, active states |
| Ghost bg (tint) | `rgba(255,255,255,0.03–0.06)` | Card bg, hover bg |

No drop shadows. Depth is communicated by surface layering: `#08090b` → `#09090c` → `#0d0d10`.

---

## 7. Do's and Don'ts

### Do
- Use `#08090b` as the absolute page background — the darkest surface
- Use `#09090c` / `#0d0d10` for cards and their headers — one step lighter
- Reserve `#7ff7be` for mint: active indicators, badge text, success icons, CTA text only
- Use `rounded-xl` (12px) for all cards and panels — never `rounded-2xl` or larger
- Use white-alpha borders (`rgba(255,255,255,0.08)`) for containment — not colored borders
- Keep body descriptions at `13px / color #71767b / leading-[1.65]` — always
- Use monospace font for all parameter names, inline code, and API paths
- Match JSON syntax to X convention: string values = blue `#6ab0f5`, keys = white
- Compress section header font to 15px semibold `#e7e9ea` — not 16px, not bold
- Active sidebar items: white text + 2px `#7ff7be` left bar + subtle bg

### Don't
- Don't use `#ffffff` pure white as card background — it's a developer dark theme, always
- Don't use drop shadows — elevation comes from surface color layering only
- Don't add colored borders (green/blue) to cards unless it's an active/accent state
- Don't use font-size > 15px for section headers inside content area
- Don't increase card border-radius beyond `rounded-xl` (12px)
- Don't use amber (`#f4a261`) for JSON string values — that's cURL style; JSON strings are blue
- Don't use `rounded-full` for nav items — only for small dot indicators
- Don't use `font-weight: 700` (bold) for body text or descriptions — max 600 for labels
- Don't add decorative gradients or glow effects — the aesthetic is clinical precision, not energy

---

## 8. Responsive Behavior

### Breakpoints (Tailwind defaults)
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <1024px (`lg`) | Sidebar hidden, single-column |
| Desktop | ≥1024px (`lg`) | Sidebar visible at 240px |
| Wide | ≥1280px (`xl`) | Two-column layout activates (1fr + 380px) |

### Collapsing Strategy
- **Sidebar**: Hidden below `lg`, accessible via mobile menu or collapsed
- **Two-column grid**: Stack on <xl, 1fr right panel on wide
- **Method row**: `flex-wrap` — badges stack below path on narrow
- **Right panel (cURL + Response)**: Moves below left col on mobile
- **Code blocks**: `overflow-x-auto` with `whitespace-pre` — never wraps

### Touch Targets
- Minimum button/nav item: 38–44px tall via padding
- Icon buttons: `p-1.5` = 32px total (adequate)
- Nav items: `py-[7px]` with 14px text ≈ 35px — acceptable for sidebar

---

## 9. Agent Prompt Guide

### Quick Color Reference
```
Page background:   #08090b
Card surface:      #09090c
Card header bar:   #0d0d10
Mint accent:       #7ff7be  (active, icons, CTA text)
CTA button:        #1d7a4f → hover #1b8f5a
Primary text:      #e7e9ea
Mid text:          #c0c5cc
Body/desc text:    #71767b
Muted/ghost:       #4e535a
Border standard:   rgba(255,255,255,0.08)
Border subtle:     rgba(255,255,255,0.06)
Blue semantic:     #6eb6f6
Amber semantic:    #f4a261
JSON strings:      #6ab0f5
```

### Example Component Prompts
- "Create an API endpoint card on `#09090c` with a `1px solid rgba(255,255,255,0.08)` border and `rounded-xl` (12px) radius. Card header on `#0d0d10` shows the endpoint title in `12px Inter medium #c0c5cc`, with a `cURL` pill button and copy/sparkles icon buttons."

- "Build a sidebar nav item at `14px Inter` in `#c0c8d0`. On active: text becomes `#e7e9ea`, background `rgba(255,255,255,0.06)`, left edge gets a `2px absolute bar in #7ff7be`."

- "Design a parameter row with the param name in `13px semibold mono #c0c5cc`, a location badge (path=lavender `#c084fc`, query=blue `#6eb6f6`, body=amber `#f9c74f`) at `9px uppercase`, description in `13px #71767b leading-[1.65]`, and a `12px mono input` on `rgba(255,255,255,0.03)` background."

- "Render a method row: container `flex w-full max-w-[640px] rounded-xl border border-white/[0.08] overflow-hidden`. Left: `POST` badge solid `#1d9bf0 bg, white text, px-3 py-2.5 text-[12px] font-bold mono`. Middle: path `flex-1 truncate text-[13px] mono #c0c5cc border-l border-white/[0.06]`. Right: Try it button `bg-[#1d7a4f] hover:bg-[#1b8f5a] text-[#7ff7be] font-semibold`."

- "Create a JSON response card on `#09090c`. Header: `200` badge (bg `rgba(127,247,190,0.12)`, text `#7ff7be`, 11px mono bold), `default` label in `#71767b`. Body: syntax-highlighted JSON — keys `#e7e9ea`, string values `#6ab0f5` (blue), numbers `#e7e9ea`, punctuation `#6e7680`, `11.5px SFMono leading-[1.75]`."

### Iteration Guide
1. Reference specific hex codes: "use `#71767b`" not "make it gray"
2. Border changes = elevation change: swap `rgba(255,255,255,0.08)` → `rgba(255,255,255,0.05)` to de-emphasize
3. Active state always = mint `#7ff7be` left bar + `#e7e9ea` text + `rgba(255,255,255,0.06)` bg
4. JSON strings must be blue `#6ab0f5` — this is a deliberate X-style convention
5. Font size budget: H1=36, section=15, body=13, meta=10–11 — don't deviate
6. All border-radius for cards/panels: `rounded-xl` = 12px, no exceptions
