## Goals
Implement Gap 2 (dual notification for director questions) and Gap 3 (visual indicator for open questions).

## Implementation Plan

### 1. Edge Function (Gap 2)
Update `supabase/functions/notify-internal-question/index.ts`:
- Modify the email message for "created" events to clearly state that the batch continues in the same status and that either the analyst or validator can respond.
- Ensure the routing for `diretor` already includes both `analista` and `validador` (it seems it does, but I'll double check the role labels).

### 2. Payments Page (Gap 3)
Update `src/pages/Payments.tsx`:
- Enhance the visual indicator for open questions.
- Replace the current blue `MessageCircleQuestion` badge with a more visible amber/yellow badge with a "⚠ Questionamento" label as requested.
- Update both the compact (kanban) and standard (list) views.

### 3. Dashboard Page (Gap 3)
Update `src/pages/Dashboard.tsx`:
- Implement fetching of open question counts per payment (similar to `Payments.tsx`).
- Add the same amber/yellow "⚠ Questionamento" badge to the payment rows in the pipeline/task lists.
- Ensure the badge is visible to all profiles.

### 4. Verification
- Verify that the notification logic works by reading the code.
- Verify that the visual indicators appear correctly in the preview.

## Technical Details
- **Open Question Definition**: `is_question = true AND resolved_at IS NULL` in `payment_observations`.
- **Badge Styling**: Use amber/yellow colors (e.g., `bg-amber-100 text-amber-800 border-amber-200` or similar using existing theme variables).
- **Notification Routing**: Asker `diretor` -> Recipients `['analista', 'validador']`.
