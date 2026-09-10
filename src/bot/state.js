'use strict';

// key: user chat_id → value: { channelChatId }
// ليست بيانات حساسة أو دائمة؛ فقدانها عند إعادة تشغيل السيرفر غير ضار،
// يكفي أن يضغط المستخدم الزر مجدداً — لذلك لا داعي لتخزينها في قاعدة البيانات
const pendingScheduleInput = new Map();

// حالة تدفّق البث (Broadcast) — للمشرف فقط
// key: admin chat_id → value: { stage: 'awaiting_text' | 'awaiting_confirm', text? }
const pendingBroadcast = new Map();

function setBroadcastState(adminChatId, value) {
  pendingBroadcast.set(adminChatId, value);
}

function getBroadcastState(adminChatId) {
  return pendingBroadcast.get(adminChatId);
}

function hasBroadcastState(adminChatId) {
  return pendingBroadcast.has(adminChatId);
}

function clearBroadcastState(adminChatId) {
  pendingBroadcast.delete(adminChatId);
}

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

module.exports = {
  setPending,
  getPending,
  hasPending,
  clearPending,
  setBroadcastState,
  getBroadcastState,
  hasBroadcastState,
  clearBroadcastState,
};
