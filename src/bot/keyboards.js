'use strict';

const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: 'ℹ️ حول البوت', callback_data: 'about_bot' }],
      [{ text: '📢 قناة المطور', callback_data: 'dev_channel' }],
      [{ text: '📩 تواصل معنا', callback_data: 'contact_us' }],
      [{ text: '⏰ إضافة موعد رسالة', callback_data: 'add_schedule' }],
      [{ text: '📋 مواعيد النشر', callback_data: 'list_schedules' }],
    ],
  },
};

/**
 * بناء لوحة اختيار قناة من بين عدة قنوات مملوكة للمستخدم.
 * @param {Array<{chat_id: string}>} channels
 * @param {'add'|'list'} purpose
 */
function buildChannelPickerKeyboard(channels, purpose) {
  const prefix = purpose === 'add' ? 'pick_channel_add' : 'pick_channel_list';
  const buttons = channels.map((c) => [
    { text: c.chat_id, callback_data: `${prefix}:${c.chat_id}` },
  ]);
  buttons.push([{ text: '🔙 رجوع', callback_data: 'back_main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

/**
 * بناء لوحة عرض المواعيد مع زر حذف بجانب كل موعد.
 * @param {Array<{id: number, label: string}>} items - label = الوقت المنسّق
 */
function buildSchedulesKeyboard(items) {
  const buttons = items.map((item) => [
    { text: `${item.label}   🗑️`, callback_data: `del_sched:${item.id}` },
  ]);
  buttons.push([{ text: '🔙 رجوع للقائمة الرئيسية', callback_data: 'back_main' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

module.exports = { mainKeyboard, buildChannelPickerKeyboard, buildSchedulesKeyboard };
