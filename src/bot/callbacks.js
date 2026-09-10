'use strict';

const { mainKeyboard, buildChannelPickerKeyboard, buildSchedulesKeyboard } = require('./keyboards');
const { setPending, clearPending, getBroadcastState, clearBroadcastState } = require('./state');
const { getUserChannels, userOwnsChannel } = require('../db/channels');
const { listSchedules, getScheduleById, deleteSchedule, MAX_SCHEDULES_PER_CHANNEL } = require('../db/schedules');
const { isAdmin, broadcastMessage } = require('./broadcast');
const { formatArabicTime } = require('../utils/time');

async function startAddScheduleFlow(bot, userChatId, channelChatId) {
  setPending(userChatId, { channelChatId });
  await bot.sendMessage(
    userChatId,
    `⏰ حدد الوقت الذي تريد أن تُرسل فيه الرسالة للقناة ${channelChatId}.\n\nاكتب الوقت بالصيغة التالية:\n08:30ص\n\nمثال:\n8:30م`
  );
}

async function showSchedulesList(bot, userChatId, channelChatId) {
  const schedules = await listSchedules(channelChatId);

  if (schedules === null) {
    return bot.sendMessage(userChatId, 'حدث خطأ أثناء جلب المواعيد، حاول لاحقاً.');
  }

  if (schedules.length === 0) {
    return bot.sendMessage(userChatId, `📅 لا توجد مواعيد نشر مضافة بعد للقناة ${channelChatId}.`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'back_main' }]] },
    });
  }

  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  let text = `📅 مواعيد النشر (${channelChatId}):\n\n`;
  const items = schedules.map((s, i) => {
    const label = formatArabicTime(s.time_of_day);
    const emoji = i < numberEmojis.length ? numberEmojis[i] : `${i + 1}.`;
    text += `${emoji} ${label}\n`;
    return { id: s.id, label };
  });

  await bot.sendMessage(userChatId, text, buildSchedulesKeyboard(items));
}

async function handleChannelSelection(bot, chatId, userId, channelChatId, purpose) {
  const owns = await userOwnsChannel(userId, channelChatId);
  if (!owns) {
    return bot.sendMessage(chatId, '⚠️ لا يمكنك إدارة مواعيد هذه القناة.');
  }
  if (purpose === 'add') {
    return startAddScheduleFlow(bot, chatId, channelChatId);
  }
  return showSchedulesList(bot, chatId, channelChatId);
}

function registerCallbacks(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    try {
      if (data === 'about_bot') {
        await bot.sendMessage(
          chatId,
          'ℹ️ *حول البوت:*\nهو بوت مخصص لنشر رسائل إسلامية وتوعوية قصيرة بشكل تلقائي في مواعيد ثابتة تحددها أنت لكل قناة.',
          { parse_mode: 'Markdown' }
        );
      } else if (data === 'dev_channel') {
        await bot.sendMessage(chatId, '📢 *قناة "وأذّن في الناس" (المستودع):*\n@islamicvideostorepost', {
          parse_mode: 'Markdown',
        });
      } else if (data === 'contact_us') {
        await bot.sendMessage(chatId, '📩 *للشكاوى والاقتراحات:*\nالعبد الفقير إلى الله: @I_royalty_I', {
          parse_mode: 'Markdown',
        });
      } else if (data === 'back_main') {
        clearPending(chatId);
        await bot.sendMessage(chatId, 'القائمة الرئيسية:', mainKeyboard);
      } else if (data === 'add_schedule' || data === 'list_schedules') {
        const purpose = data === 'add_schedule' ? 'add' : 'list';
        const channels = await getUserChannels(userId);

        if (channels.length === 0) {
          await bot.sendMessage(chatId, '⚠️ لا توجد لديك قناة مفعّلة بعد. أرسل معرف قناتك (مثال: @my_channel) أولاً لربطها.');
        } else if (channels.length === 1) {
          if (purpose === 'add') {
            await startAddScheduleFlow(bot, chatId, channels[0].chat_id);
          } else {
            await showSchedulesList(bot, chatId, channels[0].chat_id);
          }
        } else {
          await bot.sendMessage(chatId, '📢 لديك أكثر من قناة، الرجاء اختيار القناة أولاً:', buildChannelPickerKeyboard(channels, purpose));
        }
      } else if (data.startsWith('pick_channel_add:')) {
        const channelChatId = data.slice('pick_channel_add:'.length);
        await handleChannelSelection(bot, chatId, userId, channelChatId, 'add');
      } else if (data.startsWith('pick_channel_list:')) {
        const channelChatId = data.slice('pick_channel_list:'.length);
        await handleChannelSelection(bot, chatId, userId, channelChatId, 'list');
      } else if (data.startsWith('del_sched:')) {
        const scheduleId = data.slice('del_sched:'.length);
        const schedule = await getScheduleById(scheduleId);

        if (!schedule) {
          await bot.sendMessage(chatId, 'هذا الموعد غير موجود (ربما تم حذفه مسبقاً).');
        } else if (!(await userOwnsChannel(userId, schedule.chat_id))) {
          await bot.sendMessage(chatId, '⚠️ لا يمكنك حذف مواعيد هذه القناة.');
        } else {
          const ok = await deleteSchedule(scheduleId);
          if (ok) {
            await bot.sendMessage(chatId, '🗑️ تم حذف الموعد بنجاح.');
          } else {
            await bot.sendMessage(chatId, 'حدث خطأ أثناء حذف الموعد، حاول لاحقاً.');
          }
          await showSchedulesList(bot, chatId, schedule.chat_id);
        }
      } else if (data === 'broadcast_confirm') {
        if (!isAdmin(userId)) return; // تجاهل صامت لغير المشرفين
        const state = getBroadcastState(chatId);
        if (!state || state.stage !== 'awaiting_confirm') {
          await bot.sendMessage(chatId, 'لا توجد رسالة بث قيد الانتظار حالياً.');
        } else {
          clearBroadcastState(chatId);
          await bot.sendMessage(chatId, '⏳ جارِ الإرسال، قد يستغرق بعض الوقت حسب عدد المستخدمين...');
          const result = await broadcastMessage(bot, state.text);
          await bot.sendMessage(
            chatId,
            `✅ تم الإرسال بنجاح إلى ${result.success} من أصل ${result.total} مستخدم.` +
              (result.failed > 0 ? `\n⚠️ فشل الإرسال إلى ${result.failed} مستخدم (على الأرجح حظروا البوت).` : '')
          );
        }
      } else if (data === 'broadcast_cancel') {
        if (!isAdmin(userId)) return; // تجاهل صامت لغير المشرفين
        clearBroadcastState(chatId);
        await bot.sendMessage(chatId, 'تم إلغاء البث.');
      }
    } catch (err) {
      console.error('[callbacks] خطأ في معالجة الزر:', err.message);
    }

    bot.answerCallbackQuery(query.id).catch(() => {});
  });
}

module.exports = { registerCallbacks, MAX_SCHEDULES_PER_CHANNEL };
