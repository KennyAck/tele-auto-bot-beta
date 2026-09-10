'use strict';

const { mainKeyboard } = require('./keyboards');
const { hasPending, getPending, clearPending } = require('./state');
const { resolveChannelOwnership } = require('../db/channels');
const { addSchedule, MAX_SCHEDULES_PER_CHANNEL } = require('../db/schedules');
const { parseArabicTime, formatArabicTime } = require('../utils/time');

async function handleScheduleTimeInput(bot, userChatId, text) {
  const { channelChatId } = getPending(userChatId);
  const parsed = parseArabicTime(text);

  if (!parsed) {
    return bot.sendMessage(
      userChatId,
      '⚠️ صيغة الوقت غير صحيحة. الرجاء الكتابة بالصيغة التالية:\n08:30ص\nمثال: 8:30م'
    );
  }

  const result = await addSchedule(channelChatId, parsed.normalized);
  clearPending(userChatId);

  if (!result.ok) {
    if (result.reason === 'limit_reached') {
      return bot.sendMessage(
        userChatId,
        `⚠️ لا يمكن إضافة المزيد من المواعيد. الحد الأقصى هو ${MAX_SCHEDULES_PER_CHANNEL} موعداً يومياً لكل قناة.`
      );
    }
    if (result.reason === 'duplicate') {
      return bot.sendMessage(
        userChatId,
        `⚠️ هذا الموعد (${formatArabicTime(parsed.normalized)}) موجود مسبقاً لهذه القناة.`
      );
    }
    return bot.sendMessage(userChatId, 'حدث خطأ أثناء حفظ الموعد، حاول لاحقاً.');
  }

  return bot.sendMessage(
    userChatId,
    `✅ تم إضافة الموعد ${formatArabicTime(parsed.normalized)} بنجاح للقناة ${channelChatId}.`
  );
}

async function handleChannelLinking(bot, userChatId, fromUserId, text) {
  const channelId = text.trim();

  try {
    const me = await bot.getMe();
    const botMember = await bot.getChatMember(channelId, me.id);
    const isAdmin = ['administrator', 'creator'].includes(botMember.status);
    const canPostMessages = botMember.can_post_messages !== false;

    if (!isAdmin || !canPostMessages) {
      return bot.sendMessage(
        userChatId,
        `⚠️ **تنبيه:** لم يتم تفعيل القناة!\nيرجى رفع البوت كـ **Admin** في القناة ${channelId} والتأكد من إعطائه **صلاحية نشر الرسائل (Post Messages)** ثم أرسل المعرف مجدداً.`
      );
    }

    const result = await resolveChannelOwnership(channelId, fromUserId);

    if (result.status === 'owned_by_other') {
      return bot.sendMessage(userChatId, '⚠️ هذه القناة مربوطة مسبقاً بحساب آخر ولا يمكنك إدارتها.');
    }
    if (result.status === 'error') {
      return bot.sendMessage(userChatId, 'حدث خطأ في قاعدة البيانات أثناء التفعيل، يرجى المحاولة لاحقاً.');
    }

    return bot.sendMessage(
      userChatId,
      `✅ تم التأكد من الصلاحيات وتفعيل القناة ${channelId} بنجاح!\nالآن أضف مواعيد النشر عبر زر "⏰ إضافة موعد رسالة".`,
      mainKeyboard
    );
  } catch (err) {
    console.error('[textMessages] خطأ أثناء ربط القناة:', err.message);
    return bot.sendMessage(
      userChatId,
      `❌ **عذراً!** البوت ليس عضواً في القناة ${channelId} أو المعرف غير صحيح. أضف البوت للقناة كـ Admin أولاً ثم حاول مجدداً.`
    );
  }
}

function registerTextMessages(bot) {
  bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text) return;

    const userChatId = msg.chat.id;

    if (hasPending(userChatId)) {
      return handleScheduleTimeInput(bot, userChatId, text);
    }

    if (text.startsWith('@')) {
      return handleChannelLinking(bot, userChatId, msg.from.id, text);
    }
  });
}

module.exports = { registerTextMessages };
