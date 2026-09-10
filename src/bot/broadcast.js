'use strict';

const { getAllUserIds } = require('../db/users');
const { setBroadcastState, getBroadcastState, clearBroadcastState } = require('./state');

/**
 * التحقق أن مستخدماً معيناً هو مشرف مخوّل باستخدام ميزة البث.
 * يُضبط عبر متغير البيئة ADMIN_USER_IDS (قائمة معرّفات Telegram
 * مفصولة بفواصل، مثال: "111111,222222").
 * @param {number} userId
 * @returns {boolean}
 */
function isAdmin(userId) {
  const raw = process.env.ADMIN_USER_IDS || '';
  const admins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return admins.includes(String(userId));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * إرسال رسالة إلى كل مستخدمي البوت المسجّلين، رسالة تلو الأخرى مع
 * تأخير بسيط لتفادي حدود Telegram (~30 رسالة/ثانية)، دون أي نظام
 * طوابير أو إعادة محاولة معقّدة — فقط حلقة تسلسلية بسيطة.
 * @param {import('node-telegram-bot-api')} bot
 * @param {string} text
 * @returns {Promise<{ success: number, failed: number, total: number }>}
 */
async function broadcastMessage(bot, text) {
  const userIds = await getAllUserIds();
  let success = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      await bot.sendMessage(userId, text, { parse_mode: 'Markdown' });
      success++;
    } catch (err) {
      failed++;
      console.error(`[broadcast] فشل الإرسال إلى المستخدم ${userId}:`, err.message);
    }
    await sleep(40); // هامش أمان بسيط تحت حد Telegram العام (~30 رسالة/ثانية)
  }

  return { success, failed, total: userIds.length };
}

/**
 * تسجيل أمر /broadcast — للمشرف فقط، وتجاهل صامت لأي شخص آخر.
 * @param {import('node-telegram-bot-api')} bot
 */
function registerBroadcastCommand(bot) {
  bot.onText(/\/broadcast/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (!isAdmin(userId)) return; // تجاهل صامت لغير المشرفين

    setBroadcastState(chatId, { stage: 'awaiting_text' });
    await bot.sendMessage(
      chatId,
      '📢 أرسل الآن نص الرسالة التي تريد بثّها لكل مستخدمي البوت (وليس القنوات).\nيدعم تنسيق *Markdown* — نجمة واحدة قبل وبعد الكلمة لجعلها *عريضة*.'
    );
  });
}

/**
 * معالجة رسالة نصية ضمن تدفّق البث (إن كان المرسل مشرفاً وبانتظار إدخال).
 * يُستدعى من موجّه الرسائل الرئيسي قبل أي معالجة أخرى.
 * @param {import('node-telegram-bot-api')} bot
 * @param {object} msg - كائن الرسالة من Telegram
 * @returns {Promise<boolean>} true إذا تمت معالجة الرسالة هنا (فتوقف الموجّه الرئيسي)
 */
async function handleBroadcastFlowText(bot, msg) {
  const chatId = msg.chat.id;
  const state = getBroadcastState(chatId);
  if (!state) return false;

  if (state.stage === 'awaiting_text') {
    const text = msg.text;
    if (!text) {
      await bot.sendMessage(chatId, '⚠️ الرجاء إرسال نص فقط.');
      return true;
    }

    try {
      const userCount = (await getAllUserIds()).length;
      await bot.sendMessage(chatId, `📢 معاينة الرسالة (سترسل إلى ${userCount} مستخدم):\n\n${text}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ إرسال الآن', callback_data: 'broadcast_confirm' }],
            [{ text: '❌ إلغاء', callback_data: 'broadcast_cancel' }],
          ],
        },
      });
      setBroadcastState(chatId, { stage: 'awaiting_confirm', text });
    } catch (err) {
      console.error('[broadcast] فشل عرض المعاينة (على الأرجح تنسيق Markdown غير صالح):', err.message);
      await bot.sendMessage(
        chatId,
        '⚠️ تعذّر عرض المعاينة، غالباً بسبب رمز تنسيق غير مغلق (مثل * أو _). أرسل نص الرسالة مجدداً.'
      );
      // تبقى الحالة awaiting_text للسماح بإعادة المحاولة
    }
    return true;
  }

  // stage === 'awaiting_confirm' والمستخدم كتب نصاً بدل الضغط على زر
  await bot.sendMessage(chatId, 'الرجاء استخدام الأزرار أدناه للتأكيد أو الإلغاء، أو أرسل /broadcast من جديد لتغيير الرسالة.');
  return true;
}

module.exports = {
  isAdmin,
  registerBroadcastCommand,
  handleBroadcastFlowText,
  broadcastMessage,
};
