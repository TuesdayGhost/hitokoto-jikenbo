import { PRESETS, DEFAULT_SETTINGS, localDate, validDate, validTime, shiftFor, reminderAt, emptyData, monthCells, validateBackup, mergeData, incidentMarkdown } from './model.js';

const $ = (q, root = document) => root.querySelector(q);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
  book: '<path d="M5 3h13a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Zm-2 15a3 3 0 0 1 3-3h14M8 7h7m-7 4h4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4Zm5 4h4"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5 5 0 1 1 1 11Z"/>',
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4Zm10-10 4 4"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;
const STORE = 'hitokoto-local-v1';
const CONFIG_KEY = 'hitokoto-connection-v1';
const PREFS = 'hitokoto-prefs-v1';
let today = localDate();
let selected = validDate(new URL(location.href).searchParams.get('date')) ? new URL(location.href).searchParams.get('date') : today;
let cursor = new Date(selected + 'T12:00:00+09:00');
let view = 'calendar', batch = false, batchCode = 'A', busy = false, client = null, user = null, cloudError = false;
let data = emptyData(), settings = { ...DEFAULT_SETTINGS }, search = '', localCorrupt = false;
let sw = null, toastTimer, pendingDeepLink = new URL(location.href).searchParams.get('compose') === '1';
let connection = { ...(window.JIKENBO_CONFIG || {}) };
try { connection = { ...connection, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') }; } catch {}
function readLocal() {
  const raw = localStorage.getItem(STORE);
  return raw ? validateBackup(JSON.parse(raw)) : emptyData();
}
function readSettings() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(PREFS) || '{}'), reminderEnabled: false }; } catch { return { ...DEFAULT_SETTINGS }; } }
function storeLocal(next) { localStorage.setItem(STORE, JSON.stringify({ app:'hitokoto-jikenbo', version:1, data:next })); }
function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.className = `show ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.className = '', error ? 7000 : 3500);
}
const countAll = value => value.shifts.length + value.events.length + value.incidents.length;
const shiftOn = date => data.shifts.find(x => x.date === date);
function dateLabel(date, withYear = false) {
  return new Intl.DateTimeFormat('ja-JP', { year: withYear ? 'numeric' : undefined, month:'long', day:'numeric', weekday:'short', timeZone:'Asia/Tokyo' }).format(new Date(date + 'T12:00:00+09:00'));
}
function shiftBadge(s, large = false) { return s ? `<span class="shift-badge ${PRESETS[s.code].color} ${large ? 'large' : ''}">${esc(PRESETS[s.code].label)}</span>` : ''; }
function shiftedTime(s) { return s?.code && s.code !== 'OFF' ? `${s.start}–${s.end}` : s?.code === 'OFF' ? 'おつかれさまの日' : 'シフト未登録'; }
function bellTime(s) {
  const value = reminderAt(s, settings.minutesBefore);
  return value ? new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'}).format(value) : '';
}
function render() {
  $('#app').innerHTML = `
    <header class="site-header"><a class="brand" href="./" aria-label="ひとこと事件簿 ホーム"><img class="mascot-ghost" src="./ghost-mascot.webp" width="42" height="42" alt=""><span>ひとこと事件簿<small>MY LITTLE WORK NOTEBOOK</small></span></a>
    <span class="save-state ${cloudError ? 'has-error' : ''}">${icon(user ? 'cloud' : 'book')}<span>${user ? cloudError ? '接続を確認してください' : 'クラウド保存' : 'この端末に保存'}</span></span></header>
    <main class="page ${view}">${view === 'calendar' ? calendarPage() : view === 'history' ? historyPage() : settingsPage()}</main>
    <nav class="bottom-nav" aria-label="メインメニュー">${[['calendar','calendar','カレンダー'],['history','book','事件簿'],['settings','settings','設定']].map(([id,i,label]) => `<button data-action="view" data-view="${id}" class="nav-item ${id===view?'active':''}" ${id===view?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('')}</nav>`;
}
function calendarPage() {
  const thisShift = shiftOn(today), incidentsToday = data.incidents.filter(x => x.date === today).length;
  const heading = thisShift?.code === 'OFF' ? '今日は、ひとやすみ。' : incidentsToday ? '今日のひとこと、残ってるよ。' : '今日はひとこと事件ある？';
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const monthKey = `${year}-${String(month+1).padStart(2,'0')}`;
  const monthCount = data.incidents.filter(x => x.date.startsWith(monthKey)).length;
  return `<section class="welcome"><div><p class="eyebrow">${esc(dateLabel(today))} · ${thisShift ? esc(PRESETS[thisShift.code].label) : 'MY NOTEBOOK'}</p><h1>${heading}</h1><p>何かあった日だけ、一行。<br class="mobile-break">なければ、何も書かなくて大丈夫。</p><button class="primary" data-action="incident" data-date="${today}">${icon('plus')}今日のひとことを残す</button></div><img class="welcome-ghost mascot-ghost" src="./ghost-mascot.webp" alt="" width="130" height="130"></section>
    <div class="workspace"><section class="calendar-card card"><div class="month-toolbar"><div class="month-title"><span class="eyebrow">${year}</span><h2>${month+1}<span>月の手帳</span></h2></div><div class="month-controls"><button class="icon-button" data-action="month" data-step="-1" aria-label="前の月">${icon('left')}</button><button class="text-button today-button" data-action="today">今日</button><button class="icon-button" data-action="month" data-step="1" aria-label="次の月">${icon('right')}</button></div></div>
    <div class="calendar-tools"><div class="legend"><span><i class="dot incident-dot"></i>事件</span><span><i class="dot event-dot"></i>私用</span></div><button class="text-button batch-toggle ${batch?'selected':''}" data-action="batch">${icon('edit')}${batch?'まとめて登録を終了':'シフトをまとめて登録'}</button></div>
    ${batch ? `<div class="batch-panel"><p>シフトを選んで、日付をタップ。</p><div class="preset-row">${Object.entries(PRESETS).map(([code,p])=>`<button class="preset ${p.color} ${code===batchCode?'chosen':''}" data-action="batch-code" data-code="${code}" aria-pressed="${code===batchCode}">${esc(p.label)}</button>`).join('')}</div></div>` : ''}
    <div class="weekdays" aria-hidden="true">${['月','火','水','木','金','土','日'].map((d,i)=>`<span class="${i===5?'sat':i===6?'sun':''}">${d}</span>`).join('')}</div>
    <div class="month-grid" role="group" aria-label="${year}年${month+1}月の日付">${monthCells(year,month).map(cell=>{
      const s=shiftOn(cell.date), incidents=data.incidents.filter(x=>x.date===cell.date).length, events=data.events.filter(x=>x.date===cell.date);
      return `<button class="day ${!cell.current?'outside':''} ${cell.date===selected?'selected':''} ${cell.date===today?'is-today':''}" data-action="day" data-date="${cell.date}" aria-pressed="${cell.date===selected}" aria-label="${esc(dateLabel(cell.date))} ${s?PRESETS[s.code].label:'シフト未登録'}${incidents?' 事件'+incidents+'件':''}${events.length?' 私用'+events.length+'件':''}"><span class="day-number ${cell.weekday===0?'sun':cell.weekday===6?'sat':''}">${cell.day}</span>${shiftBadge(s)}<span class="day-marks">${incidents?'<i class="dot incident-dot"></i>':''}${events.length?'<i class="dot event-dot"></i>':''}${s&&s.code!=='OFF'&&s.start!==PRESETS[s.code].start?'<span class="early-mark">早</span>':''}</span>${events.length?`<span class="event-peek">${esc(events[0].title)}</span>`:''}</button>`;
    }).join('')}</div><div class="calendar-footer"><span>今月のひとこと <strong>${monthCount}</strong> 件</span><span>小さな仕事も、あとで思い出せる。</span></div></section>
    <aside id="day-detail" class="day-detail">${dayDetail()}</aside></div>
    <p class="quiet-note">${icon('book')}記録することを、新しい仕事にしない。</p>`;
}
function dayDetail() {
  const s=shiftOn(selected), events=data.events.filter(x=>x.date===selected).sort((a,b)=>(a.time||'').localeCompare(b.time||'')), incidents=data.incidents.filter(x=>x.date===selected);
  return `<section class="card detail-card"><div class="detail-heading"><div><p class="eyebrow">${selected===today?'TODAY':'SELECTED DAY'}</p><h2>${esc(dateLabel(selected))}</h2></div>${shiftBadge(s,true)}</div>
    <div class="shift-detail"><div><span class="field-caption">勤務シフト</span><strong>${esc(shiftedTime(s))}</strong>${s&&s.code!=='OFF'&&s.start!==PRESETS[s.code].start?'<span class="tiny-label">早朝</span>':''}</div><button class="small-button" data-action="shift" data-date="${selected}">${s?'変更':'登録'}</button></div>
    ${s&&s.code!=='OFF'?`<div class="reminder-line">${icon('bell')}<span>${bellTime(s)} に声かけ${!settings.reminderEnabled?'予定 · 通知は未設定':''}</span></div>`:''}
    <div class="section-row"><h3><i class="dot event-dot"></i>私用の予定</h3><button class="icon-button small" data-action="event" data-date="${selected}" aria-label="私用の予定を追加">${icon('plus')}</button></div>
    ${events.length?events.map(e=>`<button class="event-item" data-action="edit-event" data-id="${e.id}"><span class="event-time">${esc(e.time||'終日')}</span><span>${esc(e.title)}</span>${icon('right')}</button>`).join(''):'<p class="empty-line">予定はまだありません。</p>'}
    <div class="section-row incident-heading"><h3><i class="dot incident-dot"></i>ひとこと事件</h3><span class="count-pill">${incidents.length}</span></div>
    ${incidents.length?incidents.map(e=>`<button class="incident-note" data-action="edit-incident" data-id="${e.id}"><span>${esc(e.body)}</span>${icon('edit')}</button>`).join(''):`<div class="empty-incident"><span class="little-ghost">👻</span><p>何かあったら、ここに一行。</p><span>出来事と、自分がしたことだけ。</span></div>`}
    <button class="secondary wide" data-action="incident" data-date="${selected}">${icon('plus')}ひとことを残す</button></section>`;
}
function historyPage() {
  return `<section class="page-intro"><p class="eyebrow">LITTLE THINGS, WELL REMEMBERED</p><h1>あの日のひとこと。</h1><p>あとから「そういえば！」を見つける場所。</p></section>
    <div class="history-toolbar"><label class="search-field">${icon('search')}<input id="search" type="search" placeholder="雨漏り、連携、掲示物…" aria-label="事件簿を検索" value="${esc(search)}"></label><button class="secondary export-button" data-action="export-md">${icon('download')}書き出す</button></div>
    <div id="history-results">${historyResults()}</div>`;
}
function historyResults() {
  const q=search.trim().toLowerCase();
  const records=[...data.incidents].filter(x=>`${x.date} ${x.body}`.toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));
  return `<p class="results-count">${records.length} 件のひとこと</p>${records.length?`<div class="history-list">${records.map(e=>`<article class="card history-card"><div class="history-date"><span>${esc(dateLabel(e.date,true))}</span>${shiftBadge(shiftOn(e.date))}</div><p>${esc(e.body)}</p><div class="history-actions"><button class="text-button" data-action="jump" data-date="${e.date}">この日の手帳 ${icon('arrow')}</button><button class="icon-button small" data-action="edit-incident" data-id="${e.id}" aria-label="${e.date}の事件を編集">${icon('edit')}</button></div></article>`).join('')}</div>`:`<section class="card empty-history"><img src="./icon.svg" width="84" height="84" alt=""><h2>${q?'該当するひとことはありません。':'まだ、まっさらな事件簿。'}</h2><p>${q?'別の言葉でも探してみてね。':'何かあった日から、少しずつ。'}</p><button class="primary" data-action="incident" data-date="${today}">${icon('plus')}ひとことを残す</button></section>`}`;
}
function settingsPage() {
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<section class="page-intro"><p class="eyebrow">MAKE YOURSELF AT HOME</p><h1>手帳の設定</h1><p>気楽に続けられる、自分のペースに。</p></section><div class="settings-grid">
    <section class="card settings-card"><h2>${icon('bell')}声かけのタイミング</h2><p>勤務日の終業前に、一回だけ。<br>休みや私用の予定だけの日には送りません。</p><label class="form-label">終業の何分前？<select id="reminder-offset">${[30,60,90,120].map(n=>`<option value="${n}" ${settings.minutesBefore===n?'selected':''}>${n===60?'1時間':n===120?'2時間':n+'分'}前</option>`).join('')}</select></label><div class="schedule-preview">${['A','A+','B','C'].map(code=>`<span>${code}<strong>${bellTime(shiftFor(today,code))}</strong></span>`).join('')}</div>
    <div class="notification-copy"><strong>今日はひとこと事件ある？ 👻</strong><span>あれば一行。なければスルーでOK。</span></div>
    <p class="connection-hint">${!user?'通知にはクラウド接続とログインが必要です。':!standalone&&/iPhone|iPad/.test(navigator.userAgent)?'iPhoneでは、Safariの共有 → ホーム画面に追加。そのアイコンから開いてください。':settings.reminderEnabled?'通知の配信設定は有効です。端末でも受信を確認してください。':'通知を許可して、テスト通知で受信を確認してください。'}</p>
    <button class="primary wide" data-action="enable-push" ${!user||!connection.vapidPublicKey?'disabled':''}>${icon('bell')}この端末で通知を有効にする</button>${user?`<div class="inline-actions"><button class="text-button" data-action="test-push" ${!settings.reminderEnabled?'disabled':''}>テスト通知を送る</button><button class="text-button" data-action="disable-push" ${!settings.reminderEnabled?'disabled':''}>声かけを停止</button></div>`:''}
    ${user&&!connection.vapidPublicKey?'<p class="form-help">通知サーバーの設定がまだです。保存は使えます。</p>':''}</section>
    <section class="card settings-card"><h2>${icon('cloud')}記録の保存先</h2><div class="storage-status"><i class="status-dot"></i><strong>${user?'ログイン中':'この端末に保存中'}</strong></div><p>${user?esc(user.email)+'<br>自分のアカウントの記録を表示しています。':'今はこのブラウザに保存します。<br>クラウド未接続のため、他の端末とは同期しません。'}</p>
    ${user?`<div class="stack"><button class="secondary wide" data-action="refresh">${icon('cloud')}最新の記録を読み込む</button><button class="secondary wide" data-action="copy-local">端末の記録をクラウドへコピー</button><button class="text-button" data-action="logout">ログアウト</button></div>`:`<button class="secondary wide" data-action="connect">クラウド接続・ログイン</button>`}</section>
    <section class="card settings-card"><h2>${icon('download')}記録を持ち出す</h2><p>半年後の振り返りや、お引っ越しに。<br>私用の予定は事件簿の書き出しに含めません。</p><div class="stack"><button class="secondary wide" data-action="export-md">事件簿を文章で書き出す</button><button class="secondary wide" data-action="export-json">手帳まるごとバックアップ</button><label class="file-button secondary wide">バックアップを読み込む<input id="import-file" type="file" accept="application/json,.json"></label></div><p class="form-help">端末保存の場合、ブラウザのデータを消すと記録も消えます。ときどきバックアップを。</p></section>
    <section class="card settings-card promise"><img src="./icon.svg" width="52" height="52" alt=""><h2>この手帳のやくそく</h2><p>毎日書かなくていい。<br>成果分析も、反省も、今はいらない。<br>「何があって、自分が何をしたか」だけ。</p><p class="form-help">利用者の名前や施設の秘密は、書かずに残そう。</p></section></div>`;
}
function openDialog(title, content) {
  if($('#editor').open)$('#editor').close();
  $('#editor').innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close" aria-label="閉じる">${icon('close')}</button></div>${content}`;
  $('#editor').showModal();
}
function shiftDialog(date) {
  const s=shiftOn(date),code=s?.code||'A',early=s&&s.code!=='OFF'&&s.start!==PRESETS[s.code].start?s.start:'';
  openDialog('勤務シフト',`<p class="dialog-subtitle">${esc(dateLabel(date))}</p><form id="shift-form" method="dialog"><input type="hidden" name="date" value="${date}"><fieldset class="shift-choices"><legend>シフトを選ぶ</legend>${Object.entries(PRESETS).map(([id,p])=>`<label class="shift-choice ${p.color}"><input type="radio" name="code" value="${id}" ${id===code?'checked':''}><span><strong>${esc(p.label)}</strong><small>${id==='OFF'?'ゆっくり休もう':p.start+'–'+p.end}</small></span></label>`).join('')}</fieldset><label class="form-label">早朝出勤の日だけ<select name="early" ${code==='OFF'?'disabled':''}><option value="">通常の開始時刻</option><option value="07:30" ${early==='07:30'?'selected':''}>7:30から</option><option value="08:00" ${early==='08:00'?'selected':''}>8:00から</option></select></label><p class="form-help">終了時刻はそのまま。声かけは終業時刻に合わせます。</p><div class="dialog-actions">${s?'<button type="button" class="text-button danger" data-action="delete-shift" data-date="'+date+'">登録を外す</button>':''}<button class="primary" type="submit">${icon('check')}保存する</button></div></form>`);
}
function eventDialog(date, event) {
  openDialog(event?'予定の編集':'私用の予定',`<form id="event-form" method="dialog"><input name="entryId" type="hidden" value="${event?.id||''}"><label class="form-label">日付<input type="date" name="date" required value="${date}"></label><label class="form-label">予定<input name="title" maxlength="200" required placeholder="通院、買い物、友だちとごはん…" value="${esc(event?.title||'')}"></label><label class="form-label">時刻 <span class="optional">空欄なら終日</span><input type="time" name="time" value="${event?.time||''}"></label><div class="dialog-actions">${event?`<button type="button" class="text-button danger" data-action="delete-event" data-id="${event.id}">削除</button>`:''}<button class="primary" type="submit">${icon('check')}保存する</button></div></form>`);
}
function incidentDialog(date, incident) {
  openDialog(incident?'ひとことを編集':'ひとこと事件を残す',`<p class="dialog-subtitle">出来事と、自分がしたこと。それだけで十分。</p><form id="incident-form" method="dialog"><input type="hidden" name="entryId" value="${incident?.id||''}"><label class="form-label">日付<input type="date" name="date" required value="${date}"></label><label class="form-label">今日のひとこと<textarea name="body" required maxlength="600" rows="5" placeholder="例：天井の雨漏り。設備担当と連携して応急処置、上席へ引き継いだ。">${esc(incident?.body||'')}</textarea></label><p class="form-help">短くてOK。個人名や秘密の情報は伏せてね。</p><div class="dialog-actions">${incident?`<button type="button" class="text-button danger" data-action="delete-incident" data-id="${incident.id}">削除</button>`:''}<button class="primary" type="submit">${icon('check')}残しておく</button></div></form>`);
}
function connectionDialog() {
  openDialog('自分の手帳にログイン',`<p class="dialog-subtitle">初めての方は、メールアドレスとパスワードを入れて「アカウント作成」を押してください。</p><form id="connection-form" method="dialog"><label class="form-label">メールアドレス<input type="email" name="email" autocomplete="username" required></label><label class="form-label">パスワード<input type="password" name="password" autocomplete="current-password" minlength="8" required></label><p class="form-help">自分のアカウントの記録だけを読み書きできます。パスワードは設定ファイルに保存しません。</p><div class="dialog-actions"><button class="secondary" type="submit" name="intent" value="signup">アカウント作成</button><button class="primary" type="submit" name="intent" value="login">ログイン</button></div><details class="connection-details" ${!connection.supabaseUrl?'open':''}><summary>接続先の設定</summary><label class="form-label">プロジェクトURL<input name="url" type="url" required placeholder="https://….supabase.co" value="${esc(connection.supabaseUrl||'')}"></label><label class="form-label">公開キー<input name="key" required autocomplete="off" placeholder="Publishable key / anon key" value="${esc(connection.supabasePublishableKey||'')}"></label><label class="form-label">通知用の公開キー <span class="optional">任意</span><input name="vapid" autocomplete="off" value="${esc(connection.vapidPublicKey||'')}"></label><p class="form-help">設定済みなら変更不要です。管理者用の秘密キーは入力しません。</p></details></form>`);
}
async function cloudClient(config=connection) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl||'')) throw new Error('SupabaseのプロジェクトURLを確認してください。');
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.106.2');
  return createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{storageKey:'hitokoto-auth-v1'}});
}
async function rows(table) {
  const all=[];
  for (let start=0;;start+=500) {
    const {data:part,error}=await client.from('jikenbo_'+table).select('*').eq('user_id',user.id).order(table==='settings'?'user_id':table==='shifts'?'date':'id').range(start,start+499);
    if(error)throw error; all.push(...part); if(part.length<500)break;
  }
  return all;
}
async function loadCloud() {
  const [shifts,events,incidents,prefs]=await Promise.all(['shifts','events','incidents','settings'].map(rows));
  // Postgres time values include seconds; the notebook stores minute precision.
  const next=validateBackup({app:'hitokoto-jikenbo',version:1,data:{shifts:shifts.map(s=>({...s,start:s.start?.slice(0,5)||null,end:s.end?.slice(0,5)||null})),events:events.map(e=>({...e,time:e.time?.slice(0,5)||null})),incidents}});
  data=next;
  settings={...DEFAULT_SETTINGS,...(prefs[0]?{minutesBefore:prefs[0].minutes_before,reminderEnabled:prefs[0].reminder_enabled}:{})};
  cloudError=false;
}
async function saveItem(kind, item, remove=false) {
  if(!user&&localCorrupt)throw new Error('保存データを読み込めていないため、上書きを止めています。バックアップを読み込むか、クラウドへ接続してください。');
  if(user) {
    let query;
    if(remove) {
      query=client.from('jikenbo_'+kind).delete().eq('user_id',user.id).eq(kind==='shifts'?'date':'id',kind==='shifts'?item.date:item.id);
    } else query=client.from('jikenbo_'+kind).upsert({...item,user_id:user.id},{onConflict:kind==='shifts'?'user_id,date':'id'});
    const {error}=await query;if(error)throw error;
  }
  const key=kind==='shifts'?'date':'id';
  const next={...data,[kind]:data[kind].filter(x=>x[key]!==item[key])};
  if(!remove)next[kind].push(item);
  if(!user)storeLocal(next);
  data=next;
}
async function savePreferences(next) {
  if(user) {
    const {error}=await client.from('jikenbo_settings').upsert({user_id:user.id,minutes_before:next.minutesBefore,reminder_enabled:next.reminderEnabled},{onConflict:'user_id'});
    if(error)throw error;
  } else localStorage.setItem(PREFS,JSON.stringify(next));
  settings=next;
}
async function run(task) {
  if(busy)return;
  busy=true; document.body.classList.add('busy');
  document.querySelectorAll('#editor button[type="submit"]').forEach(b=>b.disabled=true);
  try { await task(); } catch(error) { console.error(error); toast(error.message||'保存できませんでした。接続を確認してもう一度試してください。',true); }
  finally {busy=false;document.body.classList.remove('busy');document.querySelectorAll('#editor button[type="submit"]').forEach(b=>b.disabled=false);}
}
function download(name,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function base64Bytes(value) { const encoded=value.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(encoded+'='.repeat((4-encoded.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function enablePush() {
  if(!user)throw new Error('先にクラウドへログインしてください。');
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(/iPhone|iPad/.test(navigator.userAgent)&&!standalone)throw new Error('Safariの共有からホーム画面に追加して、そのアイコンから開いてください。');
  if(!('PushManager' in window)||!('Notification' in window)||!sw)throw new Error('この環境では通知を設定できません。iPhoneのホーム画面から開いてください。');
  if(!connection.vapidPublicKey)throw new Error('通知サーバーの公開キーがまだ設定されていません。');
  if(await Notification.requestPermission()!=='granted')throw new Error('通知が許可されていません。iPhoneの通知設定を確認してください。');
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64Bytes(connection.vapidPublicKey)});
  const {error}=await client.from('jikenbo_push_subscriptions').upsert({user_id:user.id,endpoint:subscription.endpoint,subscription:subscription.toJSON()},{onConflict:'user_id,endpoint'});
  if(error)throw error;
  await savePreferences({...settings,reminderEnabled:true});
  render();toast('通知の配信設定を保存しました。テスト通知で受信を確認してね。');
}
async function importData(incoming) {
  const next=mergeData(data,incoming);
  if(user) {
    // Import is atomic on the server; a failed table cannot leave a half-imported backup.
    const {error}=await client.rpc('jikenbo_import',{payload:incoming});if(error)throw error;
  } else storeLocal(next);
  data=next;localCorrupt=false;
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action,date=button.dataset.date,id=button.dataset.id;
  if(action==='close'){if(!busy)$('#editor').close();return;}
  if(action==='view'){view=button.dataset.view;render();window.scrollTo({top:0});return;}
  if(action==='month'){cursor=new Date(cursor.getFullYear(),cursor.getMonth()+Number(button.dataset.step),1,12);render();return;}
  if(action==='today'){today=localDate();selected=today;cursor=new Date(today+'T12:00:00+09:00');render();return;}
  if(action==='batch'){batch=!batch;render();return;}
  if(action==='batch-code'){batchCode=button.dataset.code;render();return;}
  if(action==='day'){selected=date;if(batch)run(async()=>{await saveItem('shifts',shiftFor(date,batchCode));render();toast(PRESETS[batchCode].label+'を登録しました');});else render();return;}
  if(action==='shift'){shiftDialog(date);return;}
  if(action==='incident'){incidentDialog(date);return;}
  if(action==='event'){eventDialog(date);return;}
  if(action==='edit-event'){const e=data.events.find(x=>x.id===id);if(e)eventDialog(e.date,e);return;}
  if(action==='edit-incident'){const e=data.incidents.find(x=>x.id===id);if(e)incidentDialog(e.date,e);return;}
  if(action==='jump'){view='calendar';selected=date;cursor=new Date(date+'T12:00:00+09:00');render();window.scrollTo({top:0});return;}
  if(action==='connect'){connectionDialog();return;}
  if(action==='export-md'){download('ひとこと事件簿-'+today+'.md',incidentMarkdown(data),'text/markdown;charset=utf-8');return;}
  if(action==='export-json'){download('ひとこと手帳-'+today+'.json',JSON.stringify({app:'hitokoto-jikenbo',version:1,exportedAt:new Date().toISOString(),data},null,2),'application/json');return;}
  if(action.startsWith('delete-')) {
    const kind={'delete-shift':'shifts','delete-event':'events','delete-incident':'incidents'}[action];
    if(!kind||!confirm('この'+(kind==='shifts'?'シフト登録':kind==='events'?'予定':'ひとこと')+'を削除しますか？'))return;
    run(async()=>{await saveItem(kind,kind==='shifts'?{date}:{id},true);$('#editor').close();render();toast('削除しました');});return;
  }
  if(action==='enable-push'){run(enablePush);return;}
  if(action==='disable-push'){run(async()=>{await savePreferences({...settings,reminderEnabled:false});render();toast('勤務日の声かけを停止しました');});return;}
  if(action==='test-push'){run(async()=>{const {error}=await client.functions.invoke('remind',{body:{test:true}});if(error)throw new Error('テスト通知を送れませんでした。通知サーバーの設定を確認してください。');toast('テスト通知の送信を依頼しました。iPhoneで届くか確認してね。');});return;}
  if(action==='refresh'){run(async()=>{try{await loadCloud();render();toast('最新の記録を読み込みました');}catch(e){cloudError=true;render();throw e;}});return;}
  if(action==='logout'){run(async()=>{
    // Stop this device's subscription before sign-out to avoid notifications for a signed-out account.
    const subscription=sw?await (await navigator.serviceWorker.ready).pushManager?.getSubscription():null;
    if(subscription){const {error}=await client.from('jikenbo_push_subscriptions').delete().eq('user_id',user.id).eq('endpoint',subscription.endpoint);if(error)throw error;await subscription.unsubscribe();}
    const {error}=await client.auth.signOut();if(error)throw error;user=null;client=null;data=readLocal();settings=readSettings();cloudError=false;render();toast('ログアウトしました');
  });return;}
  if(action==='copy-local'){run(async()=>{const incoming=readLocal();if(!countAll(incoming)){toast('コピーする端末の記録はありません');return;}if(!confirm('このブラウザの記録をクラウドへコピーします。同じ日付のシフト・同じIDの記録は上書きされます。よろしいですか？'))return;await importData(incoming);render();toast('端末の記録をクラウドへコピーしました');});}
});
document.addEventListener('submit',event=>{
  const form=event.target;const formId=form.getAttribute("id");if(!['shift-form','event-form','incident-form','connection-form'].includes(formId))return;
  event.preventDefault();const values=Object.fromEntries(new FormData(form));values.intent=event.submitter?.value||'login';
  run(async()=>{
    if(formId==='shift-form'){await saveItem('shifts',shiftFor(values.date,values.code,values.code==='OFF'?'':values.early));selected=values.date;}
    if(formId==='event-form'){
      if(!validDate(values.date)||!values.title.trim()||(values.time&&!validTime(values.time)))throw new Error('日付と予定を確認してください。');
      await saveItem('events',{id:values.entryId||crypto.randomUUID(),date:values.date,title:values.title.trim(),time:values.time||null});selected=values.date;
    }
    if(formId==='incident-form'){
      if(!validDate(values.date)||!values.body.trim())throw new Error('日付とひとことを確認してください。');
      await saveItem('incidents',{id:values.entryId||crypto.randomUUID(),date:values.date,body:values.body.trim()});selected=values.date;
    }
    if(formId==='connection-form'){
      if(values.key.startsWith('sb_secret_'))throw new Error('秘密キーではなく、公開キーを入力してください。');
      if(values.key.startsWith('eyJ')){try{const payload=JSON.parse(atob(values.key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw new Error('not-anon');}catch{throw new Error('anonの公開キーを入力してください。管理者用のキーは使いません。');}}
      const config={supabaseUrl:values.url.replace(/\/$/,''),supabasePublishableKey:values.key.trim(),vapidPublicKey:values.vapid.trim()};
      const nextClient=await cloudClient(config);
      let session;
      if(values.intent==='signup'){
        const result=await nextClient.auth.signUp({email:values.email,password:values.password,options:{emailRedirectTo:location.protocol==='https:'?new URL('./',location.href).href:undefined}});
        if(result.error)throw new Error('アカウントを作成できませんでした。入力内容を確認してください。 '+result.error.message);
        if(!result.data.session){
          openDialog('メールを確認してね',`<p class="dialog-subtitle">${esc(values.email)} の確認メールを開いてください。メールの確認後、この手帳に戻ってログインできます。</p><button type="button" class="primary wide" data-action="connect">ログイン画面へ</button>`);
          return;
        }
        session=result.data;
      } else {
        const result=await nextClient.auth.signInWithPassword({email:values.email,password:values.password});
        if(result.error)throw new Error('ログインできませんでした。メールアドレスとパスワード、確認メールを確認してください。');
        session=result.data;
      }
      // Never show another account's data while loading.
      const prior={client,user,data,settings};client=nextClient;user=session.user;
      try{await loadCloud();}catch(e){await nextClient.auth.signOut();Object.assign(connection,{});client=prior.client;user=prior.user;data=prior.data;settings=prior.settings;throw new Error('ログイン後の読み込みに失敗しました。データベースの設定を確認してください。');}
      connection=config;localStorage.setItem(CONFIG_KEY,JSON.stringify(config));
    }
    $('#editor').close();render();toast(formId==='connection-form'?'クラウドへ接続しました':'保存しました');
  });
});
document.addEventListener('change',event=>{
  if(event.target.name==='code'&&event.target.form?.id==='shift-form')event.target.form.elements.early.disabled=event.target.value==='OFF';
  if(event.target.id==='reminder-offset'){
    const minutesBefore=Number(event.target.value);run(async()=>{await savePreferences({...settings,minutesBefore});render();toast('声かけの時刻を変更しました');});
  }
  if(event.target.id==='import-file'){
    const file=event.target.files[0];if(!file)return;
    run(async()=>{if(file.size>10000000)throw new Error('10MB以下のバックアップを選んでください。');const incoming=validateBackup(JSON.parse(await file.text()));if(!confirm(`${countAll(incoming)}件を読み込みます。同じ日付のシフト・同じIDの記録は上書きされます。よろしいですか？`))return;await importData(incoming);render();toast('バックアップを読み込みました');});event.target.value='';
  }
});
document.addEventListener('input',event=>{if(event.target.id==='search'){search=event.target.value;$('#history-results').innerHTML=historyResults();}});
$('#editor').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type==='open-incident'){
    const url=new URL(event.data.url);const date=url.searchParams.get('date');if(!validDate(date))return;
    selected=date;cursor=new Date(date+'T12:00:00+09:00');view='calendar';render();if($('#editor').open)$('#editor').close();incidentDialog(date);
  }
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&today!==localDate()){today=localDate();if(!$('#editor').open)render();}
});
async function init() {
  try{data=readLocal();settings=readSettings();}catch{localCorrupt=true;toast('端末の保存データを読み込めませんでした。上書きを止めています。バックアップをご確認ください。',true);}
  render();
  if(location.protocol!=='file:'&&'serviceWorker' in navigator){try{sw=await navigator.serviceWorker.register('./sw.js',{scope:'./'});}catch{toast('オフライン機能を準備できませんでした。通常の保存は利用できます。',true);}}
  if(connection.supabaseUrl&&connection.supabasePublishableKey){
    try{
      client=await cloudClient();const {data:session,error}=await client.auth.getSession();if(error)throw error;
      if(session.session){user=session.session.user;data=emptyData();render();try{await loadCloud();}catch{cloudError=true;toast('クラウドの記録を読み込めませんでした。設定から再読み込みしてください。',true);}render();}
    }catch{client=null;user=null;toast('クラウド接続を確認できませんでした。端末保存の手帳を表示しています。',true);}
  }
  if(pendingDeepLink){pendingDeepLink=false;incidentDialog(selected);history.replaceState({},'',location.pathname);}
}
init();
