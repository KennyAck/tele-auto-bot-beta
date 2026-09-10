'use strict';

const { supabase } = require('./supabaseClient');

/**
 * تسجيل مستخدم جديد تفاعل مع البوت (إن لم يكن مسجلاً مسبقاً).
 * يُستدعى عند كل رسالة يرسلها أي مستخدم للبوت، بحيث تتكوّن تدريجياً
 * قائمة بكل من استخدم البوت (لأغراض البث لاحقاً).
 * @param {number} userId
 */
async function recordUserIfNew(userId) {
  const { data: existing, error: fetchError } = await supabase
    .from('bot_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError) {
    console.error('[users] خطأ أثناء التحقق من وجود المستخدم:', fetchError.message);
    return;
  }

  if (!existing) {
    const { error: insertError } = await supabase.from('bot_users').insert({ user_id: userId });
    if (insertError) {
      console.error('[users] خطأ أثناء تسجيل مستخدم جديد:', insertError.message);
    }
  }
}

/**
 * جلب معرّفات كل المستخدمين الذين تفاعلوا مع البوت (لأغراض البث).
 * @returns {Promise<number[]>}
 */
async function getAllUserIds() {
  const { data, error } = await supabase.from('bot_users').select('user_id');

  if (error) {
    console.error('[users] خطأ أثناء جلب قائمة المستخدمين:', error.message);
    return [];
  }
  return (data || []).map((row) => row.user_id);
}

module.exports = { recordUserIfNew, getAllUserIds };
