'use strict';

const { supabase } = require('./supabaseClient');
const { ensureProgressForChannel } = require('./progress');

/**
 * جلب القنوات النشطة المملوكة لمستخدم معيّن.
 * @param {number} userId
 * @returns {Promise<Array<{chat_id: string}>>}
 */
async function getUserChannels(userId) {
  const { data, error } = await supabase
    .from('channels')
    .select('chat_id')
    .eq('owner_user_id', userId)
    .eq('is_active', true);

  if (error) {
    console.error('[channels] خطأ في جلب قنوات المستخدم:', error.message);
    return [];
  }
  return data || [];
}

/**
 * التحقق أن مستخدماً معيناً يملك قناة معينة (ونشطة).
 * @param {number} userId
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
async function userOwnsChannel(userId, chatId) {
  const { data, error } = await supabase
    .from('channels')
    .select('chat_id')
    .eq('chat_id', chatId)
    .eq('owner_user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[channels] خطأ في التحقق من الملكية:', error.message);
    return false;
  }
  return !!data;
}

/**
 * نتيجة محاولة ربط/إعادة ربط قناة.
 * status: 'linked' | 'owned_by_other' | 'error'
 */

/**
 * تطبيق منطق ملكية القناة الصارم عند محاولة ربطها:
 *  - غير موجودة              → تُنشأ ومالكها المستخدم الحالي
 *  - موجودة و owner_user_id فارغ → تُنسب للمستخدم الحالي
 *  - موجودة ومالكها نفس المستخدم → إعادة تفعيل فقط
 *  - موجودة ومالكها آخر         → رفض تام، بدون أي تغيير
 *
 * عند النجاح (linked) يتم أيضًا التأكد من وجود سجل progress لهذه القناة.
 *
 * @param {string} chatId
 * @param {number} ownerUserId
 * @returns {Promise<{ status: 'linked'|'owned_by_other'|'error' }>}
 */
async function resolveChannelOwnership(chatId, ownerUserId) {
  const { data: existingChannel, error: fetchError } = await supabase
    .from('channels')
    .select('chat_id, owner_user_id')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (fetchError) {
    console.error('[channels] خطأ أثناء التحقق من ملكية القناة:', fetchError.message);
    return { status: 'error' };
  }

  let dbError = null;

  if (!existingChannel) {
    // حالة 1: قناة جديدة تمامًا
    const { error } = await supabase
      .from('channels')
      .insert({ chat_id: chatId, is_active: true, owner_user_id: ownerUserId });
    dbError = error;
  } else if (existingChannel.owner_user_id === null) {
    // حالة 2: قناة بلا مالك
    const { error } = await supabase
      .from('channels')
      .update({ owner_user_id: ownerUserId, is_active: true })
      .eq('chat_id', chatId);
    dbError = error;
  } else if (Number(existingChannel.owner_user_id) === Number(ownerUserId)) {
    // حالة 3: نفس المالك — إعادة تفعيل فقط
    const { error } = await supabase
      .from('channels')
      .update({ is_active: true })
      .eq('chat_id', chatId);
    dbError = error;
  } else {
    // حالة 4: مملوكة لمستخدم آخر — رفض تام
    return { status: 'owned_by_other' };
  }

  if (dbError) {
    console.error('[channels] خطأ أثناء حفظ القناة:', dbError.message);
    return { status: 'error' };
  }

  // التأكد من وجود progress لهذه القناة (بدون تصفير تقدّم قناة قائمة)
  await ensureProgressForChannel(chatId);

  return { status: 'linked' };
}

/**
 * تعطيل قناة (مثلاً عند فقدان البوت صلاحية النشر فيها).
 * @param {string} chatId
 */
async function deactivateChannel(chatId) {
  const { error } = await supabase
    .from('channels')
    .update({ is_active: false })
    .eq('chat_id', chatId);

  if (error) {
    console.error('[channels] خطأ أثناء تعطيل القناة:', error.message);
  } else {
    console.log(`[channels] تم تعطيل القناة ${chatId} بسبب فقدان الصلاحيات.`);
  }
}

/**
 * جلب كل القنوات في قاعدة البيانات (نشطة وغير نشطة)، لأغراض لوحة
 * التحكم /dashboard فقط. لا علاقة له بمنطق الملكية أو المستخدم الحالي.
 * يرجع null صراحةً عند خطأ قاعدة بيانات (وليس []) للتفريق بين
 * "لا توجد قنوات فعلاً" و"تعذّر الجلب".
 * @returns {Promise<Array<{chat_id: string, owner_user_id: number|null, is_active: boolean}> | null>}
 */
async function getAllChannels() {
  const { data, error } = await supabase
    .from('channels')
    .select('chat_id, owner_user_id, is_active')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[channels] خطأ أثناء جلب كل القنوات:', error.message);
    return null;
  }
  return data || [];
}

module.exports = {
  getUserChannels,
  userOwnsChannel,
  resolveChannelOwnership,
  deactivateChannel,
  getAllChannels,
};
