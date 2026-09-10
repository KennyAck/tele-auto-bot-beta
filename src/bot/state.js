'use strict';

// key: user chat_id → value: { channelChatId }
// ليست بيانات حساسة أو دائمة؛ فقدانها عند إعادة تشغيل السيرفر غير ضار،
// يكفي أن يضغط المستخدم الزر مجدداً — لذلك لا داعي لتخزينها في قاعدة البيانات
const pendingScheduleInput = new Map();

function setPending(userChatId, value) {
  pendingScheduleInput.set(userChatId, value);
}

function getPending(userChatId) {
  return pendingScheduleInput.get(userChatId);
}

function hasPending(userChatId) {
  return pendingScheduleInput.has(userChatId);
}

function clearPending(userChatId) {
  pendingScheduleInput.delete(userChatId);
}

module.exports = { setPending, getPending, hasPending, clearPending };
