-- Jalankan di Supabase SQL Editor setelah membuat project.
-- Setelah dua akun dibuat di Authentication -> Users, tambahkan tepat dua UUID
-- ke public.chat_members. Jangan memasukkan service_role key ke frontend.
create extension if not exists pgcrypto;

create table if not exists public.chat_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create or replace function public.is_chat_member(uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.chat_members m where m.user_id = uid); $$;
revoke all on function public.is_chat_member(uuid) from public;
grant execute on function public.is_chat_member(uuid) to authenticated;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('text','image','video','audio')),
  content text,
  storage_key text,
  file_name text,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_payload_check check (
    (kind = 'text' and content is not null and char_length(content) between 1 and 5000 and storage_key is null)
    or (kind in ('image','video','audio') and storage_key is not null and file_size between 1 and 5368709120)
  )
);
create index if not exists messages_created_at_idx on public.messages(created_at desc);
create index if not exists messages_sender_id_idx on public.messages(sender_id);

alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Members can read own membership" on public.chat_members;
create policy "Members can read own membership" on public.chat_members for select to authenticated using (user_id = auth.uid());

drop policy if exists "Only members can read messages" on public.messages;
create policy "Only members can read messages" on public.messages for select to authenticated using (public.is_chat_member(auth.uid()));

drop policy if exists "Members can send as themselves" on public.messages;
create policy "Members can send as themselves" on public.messages for insert to authenticated with check (public.is_chat_member(auth.uid()) and sender_id = auth.uid());

drop policy if exists "Members can mark messages read" on public.messages;
create policy "Members can mark messages read" on public.messages for update to authenticated using (public.is_chat_member(auth.uid())) with check (public.is_chat_member(auth.uid()));

grant select on public.chat_members to authenticated;
grant select, insert, update on public.messages to authenticated;

-- Aktifkan Realtime untuk tabel messages.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then raise notice 'Publication supabase_realtime tidak ditemukan; aktifkan Realtime dari dashboard.';
end $$;

-- Setelah membuat DUA akun, ganti UUID dan nama di bawah lalu jalankan sekali.
-- insert into public.chat_members(user_id, display_name) values
-- ('UUID_AKUN_FAREL', 'Farel'),
-- ('UUID_AKUN_PACAR', 'Khaira');

-- Cegah pengguna mengubah isi pesan lewat request UPDATE; hanya read_at yang boleh berubah.
create or replace function public.protect_message_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.sender_id is distinct from old.sender_id
    or new.kind is distinct from old.kind
    or new.content is distinct from old.content
    or new.storage_key is distinct from old.storage_key
    or new.file_name is distinct from old.file_name
    or new.mime_type is distinct from old.mime_type
    or new.file_size is distinct from old.file_size
    or new.created_at is distinct from old.created_at then
    raise exception 'Only read status may be updated';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'Read status cannot be reset';
  end if;
  if new.read_at is distinct from old.read_at and old.sender_id = auth.uid() then
    raise exception 'Sender cannot mark their own message as read';
  end if;
  return new;
end; $$;
drop trigger if exists protect_message_update_trigger on public.messages;
create trigger protect_message_update_trigger before update on public.messages
for each row execute function public.protect_message_update();


-- MIGRASI UsTwo Chat: balas pesan + wallpaper bersama.
alter table public.messages add column if not exists reply_to_id uuid null references public.messages(id) on delete set null;
create index if not exists messages_reply_to_id_idx on public.messages(reply_to_id);
create table if not exists public.chat_settings (id integer primary key check (id = 1), wallpaper text not null default 'pink' check (wallpaper in ('pink','sunset','lavender','sky','cream')), updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now());
insert into public.chat_settings(id,wallpaper) values (1,'pink') on conflict (id) do nothing;
alter table public.chat_settings enable row level security;
drop policy if exists "Members can read shared chat settings" on public.chat_settings;
create policy "Members can read shared chat settings" on public.chat_settings for select to authenticated using (public.is_chat_member(auth.uid()));
drop policy if exists "Members can update shared chat settings" on public.chat_settings;
create policy "Members can update shared chat settings" on public.chat_settings for update to authenticated using (public.is_chat_member(auth.uid())) with check (public.is_chat_member(auth.uid()));
grant select, update on public.chat_settings to authenticated;
do $$ begin alter publication supabase_realtime add table public.chat_settings; exception when duplicate_object then null; when undefined_object then raise notice 'Aktifkan Realtime untuk chat_settings dari dashboard.'; end $$;
