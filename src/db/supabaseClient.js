'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL و SUPABASE_KEY مطلوبان في متغيرات البيئة.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };
