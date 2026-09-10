'use strict';

const { mainKeyboard } = require('./keyboards');

function registerCommands(bot) {
  bot.onText(/\/start/, (msg) => {
    const welcomeText = `أهلاً بك في بوت "وأذّن في الناس"! 🌿

خطوات تفعيل البوت في قناتك:
1️⃣ أضف البوت مشرفاً (Admin) في قناتك.
2️⃣ امنحه صلاحية "نشر الرسائل" (Post Messages).
3️⃣ أرسل لي معرف القناة هنا (مثال: @my_channel).

استخدم الأزرار أدناه للمزيد من التفاصيل:`;

    bot.sendMessage(msg.chat.id, welcomeText, mainKeyboard);
  });
}

module.exports = { registerCommands };
