-- STEP 20: Allow users to delete their own draft activities
-- Run in Supabase SQL Editor as project owner/postgres.
-- Safe to re-run.

begin;

drop policy if exists "Users can delete own draft activities" on public.activities;
create policy "Users can delete own draft activities"
on public.activities
for delete
to authenticated
using (
  created_by = auth.uid()
  and status = 'draft'
);

commit;

