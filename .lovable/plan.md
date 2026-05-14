The user wants to be able to select multiple files at once when reimporting the base, as currently the system only allows one file at a time. 

I will modify the components and pages that handle reimporting to support multiple file selection and process them together.

### Technical details:
- **`src/pages/CompanyAnalysis.tsx`**:
    - Update the file input to include the `multiple` attribute.
    - Update `setReimportConfirm` to handle an array of files or just process multiple files in `doReimport`. Actually, the current state `reimportConfirm` holds a single `File`. I'll change it to `File[]`.
    - Modify `doReimport` to accept `File[]` and iterate through them, parsing each and combining the results before saving to Supabase.
- **`src/pages/PaymentDetail.tsx`**:
    - Similar changes to `CompanyAnalysis.tsx` for the batch-level reimport button.
- **Data Consistency**:
    - Ensure that when multiple files are selected, the existing items and groups for that batch are cleared, and then all items from all selected files are inserted.
    - The `source_file_path` in the `payments` table will store the path of the first file (or I could store multiple, but for now, following the pattern of the creation flow where multiple files are supported but usually it's one batch). Wait, the creation flow `NewPayment.tsx` also supports multiple files.

### Steps:

1. **Modify `src/pages/CompanyAnalysis.tsx`**:
    - Update `reimportConfirm` state to `File[] | null`.
    - Add `multiple` to the hidden file input.
    - Update `doReimport` to loop through files, parse them using `parsePaymentFile`, and flatten all rows into a single list for insertion.
    - Update the confirmation dialog to show how many files were selected.

2. **Modify `src/pages/PaymentDetail.tsx`**:
    - Update `reimportConfirm` state to `File[] | null`.
    - Add `multiple` to the hidden file input.
    - Update `doReimport` (Wait, I need to check if `doReimport` exists in `PaymentDetail.tsx` as well. Yes, it should have similar logic).

3. **Verification**:
    - Ensure that selecting multiple files correctly combines the items and triggers the AI analysis for all of them.
