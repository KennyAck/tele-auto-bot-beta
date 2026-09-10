'use strict';

const { supabase } = require('./supabaseClient');

/**
 * التأكد من وجود سجل progress لقناة معيّنة، بإنشائه بقيمة
 * last_message_id = 0 إذا لم يكن موجودًا مسبقًا.
 * لا يُصفّر تقدّم قناة يُعاد ربطها.
 * @param {string} chatId
 */
async function ensureProgressForChannel(chatId) {
  const { data: existing, error: fetchError } = await supabase
    .from('progress')
    .select('chat_id')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (fetchError) {
    console.error('[progress] خطأ أثناء التحقق من وجود progress:', fetchError.message);
    return;
  }

  if (!existing) {
    const { error: insertError } = await supabase
      .from('progress')
      .insert({ chat_id: chatId, last_message_id: 0 });

    if (insertError) {
      console.error('[progress] خطأ أثناء إنشاء progress:', insertError.message);
    } else {
      console.log(`[progress] تم إنشاء سجل progress جديد للقناة ${chatId} (last_message_id = 0).`);
    }
  }
}

/**
 * جلب last_message_id لقناة معيّنة. إن لم يوجد سجل، يُعتبر 0.
 * @param {string} chatId
 * @returns {Promise<number>}
 */
async function getLastMessageId(chatId) {
  const { data, error } = await supabase
    .from('progress')
    .select('last_message_id')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error) {
    console.error('[progress] خطأ أثناء جلب last_message_id:', error.message);
    return 0;
  }
  return data ? data.last_message_id : 0;
}

/**
 * تحديث last_message_id بعد نجاح إرسال رسالة.
 * @param {string} chatId
 * @param {number} newLastMessageId
 */
async function updateLastMessageId(chatId, newLastMessageId) {
  const { error } = await supabase
    .from('progress')
    .update({ last_message_id: newLastMessageId })
    .eq('chat_id', chatId);

  if (error) {
    console.error('[progress] خطأ أثناء تحديث last_message_id:', error.message);
  }
}

module.exports = { ensureProgressForChannel, getLastMessageId, updateLastMessageId };
