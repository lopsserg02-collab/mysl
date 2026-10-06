# free_pen components

Reads `recon.md` (Components table, screens S01-S19) and `tokens.json`. Every token below is a role
name from `tokens.json` / `tokens.css` (Tailwind: `bg-surface`, `text-text-muted`, `rounded-md`...).
Never use raw hex in a component.

Ground rules for all components:

- Icons: Lucide (ISC), stroke 1.75, sizes 16 / 20 / 24. No traced or look-alike icons from the original.
- Font: Inter for UI. All labels in this file are our own placeholder copy; replica-brand sets the voice.
- Focus: every interactive element shows `:focus-visible` as a 2px `focus` ring, 2px offset
  (on canvas overlays: offset 0, ring drawn outside the shape). Never remove the outline without a replacement.
- Disabled: `text-disabled` text/icon, no hover, `aria-disabled="true"` when the control must stay
  focusable to explain why (role-limited tools), real `disabled` otherwise.
- Motion: `motion.fast` for hover/press, `motion.base` for panels and popovers; all zeroed under
  `prefers-reduced-motion`.
- Hit targets: 40px minimum on pointer, 44px on touch (`size.handle-hit`, `size.anchor-hit` extend
  small visual handles).
- Base primitives: Radix UI (MIT) for dialog, popover, dropdown, tooltip, select, toast, toggle group.

Screen IDs: S01 dashboard, S02 template picker, S03 board canvas, S04 context toolbar, S05 shape
library, S06 upload, S07 frames panel, S08 share, S09 comments, S10 voting, S11 timer, S12 private
mode, S13 presentation, S14 export, S15 version history, S16 card/table detail, S17 board search,
S18 preferences, S19 sign in.

---

## 1. Foundations (primitives)

### Button
```
variants  primary, secondary, ghost, danger, link
sizes     sm 32px (px 12, font sm/500), md 40px (px 16, font sm/600), lg 48px (px 20, font base/600); icon-only = square
states    default, hover (accent-hover / surface-hover), active (surface-active, 1px press), focus-visible (2px ring focus),
          disabled, loading (spinner replaces leading icon, width locked, label kept)
tokens    primary: bg accent, text on-accent, hover accent-hover
          secondary: bg bg, text text, 1px border, hover surface-hover
          ghost: transparent, text text, hover surface-hover
          danger: bg danger, text on-danger
          radius sm (sm, md) / md (lg); font sans; motion fast
a11y      real <button type="button">; icon-only needs aria-label + tooltip; loading sets aria-busy="true"
          and keeps the accessible name; Enter and Space activate; destructive actions confirm in a modal
used on   S01 S02 S03 S06 S07 S08 S09 S10 S11 S12 S13 S14 S15 S16 S19
```

### Input (text, email, search, password, textarea)
```
variants  text, search (leading search icon + clear button), password (show/hide toggle), textarea (auto-grow, max 8 rows),
          inline (borderless, used for renames on canvas and frame headers)
sizes     sm 32px, md 40px; textarea min 80px
states    empty (placeholder text-muted), filled, hover (border-input darkens to text-muted), focus-visible
          (border focus + 2px ring), disabled (surface bg, text-disabled), read-only, error (border danger,
          message below in danger with alert-circle icon), loading (search: spinner in trailing slot)
tokens    bg bg, border border-input, text text, placeholder text-muted, radius sm, font sm, error danger
a11y      always a visible <label> (or aria-label for search in toolbars); error text linked with aria-describedby
          and aria-invalid="true"; Esc clears search, second Esc blurs; character count announced politely
          at 90% of limit (board name 60, description 300, tag 120)
used on   S01 S02 S08 S09 S10 S11 S14 S16 S17 S19
```

### Menu / dropdown
```
variants  action menu (kebab / "more"), select menu (single choice, check mark), submenu, context menu (right-click on canvas)
sizes     item 32px (dense, canvas) / 36px (dashboard); min width 200px, max 320px
states    closed, open, item hover/highlight (surface-hover), item active, item focus-visible (same as highlight +
          ring in high-contrast mode), item disabled, item destructive (text danger), empty ("Nothing here yet"), loading (skeleton rows)
tokens    bg bg, border border, shadow pop, radius md, item radius sm, text text, shortcut hint text-muted (font xs, mono digits),
          z popover
a11y      Radix DropdownMenu: role="menu", arrow keys move, Home/End, type-ahead, Enter/Space select, Esc closes and
          returns focus to the trigger, Right/Left open/close submenus; context menu also opens with Shift+F10 / Menu key
          on the focused canvas item
used on   S01 S03 S04 S07 S08 S09 S14 S15 S16
```

### Tooltip
```
variants  label, label + shortcut ("Sticky note  N"), rich (two lines, used for disabled-by-role explanations)
sizes     font xs, padding 4px 8px, max width 240px
states    hidden, shown after 400ms hover / immediately on keyboard focus, skip delay 300ms between neighbours
tokens    bg tooltip-bg, text tooltip-text, shortcut tooltip-text in font mono (same colour, no opacity tricks), radius xs, z tooltip
a11y      Radix Tooltip; content is aria-describedby, never the only accessible name; Esc hides; not shown on touch
          (long-press shows it instead); never contains interactive content
used on   S03 S04 S07 S10 S11 S13 and every icon-only button
```

### Modal (dialog)
```
variants  sm 400px (confirm), md 560px (share, export), lg 880px (template picker, version history preview); full-screen sheet under md breakpoint
states    closed, opening (fade + 4px rise, motion base), open, loading (skeleton body, footer buttons disabled),
          error (inline banner danger-subtle / danger at top of body), empty (illustration slot + own copy + one action)
tokens    bg bg, scrim color-scrim, shadow pop, radius lg, padding 24, header font lg, z modal
a11y      Radix Dialog: role="dialog", aria-modal, labelled by its title; focus moves to first field (or the
          close button for read-only dialogs); Tab is trapped; Esc and the X button close; focus returns to the trigger;
          background content inert; destructive confirms put focus on Cancel
used on   S02 S08 S13 (join prompt) S14 S15 S19 (verify email)
```

### Side panel
```
variants  right docked 360px (frames, comments, voting, version list, card detail), left docked 360px (search results)
states    closed, open (slide 16px + fade, motion base), loading (skeleton list), empty (own copy + action),
          error (retry row), resizing (drag handle 4px, min 280 max 480), collapsed on small screens to a bottom sheet
tokens    bg bg, border-left border, shadow pop, header 48px font sm/600, list item 40px, z panel
a11y      <aside role="complementary" aria-label="…">, not modal: focus moves in on open, Esc closes and returns
          focus to the opener; F6 cycles focus between canvas, toolbars and open panel; resize handle is a
          role="separator" with arrow-key resizing
used on   S07 S09 S10 S15 S16 S17
```

### Switch / checkbox
```
variants  switch (on/off settings), checkbox (lists, filters), radio group (input mode S18, export format S14)
sizes     switch 32x18, checkbox 16 with 40px row
states    off, on (accent), hover, focus-visible, disabled, mixed (checkbox)
tokens    track off border-input, on accent, knob bg, label text, help text-muted
a11y      native input or Radix Switch with role="switch" aria-checked; label clickable; Space toggles
used on   S08 S10 S12 S14 S18
```

### Toast
```
variants  info, success, error, with-action ("Undo", "Retry"), progress (upload, export)
sizes     width 360px max, min height 48px
states    entering (slide up 8px, motion base), visible (info/success 5s, error stays until dismissed, pauses on hover/focus),
          exiting, stacked (max 3, older collapse)
tokens    bg chip-bg, text chip-text, icon from the opposite theme so it reads on chip-bg (light theme: dark-success / dark-danger / dark-accent;
          dark theme: success / danger / accent), all in pairs,
          radius md, shadow pop, z toast; position bottom-centre above the bottom toolbar, 12px gap
a11y      Radix Toast; region role="region" aria-label="Notifications"; info/success aria-live="polite",
          error role="alert"; F8 jumps to the toast region; action reachable by keyboard; never the only place
          an error is shown for a form
used on   all screens
```

### Number stepper
```
variants  integer (votes per person 1-99, font size), duration (mm:ss with minute/second segments), percent (opacity 0-100)
sizes     sm 32px (context toolbar), md 40px (panels)
states    default, hover on +/- buttons, focus-visible on field, at min (minus disabled), at max (plus disabled),
          disabled, error (out of range typed: border danger, message "Use a number from 1 to 99"), empty (reverts to last value on blur)
tokens    field as Input, buttons ghost icon (minus, plus), radius sm, digits font-variant-numeric tabular-nums
a11y      role="spinbutton" with aria-valuemin/max/now and aria-valuetext ("5 minutes"); Up/Down step 1,
          Shift+Up/Down step 10, PageUp/PageDown step 10, Home/End to min/max; +/- buttons are tabindex -1 duplicates
used on   S04 S10 S11
```

---

## 2. Canvas chrome

### Toolbar button
```
variants  icon (creation toolbar, nav), icon + label (top bar: present, share), split (icon + chevron that opens a tool flyout,
          e.g. shapes, pen), toggle (grid, minimap)
sizes     40x40 with 20px icon (default), 32x32 with 16px icon (context toolbar, dense nav); touch 44x44
states    idle (text-muted icon), hover (surface-hover, icon text), pressed/active tool (accent-subtle bg, accent icon,
          aria-pressed="true"), pinned (sticky tool stays active: small accent dot under icon), focus-visible,
          disabled by role (viewer/commenter: icon text-disabled, tooltip explains "You can view this board. Ask the owner to edit."),
          loading (upload tool: spinner over icon)
tokens    bg transparent / surface-hover / accent-subtle, icon text-muted / text / accent, radius sm, motion fast
a11y      <button aria-pressed> inside role="toolbar" (aria-orientation vertical for the left rail); roving tabindex:
          one Tab stop per toolbar, arrows move between buttons; single-key shortcuts (V select, H hand, N note, T text,
          S shape, L line, P pen, E eraser, C comment, F frame) shown in tooltips and only fire when focus is on
          the canvas, never inside a text field; flyouts open with Enter/Down
used on   S03 S04 S13
```

### Creation toolbar / top bar / navigation cluster (layout containers)
```
variants  left rail (creation tools, vertical), top-left board bar (board name, menu), top-right people bar (avatars,
          present, share), bottom-right navigation (zoom, fit, minimap toggle, frames)
states    default, collapsed (rail shows 5 core tools + "more"), read-only (rail hidden, only select/hand/comment),
          presenting (all chrome hidden except presenter controls), offline (bar shows "Offline: changes will sync" in warning)
tokens    bg bg, shadow toolbar, radius md, inset layout.floating-inset, gap 4, z toolbar
a11y      each is a landmark (role="toolbar" with aria-label); F6 cycles canvas -> board bar -> rail -> people bar -> nav
used on   S03 S13
```

### Context toolbar
```
variants  per item type: sticky (colour, font size, align, tags, lock, more), text (font, size, B/I/U/S, align, colour, link),
          shape (shape type, fill, border, text style), connector (route straight/elbow/curved, caps, stroke, colour),
          drawing (stroke colour, width), frame (title, fill, hide content), image (crop, replace, alt text), multi (common props + group,
          align/distribute), locked (unlock only)
sizes     height 40px, button 32px, separators 1px border, max width viewport minus 24px (overflow into a "more" menu)
states    hidden, shown (fade 120ms, positioned 12px above selection, flips below near top edge), single, multi,
          locked (only unlock + copy link), mixed values (control shows "Mixed"), read-only (hidden), dragging (hidden while moving)
tokens    bg bg, shadow toolbar, radius md, button tokens as Toolbar button, z toolbar
a11y      role="toolbar" aria-label="Edit selection"; Ctrl/Cmd+Alt+. (or Alt+F10) moves focus from canvas into it;
          Esc returns focus to the selected item; arrows move between controls; announces "3 items selected" when shown
used on   S04 (over S03)
```

### Selection box + handles
```
variants  single (8 handles + rotate), multi (one box around all, dashed 1px for group-less multi), group (solid), lasso (free path
          while dragging, then box), connector (two end handles + midpoint caption handle), text (side handles only: width)
sizes     stroke size.selection-stroke 1.5px (screen-space, constant at any zoom), handle 8x8 visual / 24x24 hit, rotate handle
          24px above top edge
states    hover preview (1px selection outline on hovered item), selected, resizing (live size badge W x H in chip),
          rotating (angle badge, snaps to 15deg with Shift), moving (guides in guide colour, distance badges), locked
          (outline only, lock icon at top-right, no handles), remote selection (other user's colour outline + name tag, no handles)
tokens    stroke selection, handle fill selection-handle, handle stroke selection, area fill selection-fill, lasso fill
          lasso-fill, guides guide, badges chip-bg / chip-text font xs
a11y      canvas items are reachable with Tab (in reading order: frames, then items top-left to bottom-right) via an
          offscreen focus proxy list; Arrow nudges 1px, Shift+Arrow 10px; Alt+Arrow resize from bottom-right;
          Ctrl/Cmd+A select all; Esc clears; selection changes announced in a polite live region ("Sticky note, lemon, 'Ideas'")
used on   S03 S04
```

### Connector anchors
```
variants  4 side anchors (top, right, bottom, left) on shapes, stickies, cards, frames; free point on edge while dragging
sizes     10px visual circle, 24px hit; shown 8px outside the item edge
states    hidden, shown on hover of a connectable item while line tool active or item selected, anchor hover (anchor-hover halo),
          snapping (target item outlined in selection, anchor filled), dragging (ghost connector follows pointer),
          snap off (Ctrl/Cmd held: no outline, free placement), invalid (can't connect to locked item: not-allowed cursor)
tokens    fill selection-handle, stroke selection, halo anchor-hover, motion fast
a11y      keyboard path: select item, press L to start a connector from the nearest side, arrows choose the target item
          (cycles neighbours by direction), Enter confirms, Esc cancels; result announced ("Connected Idea to Goal")
used on   S03
```

### Colour palette
```
variants  sticky (12 swatches, sticky-*-fill), tag (12 swatches, tag-*-bg), stroke/fill (12 swatches + transparent +
          custom hex), opacity slider (0-100, stepper)
sizes     swatch 24px in a 6-column grid, 4px gap; touch 32px
states    default, hover (1px border ring), selected (2px focus-colour ring + check icon in the swatch's text colour),
          focus-visible, mixed (multi-selection with different colours: no swatch selected, label "Mixed"), disabled
tokens    swatch fills from sticky/tag palettes, ring focus, check icon sticky-*-text / tag-*-text, popover as Menu
a11y      role="radiogroup" aria-label="Note colour"; each swatch role="radio" with its own name ("Lemon", "Sky");
          arrows move in the grid, Space/Enter picks; colour is never the only signal: name shown in tooltip and in
          the selection announcement
used on   S04 S16
```

### Sticky note (canvas item)
```
variants  square, wide (2:1); 12 colours from sticky palette
sizes     default 200x200 board units; text auto-fits 12-48px (binary search), min 12px then scroll hint
states    default, hover (sticky-shadow deepens), selected (Selection box), editing (contenteditable overlay, caret),
          empty (placeholder "Type something" in sticky-*-text italic, not stored, gone on first keystroke), locked, private-mode hidden
          (others see a blank card with the author's cursor colour corner), voted (vote count badge chip-bg / chip-text)
tokens    fill sticky-*-fill, text sticky-*-text, shadow sticky, radius xs, font sans; tags render as Tag pills inside bottom edge
a11y      focus proxy has role="group" aria-roledescription="sticky note" and aria-label with colour + first 80 chars;
          Enter starts editing, Esc leaves edit and keeps selection; Tab inside editing exits (does not insert tab)
used on   S03 S10 S12
```

### Avatar / presence chip
```
variants  self (ring in own cursor colour + "You" in tooltip), other (initials or photo, ring cursor-*-fill),
          overflow ("+5" opens a people list menu), anonymous (private mode: generic person icon + colour)
sizes     24px (people bar, comments), 32px (share member list, card assignee)
states    online, idle (50% opacity after 5 min inactive), following (2px ring + "Following Ana" banner at top in
          cursor colour, "Stop" button), bringing others (own chip pulses once), offline/left (removed after 10s fade)
tokens    ring cursor-*-fill, initials cursor-*-label on cursor-*-fill, overflow bg surface-hover text text, radius pill
a11y      button with aria-label "Ana, editing. Follow" / "You. Bring everyone here"; follow state announced; the
          people list menu is a role="menu" with follow / bring-to-me actions; Esc or any manual pan stops following
used on   S01 (board card owners) S03 S08 S09 S13 S16
```

### Live cursor
```
variants  named arrow (pointer icon tinted cursor-*-fill + name label), drawing (pen dot), selecting (arrow + small box),
          anonymised (private mode or anonymous viewer: label "Guest" / hidden name)
sizes     arrow 16px, label font xs/500, padding 2px 6px, radius pill; constant screen size at any zoom
states    moving (interpolated with motion.cursor-lerp), idle (label fades after 3s, arrow stays), chatting (label shows
          short message, could), out of view (edge indicator: small chevron at viewport edge in user's colour), hidden (user toggled
          "hide others' cursors")
tokens    fill cursor-c1..c8-fill, label text cursor-*-label, assigned in join order and stable per session
a11y      aria-hidden="true" (decorative, high frequency); presence is conveyed by the avatar list instead;
          respect prefers-reduced-motion (no interpolation, jump updates at 10/s)
used on   S03 S12 S13
```

### Frame header
```
variants  default (title above frame top-left), hidden-content frame (title + eye-off icon), presentation index ("3 · Title")
sizes     font xs/500 at screen size (does not scale below 50% zoom; hides under 10%)
states    default (frame-title), hover (text, frame outline), selected (selection), renaming (Input inline, Enter saves,
          Esc cancels), empty title (shows "Untitled frame" in text-muted italic), hidden content (frame fill
          frame-fill, items not rendered for non-editors)
tokens    text frame-title on canvas-bg, fill frame-fill, outline border, font sans
a11y      frames are the first Tab stops on the canvas (role="region" aria-label = title); F2 or double-click
          renames; frame list in S07 mirrors order
used on   S03 S07 S13
```

### Comment pin
```
variants  board pin (free position), item pin (attached to an item corner), cluster (count when pins overlap at low zoom)
sizes     32px teardrop, avatar 24 inside; cluster 32px circle with number
states    default (author avatar), unread (small danger dot top-right), open (thread popover 320px wide next to pin,
          pin outlined in focus), resolved (hidden unless "Show resolved", then 50% opacity + check), draft (new pin while
          typing, dashed outline), error (post failed: danger border + retry in thread)
tokens    bg bg, border border, shadow card, unread danger, cluster chip-bg / chip-text, popover as Side panel card
a11y      each pin is a button "Comment by Ana, 2 replies, unread"; C enters comment mode, Enter on canvas point places a pin
          at the focused item; thread popover is a non-modal dialog, Esc closes; @mention list is a combobox with
          arrow/Enter; Ctrl/Cmd+Enter posts
used on   S03 S09
```

### Countdown chip
```
variants  timer, vote
sizes     height 32px, digits font sm/600 tabular-nums; minimised (24px dot + digits only)
states    idle (not shown), running (chip-bg, play state icon), paused (warning-subtle bg, warning text, pause icon),
          last 10s (danger-subtle bg, danger text, no flashing), ended ("Time's up" / "Vote closed", success icon, stays 10s), minimised
          (click to expand), controls (facilitator only: pause/resume, +1 min, +5 min, stop)
tokens    bg chip-bg, text chip-text, paused warning / warning-subtle, ending danger / danger-subtle, radius pill, z toolbar
a11y      role="timer" with aria-live="off" while running; polite announcements at start, 1 min left, 10s left, end;
          controls are labelled buttons; optional sound off by default and never the only end signal
used on   S03 S10 S11
```

### Tag pill
```
variants  12 colours from tag palette; on canvas (inside sticky/card), in pickers (with remove x), in filters (toggle)
sizes     height 20px, font xs/500, padding 0 8px, max width 160px with ellipsis
states    default, hover (in pickers), selected (filter: check icon), focus-visible, removable, creating (Input inline, Enter adds),
          limit reached (8 per item: "add" disabled with tooltip), empty (picker: "No tags yet. Type to create one.")
tokens    bg tag-*-bg, text tag-*-text, radius pill
a11y      in pickers: listbox with multi-select; remove button "Remove tag Research"; Backspace on empty input
          removes last tag; colour name is spoken with the label
used on   S04 S16 S03 (filter in voting S10)
```

### Role select
```
variants  invite field (inline with email), member row (per member), link access (who has the link: no access / view /
          comment / edit)
sizes     sm 32px in rows, md 40px in invite field
states    default, open, option selected (check), option disabled (higher than your own role, tooltip explains),
          owner row (static text, not a control), changing (spinner, optimistic), error (reverted value + toast)
tokens    as Menu (select menu), trigger as Button ghost with chevron-down, help text text-muted under each option
a11y      Radix Select: role="combobox" + listbox; label "Role for ana@example.com"; arrows/Home/End/type-ahead; option
          descriptions linked by aria-describedby; removing a member lives in the same menu, separated, text danger
used on   S08
```

### Board card
```
variants  grid card (thumbnail 16:10, name, edited time, owner avatar), list row (48px: icon, name, owner, edited, star, menu)
sizes     grid min 240px, auto-fill columns, gap 16; list full width
states    default, hover (shadow card -> pop, menu button visible), focus-visible (ring around the whole card),
          starred (filled star in accent), menu open, loading (skeleton thumbnail + 2 text lines), no thumbnail (pattern
          of canvas-grid dots on canvas-bg), renaming (inline Input), in trash (muted, restore action), view-only badge
tokens    bg bg, border border, radius md, shadow card, name font sm/600 text, meta font xs text-muted
a11y      the card is one link (Enter opens the board) with the star and menu as separate buttons after it in Tab order
          (not nested inside the link); aria-label includes name + "edited 2 hours ago"; grid uses role="list"
used on   S01 S02 (template card variant) S15 (version row variant)
```

### Zoom control and minimap
```
variants  zoom stepper (minus, percent menu, plus), fit buttons in percent menu, minimap (160x120)
states    default, at min/max zoom (button disabled), minimap open/closed, viewport rectangle dragging
tokens    as Toolbar button; minimap bg canvas-bg, border border, viewport stroke selection
a11y      Ctrl/Cmd +/- and 0 zoom, Shift+1 fit all, Shift+2 fit selection; percent button opens menu of zoom.steps;
          minimap is aria-hidden with the same actions available in the menu
used on   S03 S13
```

### Empty, loading and offline states (patterns)
```
empty     own illustration slot (we commission; none taken from the original), one sentence, one primary action.
          Dashboard: "No boards yet" + New board. Canvas: faint hint "Press N to add a note" centred on canvas-bg, disappears on first item.
          Search: "No matches for 'x'". Frames panel: "Add a frame with F to build slides".
loading   skeletons in surface / surface-hover with 1.2s shimmer (none with reduced motion); canvas shows the grid
          immediately, items fade in; never a full-page spinner after first paint
offline   warning-subtle banner under the board bar, editing continues locally, banner turns success "Synced" for 3s on reconnect
error     inline next to the cause first; toast only for background failures; every error offers a next step
```
