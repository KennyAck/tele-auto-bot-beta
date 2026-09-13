'use strict';

const { supabase } = require('./supabaseClient');

/**
 * جلب رسالة بمعرّف معين. يرجع null إن لم توجد (يُستخدم لمنع الـ Looping).
 * @param {number} id
 * @returns {Promise<{id: number, content: string} | null>}
 */
async function getMessageById(id) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, content')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[messages] خطأ أثناء جلب الرسالة:', error.message);
    return null;
  }
  return data;
}

/**
 * عدّ إجمالي الرسائل المتاحة في جدول messages، لاستخدامه في حساب نسبة
 * التقدم بلوحة التحكم /dashboard. قراءة فقط — لا يعدّل جدول messages.
 * يرجع null صراحةً عند خطأ قاعدة بيانات (وليس 0) للتفريق بين
 * "لا توجد رسائل فعلاً" و"تعذّر الجلب".
 * @returns {Promise<number | null>}
 */
async function getTotalMessagesCount() {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true });

  if (error) {
    console.error('[messages] خطأ أثناء عدّ الرسائل:', error.message);
    return null;
  }
  return count || 0;
}

module.exports = { getMessageById, getTotalMessagesCount };
