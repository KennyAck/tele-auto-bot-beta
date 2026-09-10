'use strict';

const { supabase } = require('./supabaseClient');

const MAX_SCHEDULES_PER_CHANNEL = 24;

/**
 * تحويل "HH:MM" إلى صيغة يقبلها عمود Postgres TIME عبر PostgREST.
 * @param {string} hhmm
 */
function toTimeValue(hhmm) {
  return `${hhmm}:00`;
}

/**
 * عدّ المواعيد النشطة لقناة معينة.
 * @param {string} chatId
 * @returns {Promise<number>}
 */
async function countActiveSchedules(chatId) {
  const { count, error } = await supabase
    .from('channel_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .eq('is_active', true);

  if (error) {
    console.error('[schedules] خطأ أثناء عدّ المواعيد:', error.message);
    return 0;
  }
  return count || 0;
}

/**
 * التحقق من وجود موعد بنفس الوقت لنفس القناة.
 * @param {string} chatId
 * @param {string} hhmm
 * @returns {Promise<boolean>}
 */
async function scheduleExists(chatId, hhmm) {
  const { data, error } = await supabase
    .from('channel_schedules')
    .select('id')
    .eq('chat_id', chatId)
    .eq('time_of_day', toTimeValue(hhmm))
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[schedules] خطأ أثناء التحقق من التكرار:', error.message);
    return false;
  }
  return !!data;
}

/**
 * إضافة موعد جديد. يرجع { ok: true } أو { ok: false, reason }.
 * reason: 'limit_reached' | 'duplicate' | 'db_error'
 * @param {string} chatId
 * @param {string} hhmm
 */
async function addSchedule(chatId, hhmm) {
  const activeCount = await countActiveSchedules(chatId);
  if (activeCount >= MAX_SCHEDULES_PER_CHANNEL) {
    return { ok: false, reason: 'limit_reached' };
  }

  const duplicate = await scheduleExists(chatId, hhmm);
  if (duplicate) {
    return { ok: false, reason: 'duplicate' };
  }

  const { error } = await supabase
    .from('channel_schedules')
    .insert({ chat_id: chatId, time_of_day: toTimeValue(hhmm), is_active: true });

  if (error) {
    // الحماية النهائية من التكرار: Unique Constraint في قاعدة البيانات
    if (error.code === '23505') {
      return { ok: false, reason: 'duplicate' };
    }
    console.error('[schedules] خطأ أثناء إضافة الموعد:', error.message);
    return { ok: false, reason: 'db_error' };
  }

  return { ok: true };
}

/**
 * جلب مواعيد قناة مرتبة من الصباح إلى الليل.
 * @param {string} chatId
 * @returns {Promise<Array<{id: number, time_of_day: string}>>}
 */
async function listSchedules(chatId) {
  const { data, error } = await supabase
    .from('channel_schedules')
    .select('id, time_of_day')
    .eq('chat_id', chatId)
    .eq('is_active', true)
    .order('time_of_day', { ascending: true });

  if (error) {
    console.error('[schedules] خطأ أثناء جلب المواعيد:', error.message);
    return null;
  }
  return data || [];
}

/**
 * جلب موعد واحد مع التحقق من ملكيته لاحقًا في طبقة البوت.
 * @param {number} scheduleId
 */
async function getScheduleById(scheduleId) {
  const { data, error } = await supabase
    .from('channel_schedules')
    .select('id, chat_id')
    .eq('id', scheduleId)
    .maybeSingle();

  if (error) {
    console.error('[schedules] خطأ أثناء جلب الموعد:', error.message);
    return null;
  }
  return data;
}

/**
 * حذف موعد نهائيًا.
 * @param {number} scheduleId
 */
async function deleteSchedule(scheduleId) {
  const { error } = await supabase.from('channel_schedules').delete().eq('id', scheduleId);
  if (error) {
    console.error('[schedules] خطأ أثناء حذف الموعد:', error.message);
    return false;
  }
  return true;
}

/**
 * جلب كل المواعيد النشطة المستحقة الآن (وقتها يطابق الوقت الحالي ولم
 * تُنفَّذ اليوم بعد)، مع بيانات القناة (chat_id فقط، والقناة نفسها نشطة).
 * @param {string} hhmm - الوقت الحالي بصيغة HH:MM
 * @param {string} today - تاريخ اليوم بصيغة YYYY-MM-DD
 */
async function getDueSchedules(hhmm, today) {
  const { data, error } = await supabase
    .from('channel_schedules')
    .select('id, chat_id, time_of_day, last_triggered_date, channels!inner(is_active)')
    .eq('is_active', true)
    .eq('time_of_day', toTimeValue(hhmm))
    .eq('channels.is_active', true)
    .or(`last_triggered_date.is.null,last_triggered_date.neq.${today}`);

  if (error) {
    console.error('[schedules] خطأ أثناء جلب المواعيد المستحقة:', error.message);
    return [];
  }
  return data || [];
}

/**
 * "قفل" الموعد قبل الإرسال: يحاول تحديث last_triggered_date إلى اليوم،
 * لكن فقط إذا لم يكن قد حُدِّث بالفعل لهذا اليوم (منع التنفيذ المزدوج
 * حتى لو تداخلت دورتا Scheduler). يرجع true إذا نجح القفل (أي نحن من
 * ننفّذ هذا الموعد الآن)، و false إذا كان قد نُفِّذ بالفعل.
 *
 * @param {number} scheduleId
 * @param {string} today - YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
async function claimSchedule(scheduleId, today) {
  const { data, error } = await supabase
    .from('channel_schedules')
    .update({ last_triggered_date: today })
    .eq('id', scheduleId)
    .or(`last_triggered_date.is.null,last_triggered_date.neq.${today}`)
    .select('id');

  if (error) {
    console.error('[schedules] خطأ أثناء قفل الموعد:', error.message);
    return false;
  }
  return !!(data && data.length > 0);
}

module.exports = {
  MAX_SCHEDULES_PER_CHANNEL,
  addSchedule,
  listSchedules,
  getScheduleById,
  deleteSchedule,
  getDueSchedules,
  claimSchedule,
};
