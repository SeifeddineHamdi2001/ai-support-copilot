---
name: support-console-ui
description: Visual direction, screen layouts, and component rules for this repo's Next.js support-agent console, so it looks like a real product (Linear/Zendesk/Front) instead of an AI-generated template. Use for any frontend work, together with the frontend-design skill.
---

# Support console UI

Read `frontend-design` first for the general process, then apply these project decisions. The user of this
app is a support agent working through a queue all day: optimise for scanning, density, and speed.

## Direction
"Quiet operations console." Neutral, high-density, keyboard-friendly, calm. The AI is a tool inside the
workflow, not the hero. Reference points: Linear issue list, Front inbox, Zendesk agent workspace.

## Hard bans (these make a UI read as AI-generated)
- Purple/blue/pink gradients, glassmorphism, glowing borders, big drop shadows, blobs.
- Sparkle ✨ icons, "AI-powered" badges, emoji in UI text, rocket/magic metaphors.
- Hero sections, oversized headings, centered marketing layouts, landing-page cards with icons.
- Untouched shadcn defaults (default radius, default slate theme, default fonts) shipped as-is.
- Every card with the same rounded-2xl + shadow; rainbow badge colors; lorem ipsum; generic empty states
  like "Nothing here yet 🚀".
- Copy like "Unlock", "Supercharge", "Seamless", "Effortless".

## Design tokens (define once in `globals.css` as CSS variables, map in Tailwind theme)
- Font: Geist Sans for UI, Geist Mono for IDs/numbers/timestamps (`next/font`). Body 13–14px, line-height 1.45.
  Headings max 18px in app pages. Tabular numbers for counts and times.
- Neutral scale: warm-gray or zinc, background `#FAFAF9`-ish, surfaces white, borders 1px low-contrast.
  Dark mode optional; if added, design it, don't just invert.
- One accent (e.g. deep teal or ink blue) used for primary actions, focus rings, selected rows only.
- Semantic colors used only for meaning:
  - Priority: URGENT red, HIGH orange, MEDIUM amber-muted, LOW gray — shown as a small dot/bar + text,
    not big filled pills.
  - Status: OPEN neutral, IN_PROGRESS accent, WAITING muted yellow, ESCALATED red outline, RESOLVED green,
    CLOSED gray.
- Radius 6px (inputs, buttons), 8px panels. Shadows: none on panels; subtle only on popovers/menus.
- Spacing on a 4px grid; table rows 36–40px tall.

## App shell
- Left sidebar (220px, collapsible): product name as plain text wordmark ("Relay" or "Copilot Desk"),
  nav: Inbox (tickets), Knowledge base, Customers. Bottom: agent switcher (seeded agents, avatar initials).
- Top bar per page: page title, count, filters, primary action ("New ticket").
- No footer.

## Screens
1. **Ticket list**: a real table, not cards. Columns: #number (mono), subject (+ customer name below in muted
   text), intent, priority (dot + label), status, assignee (initials), updated (relative, mono). Filter bar:
   status tabs (Open / In progress / Waiting / Escalated / Resolved / All) + selects for priority, intent,
   assignee + search box. Row click opens detail. Pagination at bottom. Skeleton rows while loading.
2. **Ticket detail**: two columns.
   - Left (main): subject, customer message(s) thread, then the **draft reply panel**: "Generate draft"
     button → answer text with inline `[S1]` markers rendered as small superscript chips; below it a
     "Sources" list (document title, heading path, quoted excerpt, similarity score in mono). Clicking a
     chip highlights its source. Actions: Approve & add reply / Edit / Reject. If `answerable=false`: a
     neutral bordered notice "No grounded answer in the knowledge base — reply manually" with the missing
     information list.
   - Right (sidebar, 320px): properties panel (status select, priority select with "set by AI · 0.82" /
     "set manually" source label, assignee select, customer + tier, SLA due), **AI triage card** (intent,
     priority, confidence as a thin bar + number, one-line reasoning, outcome tag if FALLBACK/FAILED with a
     "Retry" button), **escalation card** (only when recommended: level, triggered rules as plain list with
     reasons, Accept / Dismiss), then the **activity timeline** (compact, mono timestamps, actor + action).
3. **New ticket**: drawer or dialog with customer select, subject, body, channel. On submit, toast and go
   to detail where classification appears.
4. **Knowledge base**: table of documents (title, category, chunks, status, updated) + "Add document"
   (title, category, Markdown textarea) + a **search tester** panel: query input → ranked chunks with
   similarity and RRF scores. This doubles as a demo of retrieval.

## States and feedback
- Loading: skeletons matching final layout, never full-page spinners.
- Errors: inline messages using Problem Details `title` + `detail`. 409 version conflict: "This ticket was
  updated by someone else" + "Reload" button. 503 AI: "AI service unavailable. The ticket is unchanged." +
  Retry.
- Empty states: one plain sentence + the relevant action. ("No escalated tickets.")
- Toasts (sonner) only for completed actions, bottom-right, short.
- AI text is rendered as plain text (no `dangerouslySetInnerHTML`, no Markdown HTML).

## Copy tone
Short, specific, operational. "Generate draft", "Approve and add reply", "Escalate to Tier 2",
"Confidence 0.82". Label AI output honestly but quietly: a small muted "AI suggestion" caption.

## Accessibility
Visible focus rings (accent), labels on every input, color never the only signal (text labels with dots),
keyboard: `/` focuses search, `j/k` move rows (nice-to-have), Esc closes dialogs. Contrast AA.

## Self-review loop (do this after every UI phase)
Run the app, take Playwright screenshots of: ticket list, ticket detail with draft + sources, escalation
card, KB page, at 1440px and 1024px width. Save to `docs/screenshots/`. Look at them and fix: alignment,
inconsistent spacing, anything on the ban list, anything that looks like a default template. Use the best
screenshot in the README.
