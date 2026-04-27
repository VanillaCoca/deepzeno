create index if not exists conversations_topic_created_idx
  on public.conversations (topic_id, created_at desc);

create index if not exists decisions_topic_updated_idx
  on public.decisions (topic_id, updated_at desc);

create index if not exists edges_topic_created_idx
  on public.edges (topic_id, created_at asc);

create index if not exists candidate_decisions_topic_created_idx
  on public.candidate_decisions (topic_id, created_at desc);

create index if not exists candidate_decisions_topic_status_created_idx
  on public.candidate_decisions (topic_id, status, created_at desc);

create index if not exists candidate_decisions_topic_source_created_idx
  on public.candidate_decisions (topic_id, source, created_at desc);

create index if not exists candidate_decisions_message_created_idx
  on public.candidate_decisions (message_id, created_at desc);

create index if not exists candidate_decisions_conversation_hash_idx
  on public.candidate_decisions (conversation_id, content_hash);
