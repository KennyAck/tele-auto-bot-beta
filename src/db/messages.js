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

module.exports = { getMessageById };
