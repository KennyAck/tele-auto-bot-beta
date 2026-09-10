-- ============================================================
-- إعادة بناء قاعدة البيانات (باستثناء جدول messages الموجود)
-- شغّل هذا السكريبت في Supabase SQL Editor
-- ============================================================

-- (اختياري) حذف الجداول القديمة إن كانت موجودة من نسخة سابقة
drop table if exists channel_schedules;
drop table if exists progress;
drop table if exists channels;

-- ------------------------------------------------------------
-- 1) channels
-- ------------------------------------------------------------
create table channels (
  chat_id        text primary key,
  owner_user_id  bigint,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) progress
-- ------------------------------------------------------------
create table progress (
  chat_id          text primary key references channels(chat_id) on delete cascade,
  last_message_id  integer not null default 0
);

-- ------------------------------------------------------------
-- 3) channel_schedules
-- ------------------------------------------------------------
create table channel_schedules (
  id                    bigserial primary key,
  chat_id               text not null references channels(chat_id) on delete cascade,
  time_of_day           time not null,
  is_active             boolean not null default true,
  last_triggered_date   date,
  created_at            timestamptz not null default now(),
  unique (chat_id, time_of_day)
);

create index idx_channel_schedules_active_time
  on channel_schedules (time_of_day)
  where is_active = true;

-- ------------------------------------------------------------
-- ملاحظة: جدول messages (id, content) موجود مسبقًا ولا يُعدَّل.
-- لم يتم تفعيل Row Level Security عمدًا (البوت يتصل من السيرفر
-- عبر Service Key مباشرة، بدون Supabase Auth من طرف العميل).
-- ------------------------------------------------------------
