'use strict';

/**
 * يحوّل نصًا مكتوبًا بصيغة عربية مرنة إلى وقت موحّد HH:MM (24 ساعة).
 * أمثلة مقبولة:
 *   08:30ص   8:30ص   08:30 م   8:30م   8:30 صباحاً   8:30 مساءً
 * يرجع null إذا كانت الصيغة غير صالحة.
 *
 * @param {string} rawText
 * @returns {{ normalized: string } | null}
 */
function parseArabicTime(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  // إزالة المسافات الزائدة وتوحيد الفراغ بين الرقم والدلالة (ص/م)
  const text = rawText.trim().replace(/\s+/g, ' ');

  // الصيغة المتوقعة: ساعة[:دقيقة] ثم مساحة اختيارية ثم دلالة صباح/مساء
  // الدلالة تقبل: ص / صباحاً / صباحا / م / مساءً / مساء
  const match = text.match(
    /^(\d{1,2})(?::(\d{1,2}))?\s*(ص|صباحا|صباحاً|م|مساء|مساءً)$/u
  );

  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiemRaw = match[3];
  const isPM = meridiemRaw.startsWith('م');

  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  // تحويل من صيغة 12 ساعة إلى 24 ساعة
  if (isPM && hour !== 12) {
    hour += 12;
  } else if (!isPM && hour === 12) {
    hour = 0;
  }

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');

  return { normalized: `${hh}:${mm}` };
}

/**
 * يحوّل وقتًا مخزنًا بصيغة 24 ساعة (HH:MM أو HH:MM:SS، كما يعيده عمود TIME
 * في Postgres) إلى نص عربي للعرض، مثل: "08:30 ص".
 *
 * @param {string} time24 - مثل "08:30" أو "08:30:00" أو "20:30:00"
 * @returns {string}
 */
function formatArabicTime(time24) {
  if (!time24 || typeof time24 !== 'string') return '';

  const [hStr, mStr] = time24.split(':');
  let hour = parseInt(hStr, 10);
  const minute = parseInt(mStr, 10);

  if (Number.isNaN(hour) || Number.isNaN(minute)) return time24;

  const isPM = hour >= 12;
  let displayHour = hour % 12;
  if (displayHour === 0) displayHour = 12;

  const hh = String(displayHour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const meridiem = isPM ? 'م' : 'ص';

  return `${hh}:${mm} ${meridiem}`;
}

module.exports = { parseArabicTime, formatArabicTime };
