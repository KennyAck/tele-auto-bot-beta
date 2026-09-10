-- ============================================================
-- إضافة آمنة لميزة البث (Broadcast) — لا تحذف أي جدول موجود
-- شغّل هذا فقط، وليس migration.sql مرة أخرى (لأنه يحذف الجداول القديمة)
-- ============================================================

create table if not exists bot_users (
  user_id    bigint primary key,
  first_seen timestamptz not null default now()
);
