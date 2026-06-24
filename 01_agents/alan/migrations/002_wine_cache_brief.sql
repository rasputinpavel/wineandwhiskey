-- For installs that applied 001 before the brief column existed.
alter table public.alan_wine_cache add column if not exists brief text not null default '';
