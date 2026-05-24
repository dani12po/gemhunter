# TASK: Improve Raydium CPMM Liquidity Pool Manager — Logic & UX Only

You are working on a Next.js 14 + TypeScript project — a Raydium CPMM Liquidity Pool Manager running on Solana Devnet. The project already has working Add Liquidity and Remove Liquidity functionality.

---

## ⚠️ CRITICAL RULE — DO NOT CHANGE EXISTING UI

**DO NOT modify, redesign, or restyle any existing UI components.**
This means:
- Do NOT change colors, fonts, spacing, or layout of existing components
- Do NOT replace existing className values
- Do NOT change Tailwind classes on existing elements
- Do NOT restructure existing JSX unless strictly required for new functionality
- Do NOT change existing button styles, card styles, or panel layouts
- Do NOT change the dark theme, amber/orange accent colors, or any visual design

**Only add NEW elements where needed (new cards, new buttons, new state).**
**All new elements must match the exact same visual style as existing components.**

When adding new UI elements, copy the exact className patterns already used in the project.
The goal is that new elements are indistinguishable in style from existing ones.

---

## STEP 0 — READ THE CODEBASE FIRST

Before writing any code:
1. Read ALL files related to:
   - Add Liquidity page/component
   - Remove Liquidity page/component
   - LP Position fetching logic
   - Pool card/list components
   - State management (context, zustand, or useState)
   - Tab/routing system between Add and Remove
   - Wallet interaction hooks
   - Token metadata fetching (symbol, name, logo)
2. Understand the current data shape of LP positions (what fields exist)
3. Understand how tab switching currently works
4. Note the exact Tailwind class patterns used for: cards, buttons, badges, panels, text
5. Do NOT start coding until you have read and understood all relevant files

---

## STEP 1 — ADD POOL NAME TO LP POSITIONS

### Problem
Currently, LP positions only show truncated mint addresses like `9hsSsZ...fVG6`.

### Solution
When fetching LP positions, resolve and attach a human-readable pool name.

**Format:**
```
SOL / TOKEN_SYMBOL
```

**Examples:**
- `SOL / PEPE`
- `SOL / BONK`
- `SOL / DOGEAI`

**Fallback** (if token has no symbol):
```
SOL / 9hsSs...fVG6
```

**Implementation requirements:**
- When LP positions are fetched, for each position:
  - Identify Token A and Token B mint addresses
  - Fetch token metadata (symbol/name) using `@solana/spl-token` or Metaplex metadata program
  - If symbol is found → use it
  - If not → use shortened address (first 6...last 4 chars)
  - Compose pool name as `TOKEN_A_SYMBOL / TOKEN_B_SYMBOL`
- Store `poolName` field alongside each LP position in state
- This `poolName` must persist and be reused everywhere: list view, detail panel, Add Liquidity prefill
- Wherever the existing code already renders the pool label/name, replace the raw address with `poolName`
- Do NOT change the surrounding UI structure, only the text content

---

## STEP 2 — ENHANCE LP POSITION LIST (KEEP EXISTING STRUCTURE)

### Rule
Keep the existing card/list structure exactly as-is. Only add missing data fields inside the existing card layout.

### Fields to add inside existing pool cards (if not already present):
- Pool name displayed as `SOL / TOKEN_SYMBOL` (primary label, replacing raw address)
- Pool type badge: `CPMM` or `AMM` — use the same badge/pill style already in the project
- Share %
- Shortened pool address — add copy-on-click if not already present
- Estimated SOL value
- Estimated token value
- Fee earned (SOL + token)

### Interaction:
- Clicking a card → updates right-side detail panel (if not already working, wire it up)
- Selected card → use the existing selected/active state style already in the project
- Hover → use existing hover style

### Empty state:
If no LP positions exist, show an empty state inside the existing panel container:
```
[ Icon ]
Belum ada posisi likuiditas.
Tambah likuiditas untuk memulai.
[ Button: Add Liquidity ]  ← same button style as existing buttons
```
Style this using the same card/panel className already used in the project.

---

## STEP 3 — ADD TWO ACTION BUTTONS IN REMOVE LIQUIDITY PANEL

In the right-side detail panel, add a second button next to the existing "Cabut Liquidity" button.

### Button 1: Cabut Liquidity (existing)
- Keep exactly as-is (style, logic, placement)
- Only add: loading/disabled state during TX if not already present

### Button 2: Tambah Liquidity (NEW)
- Place it next to "Cabut Liquidity" (side by side)
- Use the SAME button style as the existing amber/orange buttons in the project
- On click:
  1. Switch active tab to "Add Liquidity"
  2. Prefill Token A = SOL (So111...1112)
  3. Prefill Token B mint = quote token of the selected pool
  4. Trigger token metadata load for Token B
  5. User only needs to input amounts

**DO NOT reset the selected pool state when switching tabs.**

---

## STEP 4 — AUTO-PREFILL ADD LIQUIDITY FORM

When Add Liquidity tab is opened via the "Tambah Liquidity" button:

- Token A field → pre-filled with SOL (So111...1112)
- Token B field → pre-filled with the mint address from selected pool
- Immediately trigger:
  - Token B metadata fetch (symbol, name)
  - Token B balance fetch
  - Display symbol in the existing token label area
- User action required: only input amounts, then click Add Liquidity

Implement via shared state with a field like:
```typescript
prefillAddLiquidity: {
  tokenBMint: string;
  poolId: string;
  poolName: string;
} | null
```

When Add Liquidity mounts or becomes active tab:
- Check if `prefillAddLiquidity` is set
- If yes → auto-fill the form fields using existing setter functions
- After filling → clear the prefill state

---

## STEP 5 — LOADING STATES & TOASTS

### Loading States
- While fetching LP positions → show skeleton loaders using the same card structure/className as existing cards (just replace content with animated placeholder divs)
- While TX is pending → disable both action buttons and show a spinner inside them, using existing button className

### Toast Notifications
- Check if a toast library is already installed (react-hot-toast, sonner, etc.)
- If yes → use it
- If no → install `sonner` and add `<Toaster />` to the root layout
- Trigger toasts for:
  - ✅ Liquidity removed successfully
  - ✅ Liquidity added successfully
  - ❌ Error message from TX or fetch failure

---

## STEP 6 — STATE MANAGEMENT

Ensure the following state does not reset on tab switch:

```typescript
{
  lpPositions: LPPosition[];
  selectedPool: LPPosition | null;
  prefillAddLiquidity: {
    tokenBMint: string;
    poolId: string;
    poolName: string;
  } | null;
  activeTab: 'add' | 'remove';
}
```

Rules:
- `selectedPool` must NOT reset when tab changes
- `prefillAddLiquidity` is set on "Tambah Liquidity" click, cleared after Add form consumes it
- `lpPositions` refetched after successful add or remove TX
- Adapt to the existing state management pattern in the project (Context, Zustand, useState lifted to parent, etc.)

---

## STEP 7 — CODE QUALITY

- TypeScript types for all new state and props
- No `any` types unless unavoidable
- Reuse existing utility functions (address shortening, number formatting)
- Do not break existing working functionality
- Preserve existing Solana/Raydium SDK integration
- Add inline comments only where logic is non-obvious

---

## DELIVERABLES

After implementing, confirm:
1. ✅ Pool names display as `SOL / SYMBOL` everywhere (no raw addresses in labels)
2. ✅ All existing UI styles are unchanged
3. ✅ New elements match the existing visual style exactly
4. ✅ Selecting a pool card updates the right panel
5. ✅ Both "Cabut Liquidity" and "Tambah Liquidity" buttons exist side by side
6. ✅ "Tambah Liquidity" switches tab and prefills the form automatically
7. ✅ Add Liquidity auto-loads token metadata when prefilled
8. ✅ Skeleton loaders and toasts implemented
9. ✅ State does not reset on tab switch

Start by reading the codebase. After reading, briefly summarize the existing UI patterns (className conventions, state management approach, tab switching method) before writing any code. Then implement changes file by file, stating what changed and why.
