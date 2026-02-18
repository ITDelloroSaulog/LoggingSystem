# SQL Import Scripts

This folder now keeps only active/import-ready scripts.

## Recommended Run Order

1. `16_create_norm_key_function.sql`
2. `07_list_lawyers_rpc.sql`
3. `10_sync_litigation_tracker_rows.sql`
4. `11_sync_retainer_backlog_rows.sql`
5. `12_sync_special_project_rows.sql`
6. `15_sync_retainer_monthly_ope_csv.sql`
7. `13_seed_accounts_from_sources.sql`
8. `14_seed_placeholder_performers_and_backfill.sql`
9. `18_realign_import_accounts_by_category.sql` (only if imports were attached to wrong-category accounts)
10. `17_verify_congruence_after_sync.sql`
11. `19_fix_receipts_storage_rls.sql` (required if receipt uploads fail with storage RLS error)
12. `20_fix_activities_draft_delete_rls.sql` (required if draft delete shows success but rows remain)
13. `21_fix_activities_update_rls_for_tracker.sql` (required if tracker Save fails with created_by/auth.uid update errors)
14. `22_fix_activities_delete_rls_for_tracker.sql` (required if tracker row Delete fails due to RLS)

## Notes

- All scripts above are written to be safe to re-run.
- Run `17_verify_congruence_after_sync.sql` last to confirm counts, duplicates, and key FK coverage.

## Removed Legacy/Test Scripts

- `08_seed_test_litigation_data.sql` (test-only seed data)
- `09_migrate_litigation_first5_activities.sql` (prototype first-5-row migration)
