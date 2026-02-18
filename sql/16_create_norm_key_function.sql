-- STEP 16: Create normalization helper used by sync scripts
-- Safe to re-run.

create or replace function public.norm_key(v text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(v, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

comment on function public.norm_key(text)
is 'Normalizes strings for resilient matching (case-insensitive, punctuation/whitespace-insensitive).';
