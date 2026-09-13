'use strict';

const { getAllChannels } = require('../db/channels');
const { listSchedules } = require('../db/schedules');
const { getLastMessageId } = require('../db/progress');
const { getTotalMessagesCount } = require('../db/messages');
const { formatArabicTime } = require('../utils/time');

const CHANNELS_PER_PAGE = 5;

/**
 * التحقق أن مستخدماً معيناً مخوّل باستخدام لوحة التحكم /dashboard.
 * يستخدم نفس متغير البيئة ADMIN_USER_IDS المستخدم لأمر /broadcast —
 * متغيّر واحد فقط يتحكم بكل صلاحيات الإدارة، بدل متغيّرين منفصلين.
 * هذا تحقق فعلي من هوية المستخدم — وليس مجرّد إخفاء الأمر — ويُطبَّق
 * قبل أي استعلام لبيانات القنوات الحساسة.
 * @param {number} userId
 * @returns {boolean}
 */
function isDashboardAdmin(userId) {
  const raw = process.env.ADMIN_USER_IDS || '';
  const admins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return admins.includes(String(userId));
}

/**
 * حساب نسبة تقدّم النشر لقناة واحدة، مع التعامل الصريح مع الحالات
 * الخاصة (لا رسائل، last_message_id أكبر من الإجمالي، خطأ قراءة).
 * دالة نقية (Pure) لا تلمس قاعدة البيانات — سهلة الاختبار.
 *
 * @param {number|null} lastMessageId - null يعني فشل قراءة progress
 * @param {number|null} totalMessages - null يعني فشل عدّ الرسائل
 * @returns {{status: 'error'|'no_messages'|'ok', lastMessageId?: number, totalMessages?: number, percent?: number}}
 */
function computeProgress(lastMessageId, totalMessages) {
  if (lastMessageId === null || totalMessages === null) {
    return { status: 'error' };
  }
  if (totalMessages <= 0) {
    return { status: 'no_messages', lastMessageId, totalMessages };
  }

  // التعامل مع last_message_id أكبر من الإجمالي (حالة شاذة) بتقييده
  // عند 100% بدل عرض نسبة غير منطقية مثل 137%.
  const clampedLast = Math.min(Math.max(lastMessageId, 0), totalMessages);
  const percent = Math.round((clampedLast / totalMessages) * 100);

  return { status: 'ok', lastMessageId, totalMessages, percent };
}

/**
 * تجميع بيانات كل القنوات (المالك، المواعيد، التقدم) من قاعدة البيانات.
 * قراءة فقط بالكامل — لا يعدّل أي جدول.
 * @returns {Promise<{ error: true } | { error: false, entries: Array<object>, totalMessages: number|null }>}
 */
async function buildDashboardEntries() {
  const channels = await getAllChannels();
  if (channels === null) {
    return { error: true };
  }

  const totalMessages = await getTotalMessagesCount();

  const entries = [];
  for (const channel of channels) {
    const schedules = await listSchedules(channel.chat_id); // null عند خطأ، [] إذا لا مواعيد
    const lastMessageId = await getLastMessageId(channel.chat_id); // null عند خطأ

    entries.push({
      chatId: channel.chat_id,
      ownerUserId: channel.owner_user_id,
      isActive: channel.is_active,
      schedules,
      lastMessageId,
    });
  }

  return { error: false, entries, totalMessages };
}

/**
 * تنسيق كتلة نصية واحدة لقناة ضمن لوحة التحكم.
 * @param {object} entry
 * @param {number|null} totalMessages
 * @returns {string}
 */
function formatEntry(entry, totalMessages) {
  const statusLine = entry.isActive ? '🟢 Enabled' : '🔴 Disabled';

  let schedulesBlock;
  let scheduleCountText;
  if (entry.schedules === null) {
    schedulesBlock = '⚠️ تعذّر جلب المواعيد.';
    scheduleCountText = '—';
  } else if (entry.schedules.length === 0) {
    schedulesBlock = 'لا توجد مواعيد مضافة بعد.';
    scheduleCountText = '0';
  } else {
    schedulesBlock = entry.schedules.map((s) => `• ${formatArabicTime(s.time_of_day)}`).join('\n');
    scheduleCountText = String(entry.schedules.length);
  }

  const progress = computeProgress(entry.lastMessageId, totalMessages);
  let progressBlock;
  if (progress.status === 'error') {
    progressBlock = '⚠️ تعذّر جلب تقدم الرسائل.';
  } else if (progress.status === 'no_messages') {
    progressBlock = 'لا توجد رسائل في قاعدة البيانات بعد.';
  } else {
    progressBlock =
      `• آخر رسالة منشورة: #${progress.lastMessageId}\n` +
      `• إجمالي الرسائل: ${progress.totalMessages}\n` +
      `• التقدم: ${progress.percent}%`;
  }

  return (
    `📢 القناة: ${entry.chatId}\n` +
    `👤 المالك: ${entry.ownerUserId}\n` +
    `${statusLine}\n` +
    `📅 عدد المواعيد: ${scheduleCountText}\n\n` +
    `⏰ المواعيد:\n${schedulesBlock}\n\n` +
    `📨 تقدم الرسائل:\n${progressBlock}`
  );
}

/**
 * بناء نص صفحة كاملة من صفحات لوحة التحكم.
 * @param {Array<object>} entries
 * @param {number|null} totalMessages
 * @param {number} pageIndex - صفر-محور
 * @param {number} pageCount
 * @returns {string}
 */
function renderDashboardText(entries, totalMessages, pageIndex, pageCount) {
  if (entries.length === 0) {
    return '📊 Dashboard\n\nلا توجد قنوات مرتبطة بالبوت حالياً.';
  }

  const start = pageIndex * CHANNELS_PER_PAGE;
  const pageEntries = entries.slice(start, start + CHANNELS_PER_PAGE);
  const header = pageCount > 1 ? `📊 Dashboard — ${pageIndex + 1}/${pageCount}` : '📊 Dashboard';
  const separator = '\n━━━━━━━━━━━━━━\n\n';

  return header + '\n\n' + pageEntries.map((e) => formatEntry(e, totalMessages)).join(separator);
}

/**
 * بناء لوحة أزرار التنقّل بين الصفحات (السابق/التالي)، أو undefined
 * إذا كانت صفحة واحدة فقط (لا حاجة لأزرار).
 * @param {number} pageIndex
 * @param {number} pageCount
 */
function buildPaginationKeyboard(pageIndex, pageCount) {
  if (pageCount <= 1) return undefined;

  const buttons = [];
  if (pageIndex > 0) {
    buttons.push({ text: '⬅️ السابق', callback_data: `dashboard_page:${pageIndex - 1}` });
  }
  if (pageIndex < pageCount - 1) {
    buttons.push({ text: 'التالي ➡️', callback_data: `dashboard_page:${pageIndex + 1}` });
  }

  return { reply_markup: { inline_keyboard: [buttons] } };
}

/**
 * إرسال صفحة من لوحة التحكم (رسالة جديدة) أو تعديل رسالة موجودة (عند
 * التنقّل بالأزرار). لا يتحقق من الصلاحية هنا — يجب التحقق قبل الاستدعاء.
 * @param {import('node-telegram-bot-api')} bot
 * @param {number} chatId
 * @param {number|null} messageId - مرّر رقم رسالة لتعديلها، أو null لإرسال جديدة
 * @param {number} requestedPageIndex
 */
async function sendDashboardPage(bot, chatId, messageId, requestedPageIndex) {
  const result = await buildDashboardEntries();

  if (result.error) {
    const text = '⚠️ حدث خطأ أثناء جلب بيانات القنوات، حاول لاحقاً.';
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
    } else {
      await bot.sendMessage(chatId, text);
    }
    return;
  }

  const { entries, totalMessages } = result;
  const pageCount = entries.length === 0 ? 1 : Math.ceil(entries.length / CHANNELS_PER_PAGE);
  const pageIndex = Math.min(Math.max(requestedPageIndex, 0), pageCount - 1);

  const text = renderDashboardText(entries, totalMessages, pageIndex, pageCount);
  const keyboard = buildPaginationKeyboard(pageIndex, pageCount);

  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard ? keyboard.reply_markup : { inline_keyboard: [] },
    });
  } else {
    await bot.sendMessage(chatId, text, keyboard || {});
  }
}

/**
 * تسجيل أمر /dashboard — لمشرفي DASHBOARD_ADMIN_IDS فقط. أي مستخدم
 * آخر يحصل على رسالة رفض صريحة، ولا يُستعلَم عن أي بيانات قنوات له.
 * @param {import('node-telegram-bot-api')} bot
 */
function registerDashboardCommand(bot) {
  bot.onText(/\/dashboard/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (!isDashboardAdmin(userId)) {
      await bot.sendMessage(chatId, '⚠️ غير مصرح لك باستخدام هذا الأمر.');
      return;
    }

    await sendDashboardPage(bot, chatId, null, 0);
  });
}

module.exports = {
  isDashboardAdmin,
  computeProgress,
  buildDashboardEntries,
  formatEntry,
  renderDashboardText,
  buildPaginationKeyboard,
  sendDashboardPage,
  registerDashboardCommand,
  CHANNELS_PER_PAGE,
};
