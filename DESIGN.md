---
name: Hestia
description: A night-sea landing page for a document workspace that never erases what passed through it.
colors:
  # Paper is the default theme; the night sea below is the dark theme.
  # Every pair is one token name resolved twice — see the Colors section.
  paper-abyss: "#f7fafc"
  paper-deep: "#edf5f8"
  paper-current: "#e4f0f5"
  paper-shelf: "#d4e7ee"
  paper-plankton: "#1674a0"
  paper-wake: "#006f8e"
  paper-trace: "#0a6a86"
  paper-amber: "#9a5708"
  paper-amber-deep: "#75410a"
  paper-foam: "#10202a"
  paper-foam-dim: "#435b6a"
  paper-foam-faint: "#607887"
  paper-alarm: "#b3261e"
  abyss: "#05070b"
  deep: "#081222"
  current: "#0d2138"
  shelf: "#12304d"
  plankton: "#1e90ff"
  wake: "#00e5ff"
  trace: "#4bd6ff"
  amber: "#f5a83c"
  amber-deep: "#b76f18"
  foam: "#d6e8f5"
  foam-dim: "#9dbcd2"
  foam-faint: "#86a7be"
  foam-cut: "rgba(125, 176, 205, 0.62)"
  foam-rest: "#7f9fb6"
  edge: "rgba(75, 214, 255, 0.22)"
  edge-soft: "rgba(75, 214, 255, 0.1)"
  control-base: "rgba(7, 13, 22, 0.94)"
  field-base: "rgba(7, 15, 28, 0.93)"
  alarm-foam: "#ff9a86"
typography:
  display:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 1.2rem + 6vw, 6rem)"
    fontWeight: 250
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(1.9rem, 1.1rem + 3.2vw, 3.6rem)"
    fontWeight: 250
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline-close:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 1.2rem + 4.4vw, 4.8rem)"
    fontWeight: 250
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline-loud:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 1.2rem + 4vw, 4.6rem)"
    fontWeight: 250
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline-quiet:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.1rem + 1.6vw, 2.3rem)"
    fontWeight: 250
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(1.35rem, 1.1rem + 1vw, 1.9rem)"
    fontWeight: 300
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  lead:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(1rem, 0.95rem + 0.35vw, 1.2rem)"
    fontWeight: 350
    lineHeight: 1.7
    letterSpacing: "-0.01em"
  body:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "clamp(0.95rem, 0.9rem + 0.2vw, 1.0625rem)"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "-0.01em"
  note:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "-0.01em"
  small:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.01em"
  fine:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "0.1em"
  label:
    fontFamily: "Jost, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0.24em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.88em"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  control:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "0"
  brand:
    fontFamily: "Jost, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 300
    lineHeight: 1.75
    letterSpacing: "0.42em"
  tree-space:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "1.3rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "-0.01em"
  tree-row:
    fontFamily: "SUIT Variable, Jost, system-ui, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "-0.01em"
rounded:
  none: "0"
  hairline: "2px"
  full: "50%"
spacing:
  hair: "0.35rem"
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1.4rem"
  lg: "2rem"
  gutter: "clamp(1.25rem, 5vw, 6rem)"
  band-body: "clamp(3rem, 6vh, 5rem)"
  band-top: "clamp(7rem, 14vh, 12rem)"
components:
  button-primary:
    backgroundColor: "{colors.control-base}"
    textColor: "{colors.foam}"
    rounded: "{rounded.hairline}"
    padding: "0.85rem 1.6rem"
  button-primary-hover:
    backgroundColor: "{colors.control-base}"
    textColor: "{colors.foam}"
  button-amber:
    backgroundColor: "{colors.control-base}"
    textColor: "{colors.foam}"
    rounded: "{rounded.hairline}"
    padding: "0.85rem 1.6rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foam}"
    rounded: "{rounded.hairline}"
    padding: "0.85rem 1.6rem"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.foam-faint}"
    rounded: "{rounded.hairline}"
    padding: "0.85rem 1.6rem"
  input-field:
    backgroundColor: "{colors.field-base}"
    textColor: "{colors.foam}"
    rounded: "{rounded.hairline}"
    padding: "0.85rem 1.1rem"
  finder-field:
    backgroundColor: "{colors.field-base}"
    textColor: "{colors.foam-faint}"
    rounded: "{rounded.none}"
    padding: "0.55rem 1.3rem"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.foam-faint}"
    typography: "{typography.body}"
  nav-link-hover:
    textColor: "{colors.wake}"
  version-knot:
    backgroundColor: "transparent"
    textColor: "{colors.foam-faint}"
    padding: "0.85rem 0.9rem 0.85rem 0"
  version-knot-past:
    textColor: "{colors.foam-dim}"
  version-knot-selected:
    textColor: "{colors.foam}"
  document-surface:
    backgroundColor: "{colors.current}"
    textColor: "{colors.foam}"
    rounded: "{rounded.none}"
    padding: "clamp(1.5rem, 3vw, 2.5rem)"
---

# Design System: Hestia

## Overview

**Creative North Star: "The Wake That Never Cools Out"**

The whole world is one image held consistently: a hull crossing a night sea. Everything the sea itself lights — plankton around the hull, plankton under the cursor — burns for a second or two and dies. That is what every other tool does with document history. The wake behind the hull does not die: it spreads, it cools from cyan to amber, and it stays lit all the way back to the top of the document. That is Hestia. The page does not argue this in copy first; it renders it, and the copy names what the reader already saw.

The surface is dark, thin, and quiet. Ground is abyss black (`#05070b`) with no lighter surface tier anywhere on the page — there are no cards, no panels, no three-column feature grid. Structure comes from hairline rules, left borders, and lit rims rather than from filled boxes. Type is set at ultra-thin weights (250 for headings, 350–400 for prose) at large sizes, so headings read as drawn line rather than as mass. Density is low and vertical: one reading column, left-aligned, in a lane the canvas is deliberately kept out of.

The one deviation the build permits itself is the closing band, which centers after four left-aligned bands so the page ends on a different axis than it ran on. Everything else holds a single left edge.

**Key Characteristics:**
- Abyss black ground with no elevated surface tier; depth is atmospheric, not stacked.
- Two-temperature semantic colour: cyan is *now*, amber is *kept*.
- Ultra-thin geometric sans (SUIT 250/300/350, Jost 300/400 for Latin labels) at large display sizes.
- Controls are dark and defined by a lit rim, never by a coloured slab.
- Exactly one authored motion: the fixed-canvas wake. Sections do not animate in.
- Authored SVG icons only — 24 grid, 1.25 stroke, round caps, no fills, no glyphs, no emoji.

## Colors

A cold near-black sea with two lights in it, and the difference between those two lights carries meaning rather than decoration.

**Two themes, one vocabulary.** The landing ships in two grounds: **paper** (the default) and the **night sea** (`data-theme="dark"`). They are not two palettes — they are one set of token names resolved twice. `--wake` is *now* in both; it is `#00e5ff` on the sea and `#006f8e` on paper, because the same signal needs a different value to stay legible and to clear 4.5:1 against its own ground. Everything below names the meaning; the hex depends only on which ground you are standing on.

Two consequences follow, and both are rules rather than preferences:

- **No rule may hardcode a colour.** A rule that writes `rgba(0, 229, 255, 0.12)` is a rule that is wrong in one of the two themes, and it will be patched later by a `[data-theme="light"]` override that has to be kept in sync by hand. Take the token; let the theme resolve it.
- **Glow is a sea effect and does not exist on paper.** Where the dark theme lights a control with a halo, paper lifts it with elevation instead. The tokens that carry emphasis (`--control-lift`, `--field-glow`, `--mark-glow`, `--hero-glow-now`, `--hero-glow-kept`) therefore hold whole shadow values, not colours, so each ground can express the same emphasis in its own physics. On paper several of them resolve to `none`.

### Paper (default)
- **Ground** (`#f7fafc`), with `#edf5f8` / `#e4f0f5` / `#d4e7ee` as the washes that replace the water column. As on the sea, there is no elevated card tier — structure is still hairlines and rims.
- **Ink** (`#10202a`, dim `#435b6a`, faint `#607887`): the inversion of foam, at the same three strengths and the same jobs.
- **Wake** (`#006f8e`) and **Trace** (`#0a6a86`): *now*, re-mixed to hold 4.5:1 on a near-white ground.
- **Amber** (`#9a5708`) and **Deep Amber** (`#75410a`): *kept*, likewise re-mixed. On paper amber reads as a burnt ochre rather than a lamp, which is the correct reading — paper has no lamp.
- **Daylight** (`--daylight-cool`, `--daylight-warm`): two wide radial washes standing in for the canvas, which is hidden on paper. They are the only atmosphere the light theme has, and they resolve to `transparent` on the sea, where the wake does that work.

### Night sea — Primary
- **Wake Cyan** (`#00e5ff`): the colour of *what is happening now*. It is the hull's own light on the canvas, the focus ring, the input focus glow, the selected revision's dot, the left rail of a matched search result, and the search highlight. Never used for large areas — it is a rim, a dot, a stroke, or a single word.
- **Plankton Blue** (`#1e90ff`): the cooler live tone in the canvas gradients and hull halo. It is a canvas-only value; UI chrome does not use it directly.
- **Trace Cyan** (`#4bd6ff`): the softened cyan used for hairline borders (`--edge`, `--edge-soft`), version timestamps, and the opened disclosure caret. Cyan at reading brightness rather than at signal brightness.

### Secondary
- **Harbor Amber** (`#f5a83c`): the colour of *history held on to*. It marks added lines in a revision, past revisions on the version rail, the role tag in the space tree, a successful waitlist registration, and the second line of the hero headline. It is the payoff colour; if amber appears, something was kept.
- **Deep Amber** (`#b76f18`): the aged end of the same light — the top of the version rail's gradient thread and the synthetic-data dot.

### Neutral
- **Abyss** (`#05070b`): page ground, the canvas's base fill, the scrim, the vignette, and the theme colour. Nothing on the page is lighter than a translucent wash of it.
- **Deep / Current / Shelf** (`#081222`, `#0d2138`, `#12304d`): the water column, used only as low-alpha gradient stops — the canvas depth gradient and the document surface's washed backdrop. They are never solid fills.
- **Foam** (`#d6e8f5`): primary body and heading text.
- **Foam Dim** (`#9dbcd2`): lead paragraphs, notes, secondary tree rows — full-strength secondary text.
- **Foam Faint** (`#86a7be`): labels, metadata, placeholders, source lines, footer prose.
- **Foam Cut** (`rgba(125,176,205,0.62)`) and **Foam Rest** (`#7f9fb6`): the two dimmed reading states — a deleted line, and a search result before a query narrows it.
- **Alarm Foam** (`#ff9a86`): the only warm-red in the system, used solely for a rejected waitlist submission.

### Named Rules

**The Two Temperatures Rule.** Cyan means live, amber means kept, and nothing else may claim either. A cyan element must be something happening right now (focus, selection, a match, the hull). An amber element must be something the product refused to lose (an added line, a past revision, a confirmed registration). Decorative use of either breaks the page's only argument.

**The No Opacity Dimming Rule.** Dimmed text is dimmed with a hue-tinted colour at full alpha, never with `opacity`. A resting search result is `#7f9fb6`, not foam at 60%. The dimmed states are still body text and still have to clear 4.5:1 against the abyss.

**The Opaque Base Rule.** Any control the fixed canvas passes behind gets an opaque base — `--control-base` for buttons, `--field-base` for fields. Without it the wake bleeds through and the control reads a different colour at every scroll position. Both tokens resolve per theme (`rgba(7,13,22,0.94)` / `rgba(7,15,28,0.93)` on the sea; near-white on paper), so the rule holds on either ground.

**The One Definition Rule.** A colour is defined exactly once per theme, in the `:root` and `[data-theme="dark"]` blocks of `globals.css`, and everywhere else it is referenced by name. `[data-theme="light"]` blocks that restate a value are drift, not theming: the light landing once carried twenty-one such overrides, every one of them a value that had been hardcoded into a base rule and then undone. There is now exactly one light-only rule in the system — the daylight wash, which exists because the canvas is hidden rather than recoloured.

## Typography

**Display Font:** SUIT Variable (with Jost, system-ui, sans-serif)
**Body Font:** SUIT Variable — the same family, differentiated by weight rather than by pairing
**Label/Latin Font:** Jost (300–400), applied via `.latin` to version numbers, timestamps, source paths, brand, and uppercase labels

**Character:** One Korean-first geometric sans carries the whole page, run so thin at display sizes that headlines read as a drawn contour against black. Jost appears only where the content is Latin or systemic — `v3`, `2026-03-11 09:41`, `HESTIA` — so the Latin never has to fake Korean's rhythm.

### Hierarchy
- **Display** (250, `clamp(2.6rem, 1.2rem + 6vw, 6rem)`, 1.08): hero headline only. Two lines, capped at 20ch, with a 2.5rem cyan text-shadow bloom; the kept half of the line takes the amber bloom instead.
- **Headline** (250, `clamp(1.9rem, 1.1rem + 3.2vw, 3.6rem)`, 1.08): section openings. Deliberately *not* uniform — the structure band steps down to `clamp(1.5rem, 1.1rem + 1.6vw, 2.3rem)` so the tree carries the weight, and the search and close bands step up to ~4.6–4.8rem. Four bands, four different bars.
- **Title** (300, `clamp(1.35rem, 1.1rem + 1vw, 1.9rem)`): the demonstrated document's title inside the history surface.
- **Lead** (350, `clamp(1rem, 0.95rem + 0.35vw, 1.2rem)`, 1.7, max 34rem): the paragraph under every section heading.
- **Body** (400, `clamp(0.95rem, 0.9rem + 0.2vw, 1.0625rem)`, 1.75, tracking −0.01em): everything else.
- **Label** (Jost 400, 0.72rem, +0.24em, uppercase): the only uppercase in the system.
- **Brand** (Jost 300, 0.95rem, +0.42em with matching text-indent): the wordmark, loosened to 0.3em below 620px.

### Named Rules

**The Thin-and-Large Rule.** Headings get lighter as they get bigger (250 at display, 300 at title, 400 at body). Never bold a heading to add emphasis; move it up the size ramp or change its colour instead.

**The Different Bar Rule.** No two consecutive sections open at the same heading size. The heading scale is a rhythm instrument, not a fixed ramp.

**The Latin Lane Rule.** Version numbers, dates, paths, and the wordmark are Jost; Korean prose is SUIT. Never set Korean in Jost.

## Layout

One reading column, left-aligned, inside a 78rem max-width band centered in a fluid gutter (`clamp(1.25rem, 5vw, 6rem)`). Prose is measured at 34rem (`--measure`) and never runs the full band width.

The hero is a full-height flex column (`min-height: 100svh`) with the headline, lead, waitlist form, and a scroll cue stacked at the vertical center. Content bands use an asymmetric vertical rhythm — `clamp(7rem, 14vh, 12rem)` above, `clamp(4rem, 8vh, 7rem)` below — so each band reads as opening rather than as a slot in a stack. Demonstration content sits `clamp(3rem, 6vh, 5rem)` below its heading.

Two bands use a two-column grid at desktop width: version history (`minmax(16rem, 22rem) 1fr` — rail then document) and structure (`minmax(0, 34rem) minmax(0, 26rem)` — tree then note). Both collapse to a single column at 900px. The version rail deliberately stays a vertical thread when it collapses rather than becoming a horizontal card scroller.

The canvas is `position: fixed; inset: 0` behind everything at `z-index: 0`, with content in a `z-index: 1` shell and a fixed nav at `z-index: 20`. The canvas biases its own lane toward `0.55–0.94` of viewport width so the wake never sits under the reading column; below 900px, where the reading column is the full width, the lane pins to `0.85–0.99` and the hull's halo shrinks to 34% of the smaller viewport dimension.

**Breakpoints:** 900px (grids collapse, canvas lane and scrim re-bias) and 620px (nav compresses, brand tracking loosens, waitlist button goes full-width).

**The Quiet Column Rule.** A left-to-right scrim is painted over the canvas every frame — 78%→46%→0% abyss at desktop, 84%→72%→52% below 900px — so the reading column always sits on near-solid black. Text is never placed in the lit lane.

## Elevation & Depth

There are no box-shadow elevation tiers and no surface hierarchy. Nothing is lifted above the page; everything is submerged in the same water. Depth is atmospheric, produced by four stacked canvas layers rather than by stacked surfaces: an abyss fill, a top-down depth gradient (`#0d2138` at 40% → `#081222` at 15% → transparent), a radial vignette anchored at 62%/50% falling to 60% abyss at the edges, and **Abyss Film** — a real 128×128 noise tile generated once into a `CanvasPattern` with a cold bias (R 40–130, G 90–220, B 120–255) and laid over the finished frame at 5.5% alpha.

The only shadows in the system are light, not shade: glows that mark state.

### Shadow Vocabulary
- **Control ignition** (`0 0 1.5rem rgba(0,229,255,0.35), inset 0 0 2rem rgba(0,229,255,0.12)`): button hover. The amber variant swaps to `rgba(245,168,60,0.32)` / `0.1`.
- **Field focus** (`0 0 1.2rem rgba(0,229,255,0.25)`): input focus; the search field uses a wider `1.4rem / 0.22`.
- **Selected revision** (`0 0 0.9rem rgba(0,229,255,0.75)`): the current knot's dot.
- **Kept line** (`0 0 0.7rem rgba(245,168,60,0.6)`): the dot marking an added line.
- **Headline bloom** (`text-shadow: 0 0 2.5rem rgba(0,229,255,0.18)`, amber `0.28` on the kept line): hero only.
- **Search match** (`text-shadow: 0 0 0.85rem rgba(0,229,255,0.75)`): highlighted term, on a transparent `mark`.

**The Glow-Not-Shade Rule.** Every shadow in this system is a light source at a state change. There are no drop shadows, no offset shadows, no ambient occlusion under resting elements. If an element is not doing something, it does not glow.

## Shapes

The form language is near-square and hairline. Buttons and inputs take a 2px radius — enough to avoid a hard corner, not enough to read as rounded. Every other surface is a true rectangle (0 radius): the document surface, the search field, list rows. The only circles are meaning-bearing: the version dot (13px), the added-line dot (7px), the synthetic-data dot (5px), and the ring in the wordmark.

Boundaries are single-pixel and usually partial. A full border appears only on controls and the document surface; elsewhere structure is drawn with one edge — a left border on the search result rail and the structure note, a left border on nested tree levels, a top border between adjacent rows, and a horizontal rule that fades out to the right (`linear-gradient(to right, var(--edge), transparent)`).

**The Hairline Rule.** Borders are 1px and cyan-tinted at 22% (`--edge`) or 10% (`--edge-soft`). No thick borders, no double rules, no filled dividers.

**The Authored Icon Rule.** Icons are hand-drawn SVG on a 24 grid at 1.25 stroke with round caps and joins, `fill: none`, coloured by `currentColor`. Six exist (arrow, lock, search, ring, page, caret). No icon fonts, no emoji, no glyph characters, no third-party icon packages.

## Components

### Buttons
- **Shape:** near-square (2px radius), inline-flex with a 0.7rem gap to its trailing icon.
- **Primary:** dark opaque base (`rgba(7,13,22,0.94)`) with a 1px rim in `var(--glow)`, foam text at 0.85rem with +0.16em tracking, 0.85rem/1.6rem padding. The rim colour is a per-instance custom property; `.btn-amber` sets `--glow: var(--amber)` and nothing else changes.
- **Hover / Focus:** a 12–14% tint of the glow colour washes the base, the ignition glow lights, and an authored SVG plankton field — 30 circles at varied radius and opacity, masked and tinted by `var(--glow)` — fades to 80% inside the button and drifts horizontally on an 11s linear loop. Touching the control disturbs the water inside it. Transitions run 0.5–0.6s on `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Disabled:** transparent base, faint-foam text, and `--glow` swapped to a desaturated `rgba(125,160,185,0.35)` so the rim goes dark with the label.
- **Ghost:** transparent base with the standard hairline `--edge` rim.

### Inputs / Fields
- **Style:** 1px `--edge` rim on an opaque `rgba(7,15,28,0.93)` base, 2px radius, 0.85rem/1.1rem padding, 0.95rem text at zero tracking — the one place tracking resets to normal, because this is data the user typed.
- **Focus:** rim goes wake cyan and the field takes the focus glow. Global `:focus-visible` is a 2px wake outline at 3px offset; it is never removed.
- **Search field composite:** the icon, the label, and a chrome-stripped input share one bordered row that lights as a unit on `:focus-within` — border, icon colour, and glow all shift together, so the icon reads as part of the field, not next to it.
- **Error:** the message under the field turns alarm foam (`#ff9a86`); success turns amber. The field itself carries `aria-invalid` rather than a colour change.

### Navigation
- Fixed to the top at `z-index: 20`. The wordmark sits left (Jost 300, +0.42em); section links sit right at 0.8rem with +0.16em tracking in faint foam, going wake cyan on hover over a 0.4s ease.
- The veil behind it is a separate `::before` layer — a top-down abyss gradient with a 5px backdrop blur, itself masked to fade out at 55% — so the veil can dissolve without taking the nav's own text with it.

### Version Rail (signature)
The load-bearing component. An ordered list of revisions rendered as buttons on a single vertical thread whose gradient runs deep amber at the top to translucent cyan at the bottom — the past is amber, the present is cyan, stated as a gradient before anything is clicked. Each knot is a three-area grid (dot / version number / metadata, with the summary spanning underneath). Three states: **future** (faint foam, hollow dot with a faint rim), **past** (dim foam, amber-rimmed dot with a 28% amber fill), **selected** (full foam, solid cyan dot with a cyan glow, `aria-current="true"`). Colour and glow carry the state; nothing moves.

### Document Surface (signature)
The one place a background wash appears: a `--edge-soft` hairline box over a top-down gradient from `rgba(13,33,56,0.55)` to `rgba(8,18,34,0.4)` — the water column, not a card. Header (breadcrumb, title, Jost stamp in trace cyan) is separated by a hairline; body lines are a two-column grid with a mark gutter. Three line states: **kept** (foam, 7px hairline dash at 50%), **added** (amber, a 7px glowing dot), **cut** (foam-cut colour with a 1px strike in the same hue). Deleted content is never removed from the DOM — it is dimmed and struck, and screen readers get an explicit `(deleted in this revision)` note.

### Space Tree (signature)
Nested lists indented by a 1.15rem pad against a `--edge-soft` left border. Space rows are larger (1.3rem) in full foam with a cyan ring icon; page rows are 1.06rem in dim foam and brighten to foam on hover. The disclosure toggle is a bare caret that rotates 90° and shifts to trace cyan when open. Role tags are uppercase Jost 0.68rem in amber. A locked space renders as a non-interactive row with a lock icon and the note "title only" — present, named, unopenable.

### Search Results (signature)
An unbordered list where each row is separated by a hairline top border and carries a transparent 1px left border. At rest the text sits at foam-rest (`#7f9fb6`) — legible, unhighlighted. A matching row lights its left border wake cyan and its text to full foam; the matched substring is a `mark` with no background at all, coloured wake cyan with a glow. The source line under each row is Jost at 0.75rem with +0.14em tracking. The empty state is prose, not an illustration.

### Waitlist Form
Email field and amber button on one wrapping flex row capped at 30rem, with a status line beneath that starts as a promise ("one email when the beta opens"), turns amber on success, and alarm-foam on rejection. The button label cycles through its own three states (`register` / `registering` / `registered`) and disables on both pending and success. Below 620px the button goes full width under the field. In the closing band the whole form centers with the rest of the section.

## Do's and Don'ts

### Do:
- **Do** reserve wake cyan (`#00e5ff`) for live state and harbor amber (`#f5a83c`) for kept history. Ask "is this happening now, or was this held on to?" before assigning either.
- **Do** give any control that sits over the fixed canvas an opaque base (`rgba(7,13,22,0.94)` / `rgba(7,15,28,0.93)`); otherwise the wake changes its colour as the page scrolls.
- **Do** dim with a hue-tinted colour at full alpha (`#7f9fb6`, `rgba(125,176,205,0.62)`), never with `opacity` — dimmed body text must still clear 4.5:1 on abyss black.
- **Do** define surfaces with a lit 1px rim or a single edge, and draw structure with hairlines at `--edge` (22%) or `--edge-soft` (10%).
- **Do** vary the section heading size band to band (`1.5rem` floor for structure, `4.6rem` ceiling for search) so no two consecutive sections open identically.
- **Do** draw new icons on the 24 grid at 1.25 stroke with round caps, `fill: none`, and `currentColor`.
- **Do** label demonstration content as authored where a visitor could mistake it for a real customer — the amber-dotted synthetic note, the finder note, and the footer all say so.
- **Do** run state transitions at 0.4–0.6s on `cubic-bezier(0.16, 1, 0.3, 1)`.

### Don't:
- **Don't** add a second authored motion. The fixed canvas wake is the page's only animation; sections have no entrance, reveal, or parallax behaviour, and adding one would compete with the argument the canvas is making.
- **Don't** build cards or a three-column feature grid. There is no elevated surface tier and no repeating tile; the two-column grids that exist are content-specific (rail + document, tree + note).
- **Don't** fill a control with a colour. Buttons are dark surfaces with a lit rim; a coloured slab reads as a different product.
- **Don't** use `box-shadow` for elevation. Every shadow here is a glow at a state change, and a resting element never glows.
- **Don't** place text in the canvas's lit lane (right 45% at desktop, right 15% below 900px) or weaken the scrim to show more wake.
- **Don't** introduce emoji, icon fonts, glyph characters, or a third-party icon package.
- **Don't** bold a heading for emphasis; heading weight goes down as size goes up (250 display, 300 title).
- **Don't** set Korean prose in Jost, or add a third typeface.
- **Don't** remove `:focus-visible` outlines or replace the focus glow with a colour change alone.
- **Don't** ship the current demonstration data as real. Every name, date, document, and search sentence in `app/data.ts` is authored for this page.

<!--
Known gaps carried by this build, recorded rather than papered over:
- SUIT Variable and Jost are loaded via CDN @import in globals.css, not self-hosted. This is a real dependency on jsdelivr and fonts.googleapis.com, and a render-blocking one.
- Under prefers-reduced-motion the canvas is drawn statically and redrawn on scroll rather than animated; the wake still forms, but the sparks never ignite.
- The waitlist server action appends to a local waitlist.jsonl and is explicitly a placeholder for the NestJS API named in PRODUCT.md.
-->
