-- Jalankan sekali di Supabase SQL Editor untuk mengaktifkan foto profil UsTwo.
create table if not exists public.profiles (user_id uuid primary key references auth.users(id) on delete cascade, display_name text not null default 'Pengguna', avatar_data text, updated_at timestamptz not null default now(), constraint profiles_avatar_size check (avatar_data is null or char_length(avatar_data) <= 500000));
alter table public.profiles enable row level security;
drop policy if exists "Members can view profiles" on public.profiles;
create policy "Members can view profiles" on public.profiles for select to authenticated using (public.is_chat_member(auth.uid()));
drop policy if exists "Members can create own profile" on public.profiles;
create policy "Members can create own profile" on public.profiles for insert to authenticated with check (public.is_chat_member(auth.uid()) and user_id = auth.uid());
drop policy if exists "Members can update own profile" on public.profiles;
create policy "Members can update own profile" on public.profiles for update to authenticated using (public.is_chat_member(auth.uid()) and user_id = auth.uid()) with check (public.is_chat_member(auth.uid()) and user_id = auth.uid());
grant select, insert, update on public.profiles to authenticated;
do $$ begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; when undefined_object then raise notice 'Aktifkan Realtime untuk public.profiles secara manual.'; end $$;