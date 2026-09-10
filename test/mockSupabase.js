'use strict';

/**
 * محاكاة داخلية (In-Memory) لعميل Supabase، تدعم فقط أنماط الاستعلامات
 * المستخدمة فعليًا في هذا المشروع (eq, or, order, select count head,
 * maybeSingle, insert, update, delete). الهدف اختبار منطق طبقة db/*
 * بدون الحاجة إلى اتصال شبكي حقيقي بـ Supabase.
 */
function createMockSupabase() {
  const tables = {
    channels: [],
    progress: [],
    channel_schedules: [],
    messages: [],
  };

  let nextScheduleId = 1;

  function parseOrExpr(expr, row) {
    // مثال: "last_triggered_date.is.null,last_triggered_date.neq.2026-09-10"
    const clauses = expr.split(',');
    return clauses.some((clause) => {
      const [col, op, val] = clause.split('.');
      if (op === 'is' && val === 'null') return row[col] === null || row[col] === undefined;
      if (op === 'neq') return row[col] !== val;
      if (op === 'eq') return row[col] === val;
      return false;
    });
  }

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.mode = null;
      this.payload = null;
      this.wantsCount = false;
      this.wantsReturn = false;
      this.orderCol = null;
      this.orderAsc = true;
    }

    select(_cols, opts) {
      if (this.mode === null) this.mode = 'select';
      if (opts && opts.count) this.wantsCount = true;
      if (this.mode !== 'select') this.wantsReturn = true;
      return this;
    }

    insert(payload) {
      this.mode = 'insert';
      this.payload = payload;
      return this;
    }

    update(payload) {
      this.mode = 'update';
      this.payload = payload;
      return this;
    }

    delete() {
      this.mode = 'delete';
      return this;
    }

    eq(col, val) {
      this.filters.push((row) => {
        if (col.startsWith('channels.')) {
          const channelCol = col.slice('channels.'.length);
          const channel = tables.channels.find((c) => c.chat_id === row.chat_id);
          return channel ? channel[channelCol] === val : false;
        }
        return row[col] === val;
      });
      return this;
    }

    or(expr) {
      this.filters.push((row) => parseOrExpr(expr, row));
      return this;
    }

    order(col, opts) {
      this.orderCol = col;
      this.orderAsc = !opts || opts.ascending !== false;
      return this;
    }

    _matching() {
      return tables[this.table].filter((row) => this.filters.every((f) => f(row)));
    }

    async maybeSingle() {
      const rows = this._matching();
      return { data: rows.length > 0 ? rows[0] : null, error: null };
    }

    async _execute() {
      if (this.mode === 'select') {
        let rows = this._matching();
        if (this.orderCol) {
          rows = [...rows].sort((a, b) => {
            const av = a[this.orderCol];
            const bv = b[this.orderCol];
            if (av < bv) return this.orderAsc ? -1 : 1;
            if (av > bv) return this.orderAsc ? 1 : -1;
            return 0;
          });
        }
        const result = { data: rows, error: null };
        if (this.wantsCount) result.count = rows.length;
        return result;
      }

      if (this.mode === 'insert') {
        const rowsToInsert = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const newRow of rowsToInsert) {
          if (this.table === 'channel_schedules') {
            const dup = tables.channel_schedules.find(
              (r) => r.chat_id === newRow.chat_id && r.time_of_day === newRow.time_of_day
            );
            if (dup) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            newRow.id = nextScheduleId++;
            newRow.last_triggered_date = newRow.last_triggered_date || null;
            newRow.created_at = new Date().toISOString();
          }
          if (this.table === 'channels' || this.table === 'progress') {
            newRow.created_at = newRow.created_at || new Date().toISOString();
          }
          tables[this.table].push(newRow);
        }
        return { data: rowsToInsert, error: null };
      }

      if (this.mode === 'update') {
        const rows = this._matching();
        for (const row of rows) {
          Object.assign(row, this.payload);
        }
        const result = { error: null };
        if (this.wantsReturn) result.data = rows;
        return result;
      }

      if (this.mode === 'delete') {
        const rows = this._matching();
        tables[this.table] = tables[this.table].filter((row) => !rows.includes(row));
        return { error: null };
      }

      return { data: null, error: { message: 'unsupported mode' } };
    }

    then(resolve, reject) {
      return this._execute().then(resolve, reject);
    }
  }

  return {
    from(table) {
      return new QueryBuilder(table);
    },
    __tables: tables,
  };
}

module.exports = { createMockSupabase };
