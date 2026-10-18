export const PRESETS = {
  A: { start: '08:30', end: '17:30', label: 'A', color: 'a' },
  'A+': { start: '08:30', end: '18:00', label: 'A+', color: 'ap' },
  B: { start: '12:30', end: '21:30', label: 'B', color: 'b' },
  C: { start: '08:30', end: '21:30', label: 'C', color: 'c' },
  FIELD: { start: null, end: null, label: '現場', color: 'field' },
  OFF: { start: null, end: null, label: '休み', color: 'off' }
};
export const DEFAULT_SETTINGS = { minutesBefore: 60, reminderEnabled: false };
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00+09:00');
  return !isNaN(date) && localDate(date) === value;
}
export function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function hasShiftTime(code) { return Object.hasOwn(PRESETS,code) && PRESETS[code].start !== null && PRESETS[code].end !== null; }
export function shiftFor(date, code, early = '') {
  if (!validDate(date) || !Object.hasOwn(PRESETS,code)) throw new Error('日付かシフトを確認してください。');
  const preset = PRESETS[code];
  if (early && !['07:30', '08:00'].includes(early)) throw new Error('早朝の開始時刻を確認してください。');
  return { date, code, start: hasShiftTime(code) ? early || preset.start : null, end: preset.end };
}
export function reminderAt(shift, minutesBefore = 60) {
  if (!shift || !hasShiftTime(shift.code) || !validTime(shift.start) || !validTime(shift.end)) return null;
  const start = new Date(`${shift.date}T${shift.start}:00+09:00`);
  const end = new Date(`${shift.date}T${shift.end}:00+09:00`);
  if (!(end > start)) return null;
  return new Date(Math.max(start.getTime(), end.getTime() - minutesBefore * 60000));
}
export function emptyData() { return { shifts: [], events: [], incidents: [] }; }
export function monthCells(year, month) {
  const first = new Date(year, month, 1, 12);
  const offset = first.getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const length = Math.ceil((offset + count) / 7) * 7;
  return Array.from({ length }, (_, i) => {
    const d = new Date(year, month, i - offset + 1, 12);
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, day: d.getDate(), current: d.getMonth() === month, weekday: d.getDay() };
  });
}
function validId(id) { return typeof id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id); }
export function validateBackup(raw) {
  if (raw?.app !== 'hitokoto-jikenbo' || raw.version !== 1 || !raw.data) throw new Error('この手帳のバックアップファイルを選んでください。');
  const { shifts, events, incidents } = raw.data;
  if (![shifts, events, incidents].every(x => Array.isArray(x) && x.length <= 20000)) throw new Error('バックアップの形式を確認してください。');
  const clean = emptyData();
  clean.shifts = shifts.map(s => {
    if (!validDate(s.date) || !Object.hasOwn(PRESETS,s.code) || (hasShiftTime(s.code) && (!validTime(s.start) || !validTime(s.end) || s.start >= s.end)) || (s.code === 'FIELD' && (s.start != null || s.end != null))) throw new Error('シフトに読み込めない値があります。');
    return { date: s.date, code: s.code, start: hasShiftTime(s.code) ? s.start : null, end: hasShiftTime(s.code) ? s.end : null };
  });
  clean.events = events.map(e => {
    if (!validId(e.id) || !validDate(e.date) || typeof e.title !== 'string' || !e.title.trim() || e.title.length > 200 || (e.time && !validTime(e.time))) throw new Error('予定に読み込めない値があります。');
    return { id: e.id, date: e.date, title: e.title.trim(), time: e.time || null };
  });
  clean.incidents = incidents.map(e => {
    if (!validId(e.id) || !validDate(e.date) || typeof e.body !== 'string' || !e.body.trim() || e.body.length > 600) throw new Error('事件簿に読み込めない値があります。');
    return { id: e.id, date: e.date, body: e.body.trim() };
  });
  for (const [kind, key] of [['shifts','date'],['events','id'],['incidents','id']]) {
    if (new Set(clean[kind].map(x => x[key])).size !== clean[kind].length) throw new Error('同じ記録が重複しています。');
  }
  return clean;
}
export function mergeData(base, incoming) {
  return Object.fromEntries(['shifts','events','incidents'].map(kind => {
    const key = kind === 'shifts' ? 'date' : 'id';
    const map = new Map(base[kind].map(x => [x[key], x]));
    incoming[kind].forEach(x => map.set(x[key], x));
    return [kind, [...map.values()]];
  }));
}
export function incidentMarkdown(data) {
  return '# 業務ひとこと事件簿\n\n' + [...data.incidents].sort((a,b) => a.date.localeCompare(b.date)).map(e => {
    const shift = data.shifts.find(s => s.date === e.date);
    return `## ${e.date}${shift ? `（${PRESETS[shift.code].label}）` : ''}\n\n${e.body}\n`;
  }).join('\n');
}
