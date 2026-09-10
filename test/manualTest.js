'use strict';

process.env.BOT_TOKEN = 'test-token';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_KEY = 'test-key';

const assert = require('assert');
const { createMockSupabase } = require('./mockSupabase');

// حقن المحاكاة داخل عميل Supabase الحقيقي (نفس المرجع الذي تستخدمه كل الوحدات)
const supabaseClientModule = require('../src/db/supabaseClient');
const mock = createMockSupabase();
Object.assign(supabaseClientModule.supabase, mock);

const { resolveChannelOwnership, userOwnsChannel, getUserChannels, deactivateChannel } = require('../src/db/channels');
const { getLastMessageId, updateLastMessageId } = require('../src/db/progress');
const { addSchedule, listSchedules, getDueSchedules, claimSchedule, MAX_SCHEDULES_PER_CHANNEL } = require('../src/db/schedules');
const { getMessageById } = require('../src/db/messages');
const { parseArabicTime, formatArabicTime } = require('../src/utils/time');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log('   ', err.message);
    failed++;
  }
}

async function run() {
  // ---------- منطق ملكية القنوات ----------

  await test('ربط قناة جديدة تمامًا ينشئ channels + progress(last_message_id=0)', async () => {
    const result = await resolveChannelOwnership('@channel_a', 111);
    assert.strictEqual(result.status, 'linked');

    const owns = await userOwnsChannel(111, '@channel_a');
    assert.strictEqual(owns, true);

    const lastId = await getLastMessageId('@channel_a');
    assert.strictEqual(lastId, 0);
  });

  await test('إعادة ربط نفس القناة لنفس المالك لا يصفّر progress', async () => {
    await updateLastMessageId('@channel_a', 7);
    const result = await resolveChannelOwnership('@channel_a', 111);
    assert.strictEqual(result.status, 'linked');
    const lastId = await getLastMessageId('@channel_a');
    assert.strictEqual(lastId, 7, 'progress كان يجب ألا يُصفَّر عند إعادة الربط');
  });

  await test('محاولة مستخدم آخر ربط قناة مملوكة تُرفض تمامًا بدون تغيير المالك', async () => {
    const result = await resolveChannelOwnership('@channel_a', 222);
    assert.strictEqual(result.status, 'owned_by_other');
    const ownsOriginal = await userOwnsChannel(111, '@channel_a');
    const ownsNew = await userOwnsChannel(222, '@channel_a');
    assert.strictEqual(ownsOriginal, true);
    assert.strictEqual(ownsNew, false);
  });

  await test('قناة بمالك فارغ (null) يمكن لأي مستخدم أول أن يطالب بها', async () => {
    // محاكاة قناة قديمة بلا مالك (كما لو كانت من نظام قديم)
    mock.__tables.channels.push({ chat_id: '@legacy_channel', owner_user_id: null, is_active: true });
    const result = await resolveChannelOwnership('@legacy_channel', 333);
    assert.strictEqual(result.status, 'linked');
    const owns = await userOwnsChannel(333, '@legacy_channel');
    assert.strictEqual(owns, true);
  });

  await test('getUserChannels يرجع فقط القنوات النشطة المملوكة للمستخدم', async () => {
    const channels = await getUserChannels(111);
    assert.strictEqual(channels.length, 1);
    assert.strictEqual(channels[0].chat_id, '@channel_a');
  });

  // ---------- منطق المواعيد ----------

  await test('إضافة موعد صحيح (تحويل الوقت العربي) تنجح', async () => {
    const parsed = parseArabicTime('8:30ص');
    assert.strictEqual(parsed.normalized, '08:30');
    const result = await addSchedule('@channel_a', parsed.normalized);
    assert.strictEqual(result.ok, true);
  });

  await test('منع إضافة نفس الموعد مرتين لنفس القناة', async () => {
    const result = await addSchedule('@channel_a', '08:30');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'duplicate');
  });

  await test('نفس الموعد مسموح لقناة مختلفة', async () => {
    await resolveChannelOwnership('@channel_b', 111);
    const result = await addSchedule('@channel_b', '08:30');
    assert.strictEqual(result.ok, true);
  });

  await test(`منع تجاوز الحد الأقصى (${MAX_SCHEDULES_PER_CHANNEL} موعداً) لكل قناة`, async () => {
    await resolveChannelOwnership('@channel_c', 111);
    for (let h = 0; h < MAX_SCHEDULES_PER_CHANNEL; h++) {
      const hh = String(h).padStart(2, '0');
      const r = await addSchedule('@channel_c', `${hh}:00`);
      assert.strictEqual(r.ok, true, `فشلت إضافة الموعد رقم ${h + 1}`);
    }
    const overLimit = await addSchedule('@channel_c', '23:59');
    assert.strictEqual(overLimit.ok, false);
    assert.strictEqual(overLimit.reason, 'limit_reached');
  });

  await test('عرض المواعيد مرتب من الصباح إلى الليل وبتنسيق عربي صحيح', async () => {
    await resolveChannelOwnership('@channel_d', 111);
    await addSchedule('@channel_d', '20:30');
    await addSchedule('@channel_d', '08:00');
    await addSchedule('@channel_d', '14:00');

    const schedules = await listSchedules('@channel_d');
    const times = schedules.map((s) => s.time_of_day);
    assert.deepStrictEqual(
      [...times].sort(),
      times,
      'يجب أن تكون النتيجة مرتبة تصاعديًا (وهي بالفعل مرتبة أبجديًا لصيغة HH:MM:SS)'
    );
    assert.strictEqual(formatArabicTime(schedules[0].time_of_day), '08:00 ص');
    assert.strictEqual(formatArabicTime(schedules[1].time_of_day), '02:00 م');
    assert.strictEqual(formatArabicTime(schedules[2].time_of_day), '08:30 م');
  });

  // ---------- منطق النشر: منع التكرار وعدم الـ Looping ----------

  await test('claimSchedule يمنع تنفيذ نفس الموعد مرتين في نفس اليوم', async () => {
    await resolveChannelOwnership('@channel_e', 111);
    await addSchedule('@channel_e', '09:00');
    const schedules = await listSchedules('@channel_e');
    const scheduleId = schedules[0].id;

    const firstClaim = await claimSchedule(scheduleId, '2026-09-10');
    assert.strictEqual(firstClaim, true, 'أول محاولة قفل يجب أن تنجح');

    const secondClaim = await claimSchedule(scheduleId, '2026-09-10');
    assert.strictEqual(secondClaim, false, 'محاولة قفل ثانية لنفس اليوم يجب أن تُرفض (منع التكرار)');

    const nextDayClaim = await claimSchedule(scheduleId, '2026-09-11');
    assert.strictEqual(nextDayClaim, true, 'في يوم جديد يجب أن يُسمح بالتنفيذ مجدداً');
  });

  await test('getDueSchedules يتجاهل قناة معطّلة (is_active=false)', async () => {
    await resolveChannelOwnership('@channel_f', 111);
    await addSchedule('@channel_f', '10:15');
    await deactivateChannel('@channel_f');

    const due = await getDueSchedules('10:15', '2026-09-10');
    const forChannelF = due.filter((d) => d.chat_id === '@channel_f');
    assert.strictEqual(forChannelF.length, 0, 'يجب ألا تظهر مواعيد قناة معطّلة ضمن المستحقة');
  });

  await test('عدم وجود الرسالة التالية (looping ممنوع) لا يوقف التسلسل ولا يعيد من 1', async () => {
    mock.__tables.messages.push({ id: 1, content: 'الرسالة الأولى' });
    mock.__tables.messages.push({ id: 2, content: 'الرسالة الثانية' });
    // لا توجد رسالة بمعرف 3

    await resolveChannelOwnership('@channel_g', 111);
    await updateLastMessageId('@channel_g', 2);

    const msg3 = await getMessageById(3);
    assert.strictEqual(msg3, null, 'يجب ألا توجد رسالة بمعرف 3 (تحاكي نفاد الرسائل)');

    // التأكد أن last_message_id يبقى كما هو (2) لأننا لا نحدّثه عند عدم وجود رسالة
    const lastId = await getLastMessageId('@channel_g');
    assert.strictEqual(lastId, 2);

    // التأكد أن الرسائل تُقرأ بالتسلسل الصحيح بدون قفز أو تكرار
    const msg1 = await getMessageById(1);
    const msg2 = await getMessageById(2);
    assert.strictEqual(msg1.content, 'الرسالة الأولى');
    assert.strictEqual(msg2.content, 'الرسالة الثانية');
  });

  await test('publishNextMessage: يرسل الرسالة الصحيحة ويحدّث progress عند النجاح', async () => {
    const { publishNextMessage } = require('../src/scheduler/scheduler');
    const sent = [];
    const fakeBot = { sendMessage: async (chatId, content) => { sent.push({ chatId, content }); } };

    await publishNextMessage(fakeBot, '@channel_g'); // last=2 حاليًا، لا توجد رسالة 3 → لا إرسال
    assert.strictEqual(sent.length, 0, 'لا يوجد رسالة 3 فيجب ألا يُرسل شيء');

    mock.__tables.messages.push({ id: 3, content: 'الرسالة الثالثة' });
    await publishNextMessage(fakeBot, '@channel_g'); // الآن الرسالة 3 موجودة
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].chatId, '@channel_g');
    assert.strictEqual(sent[0].content, 'الرسالة الثالثة');

    const lastId = await getLastMessageId('@channel_g');
    assert.strictEqual(lastId, 3, 'progress يجب أن يتحدث إلى 3 بعد النجاح');
  });

  await test('publishNextMessage: خطأ صلاحيات يُعطّل القناة تلقائيًا ولا يحدّث progress', async () => {
    const { publishNextMessage } = require('../src/scheduler/scheduler');
    await resolveChannelOwnership('@channel_h', 111);
    mock.__tables.messages.push({ id: 100, content: 'رسالة تجريبية' });
    await updateLastMessageId('@channel_h', 99);

    const failingBot = {
      sendMessage: async () => {
        const err = new Error('Bad Request');
        err.response = { body: { description: 'Bad Request: not enough rights to send text messages to the chat' } };
        throw err;
      },
    };

    await publishNextMessage(failingBot, '@channel_h');

    const channel = mock.__tables.channels.find((c) => c.chat_id === '@channel_h');
    assert.strictEqual(channel.is_active, false, 'يجب تعطيل القناة تلقائيًا عند خطأ الصلاحيات');

    const lastId = await getLastMessageId('@channel_h');
    assert.strictEqual(lastId, 99, 'progress يجب ألا يتحدث عند فشل الإرسال');
  });

  await test('تسلسل نشر كامل عبر عدة مواعيد: كل موعد ينتج رسالة تالية بدون تكرار أو تخطي', async () => {
    const { publishNextMessage } = require('../src/scheduler/scheduler');
    await resolveChannelOwnership('@channel_i', 111);
    mock.__tables.messages.push({ id: 200, content: 'رسالة 200' });
    mock.__tables.messages.push({ id: 201, content: 'رسالة 201' });
    mock.__tables.messages.push({ id: 202, content: 'رسالة 202' });
    await updateLastMessageId('@channel_i', 199);

    const sent = [];
    const fakeBot = { sendMessage: async (chatId, content) => { sent.push(content); } };

    await publishNextMessage(fakeBot, '@channel_i'); // → 200
    await publishNextMessage(fakeBot, '@channel_i'); // → 201
    await publishNextMessage(fakeBot, '@channel_i'); // → 202
    await publishNextMessage(fakeBot, '@channel_i'); // → لا يوجد 203، توقف

    assert.deepStrictEqual(sent, ['رسالة 200', 'رسالة 201', 'رسالة 202']);
    const lastId = await getLastMessageId('@channel_i');
    assert.strictEqual(lastId, 202);
  });

  console.log(`\n${passed} نجح، ${failed} فشل`);
  if (failed > 0) process.exit(1);
}

run();
