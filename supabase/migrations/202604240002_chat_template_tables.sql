create extension if not exists pgcrypto;

create table if not exists public."Chat" (
  "id" uuid primary key default gen_random_uuid(),
  "createdAt" timestamptz not null default now(),
  "title" text not null,
  "userId" uuid not null references auth.users(id) on delete cascade,
  "visibility" text not null default 'private'
);

create table if not exists public."Message_v2" (
  "id" uuid primary key default gen_random_uuid(),
  "chatId" uuid not null references public."Chat"("id") on delete cascade,
  "role" varchar not null,
  "parts" jsonb not null,
  "attachments" jsonb not null default '[]'::jsonb,
  "createdAt" timestamptz not null default now()
);

create table if not exists public."Vote_v2" (
  "chatId" uuid not null references public."Chat"("id") on delete cascade,
  "messageId" uuid not null references public."Message_v2"("id") on delete cascade,
  "isUpvoted" boolean not null,
  primary key ("chatId", "messageId")
);

create table if not exists public."Document" (
  "id" uuid not null default gen_random_uuid(),
  "createdAt" timestamptz not null default now(),
  "title" text not null,
  "content" text,
  "text" varchar not null default 'text',
  "userId" uuid not null references auth.users(id) on delete cascade,
  primary key ("id", "createdAt")
);

create table if not exists public."Suggestion" (
  "id" uuid primary key default gen_random_uuid(),
  "documentId" uuid not null,
  "documentCreatedAt" timestamptz not null,
  "originalText" text not null,
  "suggestedText" text not null,
  "description" text,
  "isResolved" boolean not null default false,
  "userId" uuid not null references auth.users(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  constraint "Suggestion_document_fk"
    foreign key ("documentId", "documentCreatedAt")
    references public."Document"("id", "createdAt")
    on delete cascade
);

create table if not exists public."Stream" (
  "id" uuid primary key default gen_random_uuid(),
  "chatId" uuid not null references public."Chat"("id") on delete cascade,
  "createdAt" timestamptz not null default now()
);

create index if not exists "Chat_userId_createdAt_idx"
  on public."Chat" ("userId", "createdAt" desc);

create index if not exists "Message_v2_chatId_createdAt_idx"
  on public."Message_v2" ("chatId", "createdAt" asc);

create index if not exists "Document_userId_id_createdAt_idx"
  on public."Document" ("userId", "id", "createdAt" desc);

create index if not exists "Suggestion_documentId_idx"
  on public."Suggestion" ("documentId");

create index if not exists "Stream_chatId_createdAt_idx"
  on public."Stream" ("chatId", "createdAt" asc);

alter table public."Chat" enable row level security;
alter table public."Message_v2" enable row level security;
alter table public."Vote_v2" enable row level security;
alter table public."Document" enable row level security;
alter table public."Suggestion" enable row level security;
alter table public."Stream" enable row level security;

alter table public."Chat" force row level security;
alter table public."Message_v2" force row level security;
alter table public."Vote_v2" force row level security;
alter table public."Document" force row level security;
alter table public."Suggestion" force row level security;
alter table public."Stream" force row level security;

drop policy if exists "Chat_owner_all" on public."Chat";
create policy "Chat_owner_all"
on public."Chat"
for all
to authenticated
using (auth.uid() = "userId")
with check (auth.uid() = "userId");

drop policy if exists "Message_v2_owner_all" on public."Message_v2";
create policy "Message_v2_owner_all"
on public."Message_v2"
for all
to authenticated
using (
  exists (
    select 1
    from public."Chat"
    where "Chat"."id" = "Message_v2"."chatId"
      and "Chat"."userId" = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public."Chat"
    where "Chat"."id" = "Message_v2"."chatId"
      and "Chat"."userId" = auth.uid()
  )
);

drop policy if exists "Vote_v2_owner_all" on public."Vote_v2";
create policy "Vote_v2_owner_all"
on public."Vote_v2"
for all
to authenticated
using (
  exists (
    select 1
    from public."Chat"
    where "Chat"."id" = "Vote_v2"."chatId"
      and "Chat"."userId" = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public."Chat"
    where "Chat"."id" = "Vote_v2"."chatId"
      and "Chat"."userId" = auth.uid()
  )
);

drop policy if exists "Document_owner_all" on public."Document";
create policy "Document_owner_all"
on public."Document"
for all
to authenticated
using (auth.uid() = "userId")
with check (auth.uid() = "userId");

drop policy if exists "Suggestion_owner_all" on public."Suggestion";
create policy "Suggestion_owner_all"
on public."Suggestion"
for all
to authenticated
using (auth.uid() = "userId")
with check (auth.uid() = "userId");

drop policy if exists "Stream_owner_all" on public."Stream";
create policy "Stream_owner_all"
on public."Stream"
for all
to authenticated
using (
  exists (
    select 1
    from public."Chat"
    where "Chat"."id" = "Stream"."chatId"
      and "Chat"."userId" = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public."Chat"
    where "Chat"."id" = "Stream"."chatId"
      and "Chat"."userId" = auth.uid()
  )
);
