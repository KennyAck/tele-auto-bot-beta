'use strict';

const cron = require('node-cron');
const { getDueSchedules, claimSchedule } = require('../db/schedules');
const { getLastMessageId, updateLastMessageId } = require('../db/progress');
const { getMessageById } = require('../db/messages');
const { deactivateChannel } = require('../db/channels');

const TIMEZONE = 'Asia/Riyadh';

/**
 * يرجع الوقت الحالي بصيغة HH:MM والتاريخ الحالي بصيغة YYYY-MM-DD،
 * كلاهما بتوقيت الرياض، بدون الاعتماد على توقيت السيرفر.
 */
function getRiyadhNow() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  // بعض بيئات Node تعيد الساعة "24" بدل "00" عند منتصف الليل مع hour12:false
  const hour = map.hour === '24' ? '00' : map.hour;

  return {
    hhmm: `${hour}:${map.minute}`,
    today: `${map.year}-${map.month}-${map.day}`,
  };
}

/**
 * نشر الرسالة التالية في التسلسل لقناة معيّنة، ومعالجة الأخطاء.
 * @param {import('node-telegram-bot-api')} bot
 * @param {string} chatId
 */
async function publishNextMessage(bot, chatId) {
  const lastId = await getLastMessageId(chatId);
  const nextId = lastId + 1;

  const message = await getMessageById(nextId);
  if (!message) {
    console.log(`[scheduler] لا توجد رسالة بالمعرف ${nextId} للقناة ${chatId} — تخطي بدون looping.`);
    return;
  }

  try {
    await bot.sendMessage(chatId, message.content);
    await updateLastMessageId(chatId, nextId);
    console.log(`[scheduler] تم نشر الرسالة ${nextId} في القناة ${chatId}.`);
  } catch (err) {
    const description = (err && err.response && err.response.body && err.response.body.description) || err.message || '';
    console.error(`[scheduler] فشل إرسال الرسالة إلى ${chatId}:`, description);

    const isPermissionError =
      /not enough rights|CHAT_ADMIN_REQUIRED|chat not found|bot was kicked|have no rights/i.test(description);

    if (isPermissionError) {
      await deactivateChannel(chatId);
    }
    // لا محاولات إعادة إرسال — الموعد اعتُبر منفَّذًا لهذا اليوم أصلاً
    // (تم قفله في claimSchedule قبل محاولة الإرسال) تماشيًا مع قاعدة
    // "لا Catch-up" و"منع التكرار أهم من تفويت رسالة".
  }
}

/**
 * فحص دوري: يبحث عن المواعيد المستحقة الآن وينفّذها.
 * @param {import('node-telegram-bot-api')} bot
 */
async function tick(bot) {
  const { hhmm, today } = getRiyadhNow();

  let dueSchedules;
  try {
    dueSchedules = await getDueSchedules(hhmm, today);
  } catch (err) {
    console.error('[scheduler] خطأ أثناء جلب المواعيد المستحقة:', err.message);
    return;
  }

  for (const schedule of dueSchedules) {
    try {
      const claimed = await claimSchedule(schedule.id, today);
      if (!claimed) {
        // نُفِّذ بالفعل من دورة سابقة/متزامنة — تجاهل لمنع التكرار
        continue;
      }
      await publishNextMessage(bot, schedule.chat_id);
    } catch (err) {
      console.error(`[scheduler] خطأ أثناء معالجة الموعد ${schedule.id}:`, err.message);
    }
  }
}

/**
 * بدء محرك الجدولة: يفحص كل دقيقة بتوقيت Asia/Riyadh.
 * @param {import('node-telegram-bot-api')} bot
 */
function startScheduler(bot) {
  cron.schedule(
    '* * * * *',
    () => {
      tick(bot).catch((err) => console.error('[scheduler] خطأ غير متوقع في الفحص الدوري:', err.message));
    },
    { timezone: TIMEZONE }
  );

  console.log('Scheduler started');
}

module.exports = { startScheduler, getRiyadhNow, tick, publishNextMessage };
