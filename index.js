'use strict';

// التحقق المبكر من متغيرات البيئة الأساسية — يجب أن يسبق أي require
// لوحدات المشروع الداخلية، لأن بعضها (عبر db/supabaseClient) يفشل فورًا
// عند التحميل إذا كانت المتغيرات ناقصة، ما يمنع رسالة الخطأ الواضحة هنا.
const requiredEnvVars = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`متغيرات بيئة مفقودة: ${missing.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const { registerCommands } = require('./src/bot/commands');
const { registerCallbacks } = require('./src/bot/callbacks');
const { registerTextMessages } = require('./src/bot/textMessages');
const { startScheduler } = require('./src/scheduler/scheduler');

// هذا السطر يتحقق أيضًا من إعداد Supabase مبكرًا (يرمي خطأ فورًا لو ناقص)
require('./src/db/supabaseClient');
console.log('Database connected');

const app = express();
app.use(express.json());

const token = process.env.BOT_TOKEN;
const externalUrl = process.env.RENDER_EXTERNAL_URL;
const bot = new TelegramBot(token);

// استقبال تحديثات تيليغرام عبر Webhook
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// رابط خاص لـ UptimeRobot يمنع Render من النوم
// مهم: بما أن المواعيد الفائتة لا تُعوَّض، يجب إبقاء هذا الـ ping فعّالاً باستمرار
app.get('/', (req, res) => {
  res.send('Bot is active and awake!');
});

registerCommands(bot);
registerCallbacks(bot);
registerTextMessages(bot);
console.log('Bot started');

startScheduler(bot);

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  if (externalUrl) {
    try {
      await bot.setWebHook(`${externalUrl}/bot${token}`);
      console.log('Webhook configured');
    } catch (err) {
      console.error('فشل إعداد Webhook:', err.message);
    }
  } else {
    console.log('تنبيه: RENDER_EXTERNAL_URL غير مضبوط — لم يتم إعداد Webhook.');
  }
});
