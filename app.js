'use strict';
/* Penny Plan — an offline-first budgeting app. Everything lives on this device
   (IndexedDB, mirrored to localStorage). Money is stored as integer cents. */

/* ---------- helpers ---------- */
const KEY = 'pennyplan';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ds(new Date());
const mk = d => d.slice(0, 7);
const thisMonth = () => todayStr().slice(0, 7);
const addMonths = (k, n) => { const [y, m] = k.split('-').map(Number); return ds(new Date(y, m - 1 + n, 1)).slice(0, 7); };
const daysIn = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthsBetween = (a, b) => { const out = []; for (let k = a; k <= b; k = addMonths(k, 1)) out.push(k); return out; };
const monthName = (k, o = { month: 'long', year: 'numeric' }) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, o); };
const dayHead = d => pd(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const sum = (a, f = x => x) => a.reduce((t, x) => t + f(x), 0);
const parseMoney = s => { const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; };
const fmt = (c, round) => new Intl.NumberFormat(undefined, { style: 'currency', currency: S.settings.currency || 'USD', minimumFractionDigits: round ? 0 : 2, maximumFractionDigits: round ? 0 : 2 }).format(c / 100);
const short = c => { const a = Math.abs(c) / 100, s = c < 0 ? '-' : ''; return s + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : Math.round(a)); };
const pct = n => Math.round(n) + '%';

/* ---------- categories ---------- */
// k: need / want / waste.  bill: a recurring monthly bill you could negotiate or trim.
const CATS = [
  { n: 'Rent & Housing', i: '🏠', k: 'need', bill: 1 }, { n: 'Utilities', i: '💡', k: 'need', bill: 1 },
  { n: 'Phone', i: '📱', k: 'need', bill: 1 }, { n: 'Internet', i: '📶', k: 'need', bill: 1 },
  { n: 'Insurance', i: '🛡️', k: 'need', bill: 1 }, { n: 'Groceries', i: '🛒', k: 'need' },
  { n: 'Transportation', i: '⛽', k: 'need' }, { n: 'Tuition & Books', i: '🎓', k: 'need' },
  { n: 'Health', i: '💊', k: 'need' }, { n: 'Dining Out', i: '🍔', k: 'want' },
  { n: 'Coffee & Snacks', i: '☕', k: 'want' }, { n: 'Subscriptions', i: '📺', k: 'want', bill: 1 },
  { n: 'Entertainment', i: '🎮', k: 'want' }, { n: 'Shopping', i: '🛍️', k: 'want' },
  { n: 'Personal Care', i: '💈', k: 'want' }, { n: 'Travel', i: '✈️', k: 'want' },
  { n: 'Fees & Interest', i: '⚠️', k: 'waste' }, { n: 'Other', i: '📦', k: 'want' },
];
const CAT = Object.fromEntries(CATS.map(c => [c.n, c]));
const catIcon = x => x.t === 'inc' ? '💵' : x.t === 'sav' ? '🐷' : (CAT[x.c]?.i || '📦');
const KIND = { need: ['Needs', 'var(--sav)'], want: ['Wants', 'var(--warn)'], waste: ['Waste', 'var(--exp)'] };

/* ---------- state + storage ---------- */
let S = blank();
function blank() {
  return {
    v: 1, tx: [], recurs: [], budgets: {}, lastBackup: null, created: todayStr(),
    goals: [{ id: 'g-emergency', name: 'Emergency fund', target: 100000 }],
    settings: { name: '', saveRate: 20, currency: 'USD', onboarded: false },
  };
}
function norm(d) {
  const b = blank();
  return {
    ...b, ...d,
    settings: { ...b.settings, ...(d.settings || {}) },
    tx: (d.tx || []).filter(x => x && x.d && x.a > 0 && ['inc', 'exp', 'sav'].includes(x.t)),
    recurs: d.recurs || [], goals: d.goals || b.goals, budgets: d.budgets || {},
  };
}
let dbp;
const idb = () => dbp || (dbp = new Promise((res, rej) => {
  const r = indexedDB.open('pennyplan', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const DB = {
  async get() {
    try {
      const db = await idb();
      const v = await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get('state'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      if (v) return v;
    } catch (e) { /* fall through to localStorage */ }
    try { const j = localStorage.getItem(KEY); return j ? JSON.parse(j) : null; } catch (e) { return null; }
  },
  async set(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* mirror only */ }
    try {
      const db = await idb();
      await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, 'state'); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch (e) { toast('⚠️ Could not save to this device'); }
  },
};
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => DB.set(S), 120); }
window.addEventListener('pagehide', () => DB.set(S));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') DB.set(S); });

/* ---------- calculations ---------- */
const monthTx = k => S.tx.filter(x => x.d.startsWith(k));
function stats(list) {
  let inc = 0, exp = 0, sav = 0; const cat = {};
  for (const x of list) {
    if (x.t === 'inc') inc += x.a;
    else if (x.t === 'exp') { exp += x.a; cat[x.c] = (cat[x.c] || 0) + x.a; } else sav += x.a;
  }
  return { inc, exp, sav, left: inc - exp - sav, cat };
}
const firstMonth = () => S.tx.length ? S.tx.reduce((m, x) => x.d < m ? x.d : m, '9999-99-99').slice(0, 7) : null;
const target = inc => Math.round(inc * S.settings.saveRate / 100);
function streak() {
  const first = firstMonth(); if (!first) return 0;
  let k = addMonths(thisMonth(), -1), n = 0;
  while (k >= first) {
    const st = stats(monthTx(k));
    if (st.inc > 0 && st.sav > 0 && st.sav >= target(st.inc)) n++; else break;
    k = addMonths(k, -1);
  }
  return n;
}
const totalSaved = () => sum(S.tx.filter(x => x.t === 'sav'), x => x.a);
const goalSaved = g => sum(S.tx.filter(x => x.t === 'sav' && x.g === g.id), x => x.a);
const uniq = (t) => [...new Set(S.tx.filter(x => x.t === t && x.p).map(x => x.p.trim()))].sort((a, b) => a.localeCompare(b));
function genRecurring() {
  let added = 0; const today = todayStr(), cur = thisMonth();
  for (const r of S.recurs) {
    if (!r.on) continue;
    for (let k = addMonths(r.start.slice(0, 7), 1); k <= cur; k = addMonths(k, 1)) {
      if ((r.skip || []).includes(k) || S.tx.some(x => x.r === r.id && x.d.startsWith(k))) continue;
      const d = `${k}-${pad(Math.min(r.day, daysIn(k)))}`;
      if (d <= today) { S.tx.push({ id: uid(), t: r.t, d, a: r.a, p: r.p, c: r.c, g: r.g || '', n: '', r: r.id }); added++; }
    }
  }
  if (added) save();
  return added;
}

/* ---------- money-saving tips (rule based, computed from the user's own data) ---------- */
const BENCH = { 'Dining Out': .10, 'Coffee & Snacks': .03, 'Entertainment': .05, 'Shopping': .06, 'Personal Care': .03, 'Travel': .04 };
function tips() {
  const out = [];
  const keys = monthsBetween(firstMonth() || thisMonth(), thisMonth()).filter(k => monthTx(k).length).slice(-3);
  if (!keys.length) return out;
  const n = keys.length, win = S.tx.filter(x => keys.includes(mk(x.d)));
  const st = stats(win), avg = c => (st.cat[c] || 0) / n, inc = st.inc / n;
  const add = (i, title, body, save = 0) => out.push({ i, title, body, save: Math.round(save) });
  const m = c => fmt(avg(c), true), flagged = new Set(); // categories already covered by their own tip

  if (avg('Phone') > 4000) add('📱', `Phone: ${m('Phone')}/mo`, 'Prepaid carriers (Mint, Visible, Cricket, US Mobile) usually run $15–30/mo on the same networks. Or ask about a family or friends plan.', avg('Phone') - 3000);
  if (avg('Internet') > 6000) add('📶', `Internet: ${m('Internet')}/mo`, 'Split it with roommates, ask the provider for their promo or student rate, or drop to a slower tier — most people can’t tell the difference.', avg('Internet') - 5000);
  if (avg('Utilities') > 12000) add('💡', `Utilities: ${m('Utilities')}/mo`, 'LED bulbs, cold-water laundry, and 2° off the thermostat in winter (2° up in summer) can trim 10–15%. Unplug chargers and gaming consoles when away.', avg('Utilities') * .12);
  if (avg('Insurance') > 0) add('🛡️', `Insurance: ${m('Insurance')}/mo`, 'Get 3 fresh quotes once a year and ask for a good-student discount (a B average often saves 5–25%). Raising your deductible lowers the premium too.', avg('Insurance') * .1);
  if (inc > 0 && avg('Rent & Housing') / inc > .4) add('🏠', `Housing is ${pct(avg('Rent & Housing') / inc * 100)} of income`, 'Aim for about 30–35%. A roommate, a cheaper lease renewal, or asking for a lower rent in exchange for a longer lease can make a big difference.', avg('Rent & Housing') - inc * .35);
  const subs = [...new Set(win.filter(x => x.t === 'exp' && x.c === 'Subscriptions').map(x => x.p.trim().toLowerCase()))];
  if (avg('Subscriptions') > 1500) add('📺', `${subs.length} subscription${subs.length === 1 ? '' : 's'} · ${m('Subscriptions')}/mo`, 'Cancel anything you haven’t opened in 30 days. Use student pricing (Spotify, Apple, Amazon Prime, YouTube) and share family plans — often half price.', avg('Subscriptions') * .35);
  for (const [c, b] of Object.entries(BENCH)) {
    if (inc > 0 && avg(c) > inc * b * 1.15 && avg(c) > 2000) flagged.add(c), add(CAT[c].i, `${c}: ${pct(avg(c) / inc * 100)} of income`, `A common guide is around ${pct(b * 100)}. Getting there would free up ${fmt(avg(c) - inc * b, true)} a month. Try a weekly cap you can see in your History tab.`, avg(c) - inc * b);
  }
  if (inc > 0 && avg('Groceries') / inc > .2) add('🛒', `Groceries: ${pct(avg('Groceries') / inc * 100)} of income`, 'Plan 4–5 meals, shop with a list, buy store brands, and use the cheapest nearby store. Meal-prepping beats takeout by a mile.', avg('Groceries') - inc * .17);
  if (avg('Fees & Interest') > 0) add('⚠️', `Fees & interest: ${m('Fees & Interest')}/mo`, 'This is money for nothing. Turn on low-balance alerts, autopay at least the minimum, and ask your bank to waive the first overdraft fee.', avg('Fees & Interest'));
  const small = win.filter(x => x.t === 'exp' && x.a < 800 && CAT[x.c]?.k !== 'need' && !CAT[x.c]?.bill && !flagged.has(x.c));
  if (small.length >= 8 * n) add('🧋', `${Math.round(small.length / n)} small buys a month`, `Purchases under $8 add up to ${fmt(sum(small, x => x.a) / n, true)}/mo — ${fmt(sum(small, x => x.a) / n * 12, true)} a year. Skip half of them and you keep the difference.`, sum(small, x => x.a) / n * .5);
  if (n >= 2) {
    const cur = stats(monthTx(thisMonth())), prior = keys.filter(k => k !== thisMonth());
    if (prior.length && cur.exp > 0) for (const c of Object.keys(cur.cat)) {
      const base = sum(prior, k => stats(monthTx(k)).cat[c] || 0) / prior.length;
      if (CAT[c]?.k !== 'need' && cur.cat[c] > base * 1.3 && cur.cat[c] - base > 2000) add('📈', `${c} is up this month`, `${fmt(cur.cat[c], true)} so far vs. a usual ${fmt(base, true)}. Check History to see what changed.`, cur.cat[c] - base);
    }
  }
  const cm = stats(monthTx(thisMonth()));
  if (cm.inc > 0 && cm.left < 0) add('🚨', 'You’re over budget this month', 'Spending plus savings is more than you’ve earned. Start by pausing "wants" for the rest of the month and see Insights for the biggest ones.', 0);
  return out.sort((a, b) => b.save - a.save);
}

/* ---------- small UI plumbing ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
function openSheet(html, mount) {
  closeSheet();
  const el = document.createElement('div'); el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(el); document.body.classList.add('noscroll');
  $('.sheet-bg', el).addEventListener('click', closeSheet);
  const sh = $('.sheet', el); if (mount) mount(sh);
  return sh;
}
function closeSheet() { document.querySelectorAll('.sheet-wrap').forEach(e => e.remove()); document.body.classList.remove('noscroll'); }
function ask(title, msg, ok = 'OK', danger) {
  return new Promise(res => openSheet(`<h3>${esc(title)}</h3><p class="mute">${esc(msg)}</p><div class="row" style="margin-top:14px"><button class="btn grow" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'} grow" data-ok>${esc(ok)}</button></div>`, sh => {
    $('[data-no]', sh).onclick = () => { closeSheet(); res(false); };
    $('[data-ok]', sh).onclick = () => { closeSheet(); res(true); };
  }));
}

/* ---------- charts (inline SVG, no libraries) ---------- */
const nice = v => { if (v <= 0) return 0; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
function barChart(labels, series, label) {
  const W = 340, H = 168, pl = 34, pr = 4, pt = 8, pb = 20;
  const all = series.flatMap(s => s.v);
  let hi = nice(Math.max(0, ...all)), lo = Math.min(0, ...all) < 0 ? -nice(-Math.min(0, ...all)) : 0;
  if (!hi && !lo) hi = 10000;
  const y = v => pt + (hi - v) / (hi - lo) * (H - pt - pb);
  const n = labels.length, gw = (W - pl - pr) / n, k = series.length, bw = Math.min(18, gw * .8 / k);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  const ticks = [...new Set([hi, hi / 2, 0, lo])];
  for (const t of ticks) s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl - 4}" y="${y(t) + 3}" text-anchor="end">${t === 0 ? '0' : '$' + short(t)}</text>`;
  series.forEach((sr, i) => sr.v.forEach((v, j) => {
    const x = pl + j * gw + gw / 2 - k * bw / 2 + i * bw, y0 = y(0), y1 = y(v);
    const col = typeof sr.color === 'function' ? sr.color(v) : sr.color;
    s += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="2" fill="${col}"/>`;
  }));
  labels.forEach((l, j) => { if (n > 14 && j % 2) return; s += `<text x="${(pl + j * gw + gw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  return s + '</svg>';
}
function hbars(rows, color) { // rows: [{l, v, sub, extra}]
  const max = Math.max(1, ...rows.map(r => r.v));
  return rows.map(r => `<div class="catrow"><div class="top"><span>${r.l}</span><span><b>${r.v != null ? fmt(r.v, true) : ''}</b>${r.extra || ''}</span></div><div class="bar"><i style="width:${r.v / max * 100}%;${color ? 'background:' + color : ''}"></i></div>${r.sub ? `<div class="small mute" style="margin-top:3px">${r.sub}</div>` : ''}</div>`).join('');
}

/* ---------- views ---------- */
let route = 'home', viewMonth = thisMonth(), hFilter = 'all', hQuery = '', insRange = 6, sheetBusy = false;
const view = () => $('#view');
const head = (title, extra = '') => `<div class="head"><h1>${title}</h1><div class="row">${extra}<button class="iconbtn" data-act="settings" aria-label="Settings">⚙️</button></div></div>`;
const monthNav = () => `<div class="monthnav"><button data-act="month" data-d="-1" aria-label="Previous month">‹</button><b>${monthName(viewMonth)}</b><button data-act="month" data-d="1" aria-label="Next month" ${viewMonth >= thisMonth() ? 'disabled' : ''}>›</button></div>`;
const txItem = x => `<button class="item" data-act="edit" data-id="${x.id}"><span class="ico">${catIcon(x)}</span><span class="grow"><div class="t">${esc(x.p || (x.t === 'sav' ? (S.goals.find(g => g.id === x.g)?.name || 'Savings') : x.c))}</div><div class="s">${esc(x.t === 'exp' ? x.c : x.t === 'inc' ? 'Income' : 'Moved to savings')}${x.n ? ' · ' + esc(x.n) : ''}${x.r ? ' · 🔁' : ''}</div></span><span class="amt ${x.t}">${x.t === 'exp' ? '−' : x.t === 'inc' ? '+' : ''}${fmt(x.a)}</span></button>`;

function render() {
  route = (location.hash || '#home').slice(1);
  if (!['home', 'history', 'savings', 'insights', 'settings'].includes(route)) route = 'home';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === route));
  view().innerHTML = { home: viewHome, history: viewHistory, savings: viewSavings, insights: viewInsights, settings: viewSettings }[route]();
  if (route === 'history') renderHistoryList();
  if (route === 'savings') mountSavings();
}

function viewHome() {
  const key = viewMonth, st = stats(monthTx(key)), isCur = key === thisMonth(), nTx = monthTx(key).length;
  const base = Math.max(st.inc, st.exp + st.sav, 1), w = v => Math.max(0, v / base * 100);
  const perDay = isCur && st.left > 0 ? Math.floor(st.left / (daysIn(key) - new Date().getDate() + 1)) : 0;
  const recent = monthTx(key).sort((a, b) => b.d.localeCompare(a.d) || (b.id > a.id ? 1 : -1)).slice(0, 5);
  const cats = Object.entries(st.cat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const top = isCur ? tips()[0] : null;
  return head(S.settings.name ? `Hi, ${esc(S.settings.name)} 👋` : 'Penny Plan') + banners() + monthNav() + `
  <div class="card hero">
    <div class="lbl">Left to spend in ${monthName(key, { month: 'long' })}</div>
    <div class="big ${st.left < 0 ? 'exp' : st.inc > 0 ? 'inc' : ''}">${fmt(st.left)}</div>
    ${st.inc > 0 || nTx ? `<div class="eq">${fmt(st.inc, true)} income − ${fmt(st.exp, true)} spent − ${fmt(st.sav, true)} saved</div>
    <div class="stack"><i style="width:${w(st.exp)}%;background:var(--exp)"></i><i style="width:${w(st.sav)}%;background:var(--sav)"></i><i style="width:${w(st.left)}%;background:var(--inc)"></i></div>
    <div class="legend"><span style="--c:var(--exp)">Spent ${fmt(st.exp, true)}</span><span style="--c:var(--sav)">Saved ${fmt(st.sav, true)}</span><span style="--c:var(--inc)">Left ${fmt(Math.max(st.left, 0), true)}</span></div>
    ${perDay > 0 ? `<div class="perday">≈ <b>${fmt(perDay)}</b> a day for the rest of the month</div>` : ''}`
      : `<p class="mute" style="margin:10px 0 14px">Start by adding your income for the month. Then every expense you log shows how much is left.</p><button class="btn primary" data-act="add" data-t="inc">Add income</button>`}
  </div>
  ${motivator(st, isCur, key)}
  ${cats.length ? `<div class="card"><h3>Where it’s going</h3>${cats.map(([c, v]) => { const lim = S.budgets[c]; const r = lim ? v / lim : 0;
      return `<div class="catrow ${lim ? (r > 1 ? 'over' : 'ok') : ''}"><div class="top"><span>${CAT[c]?.i || '📦'} ${esc(c)}</span><span><b>${fmt(v, true)}</b>${lim ? `<span class="mute"> of ${fmt(lim, true)}</span>` : ''}</span></div><div class="bar"><i style="width:${Math.min(100, lim ? r * 100 : v / cats[0][1] * 100)}%"></i></div></div>`; }).join('')}
    <button class="btn sm ghost" data-act="limits" style="margin-top:6px">Set monthly limits</button></div>` : ''}
  ${top ? `<a href="#insights" class="card flat" style="display:block;text-decoration:none;color:inherit"><div class="row"><span class="ico">${top.i}</span><div class="grow"><div class="small mute">Idea to save money</div><b>${esc(top.title)}</b>${top.save ? `<div class="small" style="color:var(--acc)">could free up ~${fmt(top.save, true)}/mo</div>` : ''}</div><span class="mute">›</span></div></a>` : ''}
  <div class="card"><div class="row between"><h3 style="margin:0">Recent</h3>${recent.length ? '<a href="#history" class="small">See all</a>' : ''}</div>
    ${recent.length ? `<div class="list">${recent.map(txItem).join('')}</div>` : '<div class="empty"><div class="em">🧾</div>Nothing logged for this month yet.</div>'}</div>`;
}

function motivator(st, isCur, key) {
  const rate = S.settings.saveRate, n = streak();
  const streakChip = n > 0 ? `<span class="badge">🔥 ${n}-month streak</span>` : '';
  if (st.inc <= 0) return `<div class="card"><div class="row between"><h3 style="margin:0">Savings goal</h3>${streakChip}</div><p class="mute small">Once you add income, I’ll show how much to set aside — your goal is ${rate}% of what you earn.</p></div>`;
  const tg = target(st.inc), done = tg > 0 ? Math.min(100, st.sav / tg * 100) : 100;
  const pick = a => a[new Date().getDate() % a.length];
  let msg, btn = '';
  if (tg > 0 && st.sav >= tg) {
    msg = pick([`🎉 Goal hit! You’ve put ${fmt(st.sav, true)} away this month.`, `🏆 Nice work — ${fmt(st.sav, true)} saved, goal reached.`, `💪 Future you says thanks. Goal reached!`]);
    if (st.left > 0 && isCur) { msg += ` You still have ${fmt(st.left, true)} unspent — a bonus deposit builds your cushion faster.`; btn = `<button class="btn primary sm" data-act="add" data-t="sav" data-a="${st.left}">Save ${fmt(st.left, true)} more</button>`; }
  } else if (st.left > 0) {
    const need = tg - st.sav, amt = Math.min(st.left, need);
    msg = isCur ? `You have <b>${fmt(st.left, true)}</b> unspent. Move <b>${fmt(amt, true)}</b> to savings ${amt >= need ? `to hit your ${rate}% goal` : 'now — every bit counts'}.`
      : `You finished with ${fmt(st.left, true)} unspent that could have gone to savings.`;
    if (isCur) btn = `<button class="btn primary sm" data-act="add" data-t="sav" data-a="${amt}">Save ${fmt(amt, true)}</button>`;
  } else {
    const wants = Object.entries(st.cat).filter(([c]) => CAT[c]?.k !== 'need').sort((a, b) => b[1] - a[1])[0];
    msg = st.left < 0 ? `You’re ${fmt(-st.left, true)} over this month.` : 'You’ve used every dollar this month.';
    if (wants) msg += ` Biggest flexible spend: ${CAT[wants[0]]?.i || ''} ${esc(wants[0])} (${fmt(wants[1], true)}).`;
  }
  return `<div class="card"><div class="row between"><h3 style="margin:0">Savings goal · ${rate}%</h3>${streakChip}</div>
    <div class="bar" style="margin:10px 0 6px"><i style="width:${done}%;background:var(--sav)"></i></div>
    <div class="small mute">${fmt(st.sav, true)} of ${fmt(tg, true)} target saved</div>
    <p style="margin:10px 0 ${btn ? 10 : 0}px">${msg}</p>${btn}</div>`;
}

function banners() {
  let b = '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = {}; try { dismissed = JSON.parse(localStorage.getItem('pp-dismiss') || '{}'); } catch (e) { /* ignore */ }
  if (ios && !standalone && !dismissed.install) b += `<div class="banner accent"><span>📲</span><div>Install it: tap <b>Share</b> <span aria-hidden="true">⬆︎</span> then <b>Add to Home Screen</b>. Your data stays on this phone, and it works offline.</div><button class="x" data-act="dismiss" data-k="install" aria-label="Dismiss">×</button></div>`;
  else if (window.deferredInstall && !dismissed.install) b += `<div class="banner accent"><span>📲</span><div class="grow">Add Penny Plan to your home screen.</div><button class="btn primary sm" data-act="install">Install</button></div>`;
  const stale = !S.lastBackup || (Date.now() - new Date(S.lastBackup)) > 14 * 864e5;
  if (S.tx.length >= 5 && stale && !dismissed.backup) b += `<div class="banner"><span>☁️</span><div class="grow">${S.lastBackup ? 'It’s been a while since your last backup.' : 'Back up your data so a lost or reset phone doesn’t wipe it.'}</div><button class="btn primary sm" data-act="backup">Back up</button><button class="x" data-act="dismiss" data-k="backup" aria-label="Dismiss">×</button></div>`;
  return b;
}

/* History */
function viewHistory() {
  return head('History') + monthNav() + `
  <div class="chips">${[['all', 'All'], ['exp', 'Spending'], ['inc', 'Income'], ['sav', 'Savings']].map(([k, l]) => `<button class="chip ${hFilter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`).join('')}</div>
  <label class="f" style="margin:0 0 8px"><input id="hq" type="search" placeholder="Search payee, category or note" value="${esc(hQuery)}"></label>
  <div id="hlist"></div>`;
}
function renderHistoryList() {
  const q = hQuery.trim().toLowerCase();
  const list = monthTx(viewMonth).filter(x => (hFilter === 'all' || x.t === hFilter) && (!q || `${x.p} ${x.c} ${x.n}`.toLowerCase().includes(q)))
    .sort((a, b) => b.d.localeCompare(a.d) || (b.id > a.id ? 1 : -1));
  const el = $('#hlist'); if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty"><div class="em">🔎</div>Nothing here.</div>'; return; }
  let html = '', last = '';
  for (const x of list) { if (x.d !== last) { html += `${last ? '</div>' : ''}<div class="day">${dayHead(x.d)}</div><div class="card list" style="padding:4px 14px;margin-bottom:8px">`; last = x.d; } html += txItem(x); }
  const s = stats(list);
  el.innerHTML = html + `</div><p class="small mute center">${list.length} entries · in ${fmt(s.inc, true)} · out ${fmt(s.exp, true)} · saved ${fmt(s.sav, true)}</p>`;
}

/* Savings */
const CHALLENGES = ['🚫 No-spend weekend: nothing but groceries and bills until Monday.', '🪙 Round up: log every purchase to the next $5 and move the difference to savings.', '🍳 Cook at home all week and save what you’d spend on takeout.', '📦 Sell something you don’t use and put 100% of it in savings.', '⏳ Wait 48 hours before any non-essential purchase over $30.', '☕ Make coffee at home for 7 days and move the savings over.', '💵 Put every $5 bill you get into savings.', '🎯 Bump your savings goal by 1% this month.'];
function viewSavings() {
  const st = stats(monthTx(thisMonth())), tg = target(st.inc), n = streak(), tot = totalSaved();
  const done = tg > 0 ? Math.min(1, st.sav / tg) : 0, R = 40, C = 2 * Math.PI * R;
  const win = monthsBetween(firstMonth() || thisMonth(), thisMonth()).filter(k => monthTx(k).length).slice(-3);
  const avgExp = win.length ? sum(win, k => stats(monthTx(k)).exp) / win.length : 0, months = avgExp > 0 ? tot / avgExp : 0;
  const ch = Math.floor(Date.now() / 6048e5) % CHALLENGES.length;
  const earned = [['🌱 First deposit', tot > 0], ['💯 $100 saved', tot >= 10000], ['💰 $500 saved', tot >= 50000], ['🏦 $1,000 saved', tot >= 100000], ['🚀 $5,000 saved', tot >= 500000], ['🔥 3-month streak', n >= 3], ['🏅 6-month streak', n >= 6], ['🛟 1 month of expenses saved', months >= 1], ['🛡️ 3 months saved', months >= 3]];
  return head('Savings') + `
  <div class="card"><div class="row" style="gap:16px">
    <div class="ring"><svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="${R}" fill="none" stroke="var(--soft)" stroke-width="10"/><circle cx="48" cy="48" r="${R}" fill="none" stroke="var(--sav)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - done)}"/></svg><b>${pct(done * 100)}</b></div>
    <div class="grow"><div class="small mute">This month’s target (${S.settings.saveRate}% of income)</div><div style="font-size:1.4rem;font-weight:700">${fmt(st.sav, true)} <span class="mute" style="font-size:.95rem;font-weight:500">/ ${fmt(tg, true)}</span></div>
    <div class="small">${n ? `🔥 ${n}-month streak — keep it alive!` : 'Hit your target this month to start a streak.'}</div></div></div></div>
  <div class="card"><div class="row between"><h3 style="margin:0">Total saved</h3><b style="font-size:1.3rem" class="sav">${fmt(tot, true)}</b></div>
    ${avgExp > 0 ? `<div class="bar" style="margin:12px 0 6px"><i style="width:${Math.min(100, months / 3 * 100)}%;background:var(--sav)"></i></div><div class="small mute">Emergency cushion: <b>${months.toFixed(1)}</b> of 3 months of expenses${months >= 3 ? ' — fully funded! 🎉' : ''}</div>` : ''}
  </div>
  <div class="row between"><h2 style="margin:6px 0">Goals</h2><button class="btn sm" data-act="goalNew">＋ New goal</button></div>
  ${S.goals.map(g => { const v = goalSaved(g), p = g.target ? Math.min(100, v / g.target * 100) : 0;
    return `<div class="card"><div class="row between"><b>${esc(g.name)}</b><button class="btn sm ghost" data-act="goalEdit" data-id="${g.id}">Edit</button></div>
      <div class="bar" style="margin:10px 0 6px"><i style="width:${p}%;background:var(--sav)"></i></div>
      <div class="row between"><span class="small mute">${fmt(v, true)} of ${fmt(g.target, true)}${g.target && v >= g.target ? ' ✅' : ''}</span><button class="btn primary sm" data-act="add" data-t="sav" data-g="${g.id}">＋ Add money</button></div></div>`; }).join('')}
  ${(() => { const free = sum(S.tx.filter(x => x.t === 'sav' && !S.goals.some(g => g.id === x.g)), x => x.a); return free ? `<div class="card flat"><div class="row between"><span>General savings</span><b>${fmt(free, true)}</b></div></div>` : ''; })()}
  <div class="card"><h3>Future you ✨</h3><p class="small mute" style="margin-top:0">If you save this much every month and earn ~4% in a high-yield savings account:</p>
    <div class="row between"><b id="fyAmt" style="font-size:1.3rem"></b><span class="small mute">per month</span></div>
    <input type="range" id="fyRange" min="0" max="1000" step="5" aria-label="Monthly savings">
    <div id="fyOut" class="kpis" style="margin:10px 0 0"></div></div>
  <h2>Badges</h2><div>${earned.map(([l, ok]) => `<span class="badge ${ok ? '' : 'off'}">${l}</span>`).join('')}</div>
  <h2>This week’s challenge</h2><div class="card flat">${CHALLENGES[ch]}<br><span class="small mute">${CHALLENGES[(ch + 1) % CHALLENGES.length]}</span></div>`;
}
function mountSavings() {
  const r = $('#fyRange'); if (!r) return;
  const st = stats(monthTx(thisMonth()));
  const prevAvg = (() => { const ks = monthsBetween(firstMonth() || thisMonth(), thisMonth()).filter(k => monthTx(k).length); return ks.length ? sum(ks, k => stats(monthTx(k)).sav) / ks.length : 0; })();
  r.value = Math.min(1000, Math.max(25, Math.round(Math.max(prevAvg, target(st.inc), 2500) / 100 / 5) * 5));
  const upd = () => {
    const m = +r.value, i = .04 / 12; $('#fyAmt').textContent = `$${m}`;
    $('#fyOut').innerHTML = [1, 2, 4].map(y => { const nm = y * 12, fv = m * (Math.pow(1 + i, nm) - 1) / i; return `<div class="kpi"><div class="l">${y} year${y > 1 ? 's' : ''}</div><div class="v">${fmt(fv * 100, true)}</div><div class="s">${fmt((fv - m * nm) * 100, true)} from interest</div></div>`; }).join('');
  };
  r.oninput = upd; upd();
}

/* Insights */
function trendPct(vals) {
  if (vals.length < 2) return null;
  const h = Math.floor(vals.length / 2), a = sum(vals.slice(0, h)) / h, b = sum(vals.slice(vals.length - h)) / h;
  return a > 0 ? (b - a) / a * 100 : null;
}
const arrow = (p, goodUp) => p == null || Math.abs(p) < 3 ? '' : `<span class="trend" style="color:${(p > 0) === goodUp ? 'var(--inc)' : 'var(--exp)'}">${p > 0 ? '▲' : '▼'} ${Math.abs(Math.round(p))}%</span>`;
function viewInsights() {
  const cur = thisMonth(), first = firstMonth() || cur;
  let from = insRange ? addMonths(cur, -(insRange - 1)) : first; if (from < first) from = first;
  const keys = monthsBetween(from, cur), set = new Set(keys);
  const list = S.tx.filter(x => set.has(mk(x.d))), per = keys.map(k => stats(monthTx(k))), tot = stats(list);
  const active = per.filter((p, i) => monthTx(keys[i]).length);
  const nm = Math.max(1, active.length);
  const range = `<div class="chips">${[[3, '3 months'], [6, '6 months'], [12, '12 months'], [0, 'All time']].map(([k, l]) => `<button class="chip ${insRange === k ? 'on' : ''}" data-act="range" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (!list.length) return head('Insights') + range + '<div class="empty card"><div class="em">📊</div>Log a few weeks of income and spending and your trends will show up here.<br><br><button class="btn" data-act="demo">Preview with sample data</button></div>';

  const labels = keys.map(k => monthName(k, { month: 'short' }).slice(0, keys.length > 8 ? 1 : 3));
  const tipsAll = tips(), potential = sum(tipsAll, t => t.save);
  const exps = list.filter(x => x.t === 'exp');
  // categories + comparison to the previous period of equal length
  const prevKeys = new Set(keys.map(k => addMonths(k, -keys.length))), prev = stats(S.tx.filter(x => prevKeys.has(mk(x.d))));
  const catRows = Object.entries(tot.cat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => ({
    l: `${CAT[c]?.i || '📦'} ${esc(c)}`, v, extra: prev.exp > 0 ? arrow(prev.cat[c] ? (v - prev.cat[c]) / prev.cat[c] * 100 : null, false) : '', sub: pct(v / tot.exp * 100) + ' of spending',
  }));
  // payees
  const pay = {};
  for (const x of exps) { const k = (x.p || x.c).trim().toLowerCase(); (pay[k] ||= { name: x.p || x.c, v: 0, n: 0, kind: CAT[x.c]?.k }).v += x.a; pay[k].n++; }
  const payees = Object.values(pay).sort((a, b) => b.v - a.v).slice(0, 8);
  // needs/wants/waste
  const mix = { need: 0, want: 0, waste: 0 }; for (const [c, v] of Object.entries(tot.cat)) mix[CAT[c]?.k || 'want'] += v;
  // income sources
  const src = {}; for (const x of list.filter(x => x.t === 'inc')) (src[x.p.trim() || 'Other'] ||= { v: 0, byM: {} }).v += x.a, src[x.p.trim() || 'Other'].byM[mk(x.d)] = (src[x.p.trim() || 'Other'].byM[mk(x.d)] || 0) + x.a;
  const srcRows = Object.entries(src).sort((a, b) => b[1].v - a[1].v).slice(0, 6).map(([n, o]) => ({ l: esc(n), v: o.v, sub: pct(o.v / tot.inc * 100) + ' of income', extra: arrow(trendPct(keys.map(k => o.byM[k] || 0).filter((_, i) => active.length > 1 || true)), true) }));
  // weekday
  const wd = [0, 0, 0, 0, 0, 0, 0]; for (const x of exps) wd[pd(x.d).getDay()] += x.a;
  const wdTop = wd.indexOf(Math.max(...wd)), WD = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  // leaks
  const leaks = [];
  const small = exps.filter(x => x.a < 800 && CAT[x.c]?.k !== 'need' && !CAT[x.c]?.bill);
  if (small.length >= 6) leaks.push(['🧋', `${small.length} purchases under $8`, `${fmt(sum(small, x => x.a), true)} total — about ${fmt(sum(small, x => x.a) / nm * 12, true)} a year at this pace.`]);
  const fees = sum(exps.filter(x => x.c === 'Fees & Interest'), x => x.a);
  if (fees) leaks.push(['⚠️', 'Fees & interest', `${fmt(fees, true)} paid for nothing. These are the easiest dollars to stop.`]);
  payees.filter(p => p.kind === 'want' && p.n >= 4).slice(0, 3).forEach(p => leaks.push(['🔁', `${esc(p.name)}: ${p.n} visits`, `${fmt(p.v, true)} so far — about ${fmt(p.v / nm * 12, true)} a year.`]));
  const wantShare = (mix.want + mix.waste) / Math.max(1, tot.exp) * 100;
  if (wantShare > 40) leaks.push(['🎯', `${pct(wantShare)} of spending is wants`, 'The 50/30/20 rule suggests about 30% on wants. Trimming the top one or two categories is usually enough.']);
  const bigWants = exps.filter(x => CAT[x.c]?.k !== 'need' && !CAT[x.c]?.bill).sort((a, b) => b.a - a.a).slice(0, 3);
  if (bigWants.length) leaks.push(['🛍️', 'Biggest one-time "wants"', bigWants.map(x => `${esc(x.p || x.c)} ${fmt(x.a, true)}`).join(' · ')]);
  const over = per.filter((p, i) => p.inc > 0 && p.left < 0 && p.sav === 0 && keys[i] !== cur).length;
  if (over) leaks.push(['📉', `${over} month${over > 1 ? 's' : ''} spent more than earned`, 'Spending beyond income usually lands on a credit card. Setting category limits on Home helps.']);

  const incTrend = trendPct(per.map(p => p.inc).filter(v => v > 0)), expTrend = trendPct(per.map(p => p.exp).filter(v => v > 0));
  const rate = tot.inc > 0 ? (tot.inc - tot.exp) / tot.inc * 100 : 0;
  return head('Insights') + range + `
  <div class="kpis">
    <div class="kpi"><div class="l">Income</div><div class="v inc">${fmt(tot.inc, true)}</div><div class="s">${fmt(tot.inc / nm, true)}/mo ${arrow(incTrend, true)}</div></div>
    <div class="kpi"><div class="l">Spent</div><div class="v exp">${fmt(tot.exp, true)}</div><div class="s">${fmt(tot.exp / nm, true)}/mo ${arrow(expTrend, false)}</div></div>
    <div class="kpi"><div class="l">Saved</div><div class="v sav">${fmt(tot.sav, true)}</div><div class="s">${fmt(tot.sav / nm, true)}/mo</div></div>
    <div class="kpi"><div class="l">Kept after spending</div><div class="v">${tot.inc ? pct(rate) : '—'}</div><div class="s">of income (goal ${S.settings.saveRate}%)</div></div>
  </div>
  <div class="card"><h3>Income vs. spending</h3>${barChart(labels, [{ v: per.map(p => p.inc), color: 'var(--inc)' }, { v: per.map(p => p.exp), color: 'var(--exp)' }], 'Income and spending by month')}
    <div class="legend" style="justify-content:center;gap:16px"><span style="--c:var(--inc)">Income</span><span style="--c:var(--exp)">Spending</span></div></div>
  <div class="card"><h3>Left over each month</h3>${barChart(labels, [{ v: per.map(p => p.inc - p.exp), color: v => v < 0 ? 'var(--exp)' : 'var(--sav)' }], 'Income minus spending by month')}
    <p class="small mute" style="margin-bottom:0">Income minus spending, before moving anything to savings. Red months mean you spent more than you earned.</p></div>
  ${tipsAll.length ? `<div class="card"><div class="row between"><h3 style="margin:0">Ways to spend less</h3>${potential ? `<span class="badge" style="margin:0;color:var(--acc)">up to ${fmt(potential, true)}/mo</span>` : ''}</div>
    ${tipsAll.slice(0, 7).map(t => `<div class="tip"><span class="ico">${t.i}</span><div class="grow"><b>${esc(t.title)}</b><div class="small mute">${esc(t.body)}</div>${t.save ? `<span class="save">≈ ${fmt(t.save, true)}/mo · ${fmt(t.save * 12, true)}/yr</span>` : ''}</div></div>`).join('')}</div>` : ''}
  <div class="card"><h3>What you spend the most on</h3>${hbars(catRows, 'var(--exp)')}${prev.exp > 0 ? '<p class="small mute" style="margin-bottom:0">Arrows compare with the previous equal-length period.</p>' : ''}</div>
  <div class="card"><h3>Top places</h3>${hbars(payees.map(p => ({ l: esc(p.name), v: p.v, sub: `${p.n} time${p.n > 1 ? 's' : ''} · avg ${fmt(p.v / p.n, true)}` })), 'var(--warn)')}</div>
  <div class="card"><h3>Needs, wants &amp; waste</h3>
    <div class="mix">${Object.entries(mix).map(([k, v]) => `<i style="width:${v / Math.max(1, tot.exp) * 100}%;background:${KIND[k][1]}"></i>`).join('')}</div>
    <div class="legend">${Object.entries(mix).map(([k, v]) => `<span style="--c:${KIND[k][1]}">${KIND[k][0]} ${pct(v / Math.max(1, tot.exp) * 100)}</span>`).join('')}</div>
    <p class="small mute" style="margin-bottom:0">A balanced target is roughly 50% needs, 30% wants, 20% savings.</p></div>
  ${leaks.length ? `<div class="card"><h3>Spending leaks 🕳️</h3>${leaks.map(l => `<div class="tip"><span class="ico">${l[0]}</span><div><b>${l[1]}</b><div class="small mute">${l[2]}</div></div></div>`).join('')}</div>` : ''}
  ${srcRows.length ? `<div class="card"><h3>Income sources</h3>${hbars(srcRows, 'var(--inc)')}</div>` : ''}
  <div class="card"><h3>Spending by weekday</h3>${barChart(['S', 'M', 'T', 'W', 'T', 'F', 'S'], [{ v: wd, color: 'var(--warn)' }], 'Spending by day of week')}
    <p class="small mute" style="margin-bottom:0">You spend the most on <b>${WD[wdTop]}</b> (${fmt(wd[wdTop], true)}).</p></div>
  <button class="btn block ghost" data-act="csv">Download all transactions (CSV)</button>`;
}

/* Settings */
function viewSettings() {
  const fmtDate = s => s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never';
  const rec = S.recurs.filter(r => r.on);
  const demo = S.tx.some(x => x.id.startsWith('demo-'));
  return `<div class="head"><button class="iconbtn" data-act="back" aria-label="Back">‹</button><h1>Settings</h1><span style="width:40px"></span></div>
  <div class="sethead">You</div><div class="card">
    <label class="f" style="margin-top:0">First name (optional)<input id="s-name" value="${esc(S.settings.name)}" autocomplete="off"></label>
    <label class="f">Savings goal: <b id="s-rate-l">${S.settings.saveRate}%</b> of income<input id="s-rate" type="range" min="0" max="50" step="1" value="${S.settings.saveRate}"></label>
    <label class="f">Currency<select id="s-cur">${['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'MXN', 'INR', 'JPY'].map(c => `<option ${S.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <div class="setrow"><span>Monthly category limits</span><button class="btn sm" data-act="limits">Edit</button></div>
  </div>
  <div class="sethead">Repeating items</div><div class="card">
    ${rec.length ? rec.map(r => `<div class="setrow"><span>${r.t === 'inc' ? '💵' : r.t === 'sav' ? '🐷' : CAT[r.c]?.i || '📦'} ${esc(r.p || r.c)} <span class="mute small">· ${fmt(r.a)} on the ${r.day}${[, 'st', 'nd', 'rd'][r.day % 10 > 3 || (r.day > 10 && r.day < 14) ? 0 : r.day % 10] || 'th'}</span></span><button class="btn sm" data-act="stopRecur" data-id="${r.id}">Stop</button></div>`).join('') : '<p class="mute small" style="margin:0">Nothing repeats yet. When you add rent, a paycheck or a subscription, tick “Repeats every month” and it will post itself.</p>'}
  </div>
  <div class="sethead">Backup &amp; restore</div><div class="card">
    <p style="margin-top:0">Your data lives only on this device. A backup is one small file — save it to <b>iCloud Drive</b>, Google Drive or email it to yourself.</p>
    <button class="btn primary block" data-act="backup">☁️ Back up now</button>
    <p class="small mute">On iPhone, tap <b>Save to Files</b> in the share sheet and choose iCloud Drive. Last backup: <b>${fmtDate(S.lastBackup)}</b>.</p>
    <button class="btn block" data-act="restore">Restore from a backup file</button>
    <button class="btn block ghost" data-act="csv" style="margin-top:8px">Export spreadsheet (CSV)</button>
  </div>
  <div class="sethead">Other</div><div class="card">
    ${demo ? '<button class="btn block" data-act="clearDemo">Remove sample data</button>' : '<button class="btn block" data-act="demo">Load sample data (to explore)</button>'}
    <button class="btn block danger" data-act="erase" style="margin-top:8px">Erase everything</button>
  </div>
  <p class="small mute center">Penny Plan · no accounts, no tracking, no servers.<br>Nothing leaves your phone unless you back it up.</p>`;
}

/* ---------- add / edit transaction ---------- */
function txSheet(o = {}) {
  const ex = o.id ? S.tx.find(x => x.id === o.id) : null;
  const v = ex || { t: o.t || 'exp', d: todayStr(), a: o.a || 0, p: '', c: '', g: o.g || (o.t === 'sav' ? S.goals[0]?.id || '' : ''), n: '', r: '' };
  let type = v.t;
  const html = `<div class="row between"><h3 style="margin:0">${ex ? 'Edit entry' : 'Add entry'}</h3><button class="iconbtn" data-act="close" aria-label="Close" style="box-shadow:none;background:var(--soft)">✕</button></div>
  <div class="seg" style="margin-top:12px"><button data-t="exp">Expense</button><button data-t="inc">Income</button><button data-t="sav">Savings</button></div>
  <div class="amtin"><span>${new Intl.NumberFormat(undefined, { style: 'currency', currency: S.settings.currency || 'USD' }).formatToParts(0).find(p => p.type === 'currency')?.value || '$'}</span><input id="f-a" inputmode="decimal" placeholder="0.00" autocomplete="off" value="${v.a ? (v.a / 100).toFixed(2) : ''}" aria-label="Amount"></div>
  <div class="preview" id="f-prev"></div>
  <label class="f">Date<input id="f-d" type="date" value="${v.d}"></label>
  <label class="f" data-for="exp inc"><span id="f-pl"></span><input id="f-p" list="f-dl" autocomplete="off" value="${esc(v.p)}"></label><datalist id="f-dl"></datalist>
  <label class="f" data-for="exp">Category<select id="f-c"><option value="">Choose…</option>${['need', 'want', 'waste'].map(k => `<optgroup label="${KIND[k][0]}">${CATS.filter(c => c.k === k).map(c => `<option value="${esc(c.n)}" ${v.c === c.n ? 'selected' : ''}>${c.i} ${esc(c.n)}</option>`).join('')}</optgroup>`).join('')}</select></label>
  <label class="f" data-for="sav">Goal<select id="f-g">${S.goals.map(g => `<option value="${g.id}" ${v.g === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="" ${S.goals.some(g => g.id === v.g) ? '' : 'selected'}>General savings</option></select></label>
  <label class="f">Note (optional)<input id="f-n" value="${esc(v.n)}" autocomplete="off"></label>
  <label class="chk"><input type="checkbox" id="f-r" ${v.r ? 'checked' : ''}> <span>Repeats every month</span></label>
  <div class="row" style="margin-top:18px">${ex ? '<button class="btn danger" data-del>Delete</button>' : ''}<button class="btn primary grow" data-save>${ex ? 'Save changes' : 'Save'}</button></div>
  ${ex ? '' : '<button class="btn block ghost" data-more style="margin-top:8px">Save &amp; add another</button>'}`;

  openSheet(html, sh => {
    const $a = $('#f-a', sh), $d = $('#f-d', sh), $p = $('#f-p', sh), $c = $('#f-c', sh);
    const upd = () => {
      sh.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.t === type));
      sh.querySelectorAll('[data-for]').forEach(e => e.style.display = e.dataset.for.split(' ').includes(type) ? '' : 'none');
      $('#f-pl', sh).textContent = type === 'inc' ? 'From (source)' : 'Paid to';
      $('#f-p', sh).placeholder = type === 'inc' ? 'Job, parents, scholarship…' : 'Store, person or bill';
      $('#f-dl', sh).innerHTML = uniq(type).map(p => `<option value="${esc(p)}">`).join('');
      const a = parseMoney($a.value), key = ($d.value || todayStr()).slice(0, 7);
      const base = stats(monthTx(key).filter(x => x.id !== ex?.id));
      const left = base.left + (type === 'inc' ? a : -a);
      $('#f-prev', sh).innerHTML = base.inc === 0 && type !== 'inc' ? `No income logged for ${monthName(key, { month: 'long' })} yet`
        : `After this: <b class="${left < 0 ? 'exp' : 'inc'}">${fmt(left)}</b> left in ${monthName(key, { month: 'long' })}`;
    };
    sh.querySelectorAll('.seg button').forEach(b => b.onclick = () => { type = b.dataset.t; upd(); });
    $a.addEventListener('input', upd); $d.addEventListener('input', upd);
    $p.addEventListener('change', () => { // remember the category used last time for this payee
      if (type !== 'exp' || $c.value) return;
      const hit = [...S.tx].reverse().find(x => x.t === 'exp' && x.p.trim().toLowerCase() === $p.value.trim().toLowerCase());
      if (hit) $c.value = hit.c;
    });
    upd();
    if (!ex) setTimeout(() => $a.focus(), 30);
    const commit = more => {
      const a = parseMoney($a.value); if (a <= 0) { toast('Enter an amount'); $a.focus(); return; }
      if (type === 'exp' && !$c.value) { toast('Pick a category'); return; }
      if (!$d.value) { toast('Pick a date'); return; }
      const rec = { id: ex?.id || uid(), t: type, d: $d.value, a, p: type === 'sav' ? '' : $p.value.trim(), c: type === 'exp' ? $c.value : type === 'sav' ? 'Savings' : 'Income', g: type === 'sav' ? $('#f-g', sh).value : '', n: $('#f-n', sh).value.trim(), r: ex?.r || '' };
      const wantsRepeat = $('#f-r', sh).checked;
      if (wantsRepeat && !rec.r) {
        const r = { id: uid(), t: rec.t, a, p: rec.p, c: rec.c, g: rec.g, day: pd(rec.d).getDate(), start: rec.d, on: true, skip: [] };
        S.recurs.push(r); rec.r = r.id;
      } else if (!wantsRepeat && rec.r) { const r = S.recurs.find(r => r.id === rec.r); if (r) r.on = false; rec.r = ''; }
      if (ex) S.tx[S.tx.findIndex(x => x.id === ex.id)] = rec; else S.tx.push(rec);
      save(); closeSheet(); toast(ex ? 'Updated ✓' : 'Saved ✓');
      if (route === 'home' || route === 'history') viewMonth = mk(rec.d) <= thisMonth() ? mk(rec.d) : viewMonth;
      render();
      if (more) txSheet({ t: type, g: rec.g });
    };
    $('[data-save]', sh).onclick = () => commit(false);
    const mo = $('[data-more]', sh); if (mo) mo.onclick = () => commit(true);
    const del = $('[data-del]', sh);
    if (del) del.onclick = async () => {
      if (!await ask('Delete this entry?', `${ex.p || ex.c} · ${fmt(ex.a)}`, 'Delete', true)) return;
      if (ex.r) { const r = S.recurs.find(r => r.id === ex.r); if (r) (r.skip ||= []).push(mk(ex.d)); }
      S.tx = S.tx.filter(x => x.id !== ex.id); save(); toast('Deleted'); render();
    };
  });
}

function goalSheet(id) {
  const g = id ? S.goals.find(g => g.id === id) : null;
  openSheet(`<h3>${g ? 'Edit goal' : 'New savings goal'}</h3>
    <label class="f">Name<input id="g-n" value="${esc(g?.name || '')}" placeholder="Spring break, laptop, car…" autocomplete="off"></label>
    <label class="f">Target amount<input id="g-t" inputmode="decimal" value="${g ? (g.target / 100).toFixed(2) : ''}" placeholder="500.00"></label>
    <div class="row" style="margin-top:16px">${g ? '<button class="btn danger" data-del>Delete</button>' : ''}<button class="btn primary grow" data-ok>Save</button></div>`, sh => {
    $('[data-ok]', sh).onclick = () => {
      const name = $('#g-n', sh).value.trim(), t = parseMoney($('#g-t', sh).value);
      if (!name || t <= 0) { toast('Add a name and target'); return; }
      if (g) { g.name = name; g.target = t; } else S.goals.push({ id: uid(), name, target: t });
      save(); closeSheet(); render();
    };
    const d = $('[data-del]', sh);
    if (d) d.onclick = async () => { if (!await ask('Delete this goal?', 'Money already saved stays in your total as general savings.', 'Delete', true)) return; S.goals = S.goals.filter(x => x.id !== id); S.tx.forEach(x => { if (x.g === id) x.g = ''; }); save(); render(); };
  });
}

function limitsSheet() {
  openSheet(`<h3>Monthly limits</h3><p class="mute small">Optional. Set a cap per category and Home shows how close you are. Leave blank for none.</p>
    ${CATS.filter(c => c.k !== 'waste').map(c => `<label class="f"><span>${c.i} ${esc(c.n)}</span><input data-c="${esc(c.n)}" inputmode="decimal" placeholder="No limit" value="${S.budgets[c.n] ? (S.budgets[c.n] / 100).toFixed(0) : ''}"></label>`).join('')}
    <button class="btn primary block" data-ok style="margin-top:16px">Save limits</button>`, sh => {
    $('[data-ok]', sh).onclick = () => {
      S.budgets = {}; sh.querySelectorAll('input[data-c]').forEach(i => { const v = parseMoney(i.value); if (v > 0) S.budgets[i.dataset.c] = v; });
      save(); closeSheet(); render(); toast('Limits saved ✓');
    };
  });
}

function welcomeSheet() {
  openSheet(`<div class="center"><div style="font-size:2.6rem">👋</div><h3 style="font-size:1.3rem">Welcome to Penny Plan</h3>
    <p class="mute">Log what comes in and what goes out, and see what’s left — live. Everything stays on your phone.</p></div>
    <label class="f">What should I call you? (optional)<input id="w-name" autocomplete="off"></label>
    <label class="f">Save <b id="w-rl">20%</b> of what you earn<input id="w-rate" type="range" min="0" max="50" value="20"></label>
    <p class="small mute">A common target is 20%. Even 5% builds the habit — you can change this anytime in Settings.</p>
    <button class="btn primary block" data-ok style="margin-top:14px">Let’s go</button>
    <button class="btn block ghost" data-demo style="margin-top:8px">Look around with sample data first</button>`, sh => {
    const r = $('#w-rate', sh); r.oninput = () => $('#w-rl', sh).textContent = r.value + '%';
    const finish = () => { S.settings.name = $('#w-name', sh).value.trim(); S.settings.saveRate = +r.value; S.settings.onboarded = true; save(); closeSheet(); render(); };
    $('[data-ok]', sh).onclick = finish;
    $('[data-demo]', sh).onclick = () => { finish(); loadDemo(); };
  });
}

/* ---------- backup / restore / export ---------- */
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function backupNow() {
  const payload = { app: 'pennyplan', version: 1, exportedAt: new Date().toISOString(), data: S };
  const name = `PennyPlan-backup-${todayStr()}.json`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Penny Plan backup' });
      S.lastBackup = new Date().toISOString(); save(); toast('Backup shared ✓'); render(); return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  download(blob, name); S.lastBackup = new Date().toISOString(); save(); toast('Backup downloaded ✓'); render();
}
async function restoreFrom(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== 'pennyplan' || !j.data || !Array.isArray(j.data.tx)) throw new Error('bad');
    const d = norm(j.data);
    if (!await ask('Restore this backup?', `${d.tx.length} entries from ${j.exportedAt ? new Date(j.exportedAt).toLocaleDateString() : 'an earlier backup'}. This replaces what’s on this device now.`, 'Restore')) return;
    S = d; S.settings.onboarded = true; save(); toast('Restored ✓'); location.hash = '#home'; render();
  } catch (e) { toast('That doesn’t look like a Penny Plan backup'); }
}
function exportCsv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Type', 'Amount', 'Payee/Source', 'Category', 'Note']].concat([...S.tx].sort((a, b) => a.d.localeCompare(b.d)).map(x => [x.d, { inc: 'Income', exp: 'Expense', sav: 'Savings' }[x.t], (x.a / 100).toFixed(2), x.p, x.c, x.n]));
  download(new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }), `PennyPlan-${todayStr()}.csv`);
}

/* ---------- sample data ---------- */
function loadDemo() {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100);
  const today = todayStr(); let n = 0; const out = [];
  const put = (k, day, t, a, p, c, g = '') => { const d = `${k}-${pad(Math.min(day, daysIn(k)))}`; if (d <= today) out.push({ id: `demo-${n++}`, t, d, a, p, c: c || (t === 'inc' ? 'Income' : 'Savings'), g, n: '', r: '' }); };
  for (let i = 5; i >= 0; i--) {
    const k = addMonths(thisMonth(), -i);
    put(k, 1, 'inc', between(520, 680), 'Campus job', ''); put(k, 15, 'inc', between(520, 680), 'Campus job', '');
    put(k, 3, 'inc', 20000, 'Parents', ''); if (rnd() < .4) put(k, 20, 'inc', between(60, 160), 'Side gig', '');
    put(k, 1, 'exp', 45000, 'Landlord', 'Rent & Housing'); put(k, 8, 'exp', 5500, 'Verizon', 'Phone'); put(k, 10, 'exp', 3000, 'Comcast (split)', 'Internet'); put(k, 12, 'exp', between(70, 120), 'Rocky Mountain Power', 'Utilities');
    put(k, 5, 'exp', 1199, 'Spotify', 'Subscriptions'); put(k, 6, 'exp', 1549, 'Netflix', 'Subscriptions'); put(k, 6, 'exp', 999, 'Hulu', 'Subscriptions'); put(k, 18, 'exp', 1299, 'Gym app', 'Subscriptions');
    for (let j = 0; j < 4; j++) put(k, 3 + j * 7, 'exp', between(35, 75), rnd() < .6 ? 'Walmart' : 'Smith’s', 'Groceries');
    for (let j = 0; j < 9; j++) put(k, 1 + Math.floor(rnd() * 28), 'exp', between(8, 24), ['Chipotle', 'Domino’s', 'McDonald’s', 'Wingers'][Math.floor(rnd() * 4)], 'Dining Out');
    for (let j = 0; j < 11 + Math.floor(rnd() * 5); j++) put(k, 1 + Math.floor(rnd() * 28), 'exp', between(4.5, 7), 'Starbucks', 'Coffee & Snacks');
    for (let j = 0; j < 3; j++) put(k, 4 + j * 9, 'exp', between(28, 46), 'Maverik', 'Transportation');
    put(k, 14, 'exp', between(10, 40), 'Steam', 'Entertainment'); put(k, 22, 'exp', between(12, 45), 'Movies', 'Entertainment');
    for (let j = 0; j < 2; j++) put(k, 9 + j * 10, 'exp', between(15, 70), rnd() < .5 ? 'Amazon' : 'Target', 'Shopping');
    if (rnd() < .45) put(k, 17, 'exp', 3500, 'Overdraft fee', 'Fees & Interest');
    if (i === 5 || i === 2) put(k, 6, 'exp', between(180, 260), 'Campus bookstore', 'Tuition & Books');
    if (i < 5 && i % 2 === 0) put(k, 28, 'sav', 10000, '', '', 'g-emergency');
  }
  S.tx = S.tx.filter(x => !x.id.startsWith('demo-')).concat(out); save(); toast('Sample data loaded'); location.hash = '#home'; viewMonth = thisMonth(); render();
}

/* ---------- actions (event delegation) ---------- */
const ACT = {
  add: d => txSheet({ t: d.t, a: d.a ? +d.a : 0, g: d.g }),
  edit: d => txSheet({ id: d.id }),
  close: closeSheet,
  month: d => { const k = addMonths(viewMonth, +d.d); if (k <= thisMonth()) { viewMonth = k; render(); } },
  filter: d => { hFilter = d.k; render(); },
  range: d => { insRange = +d.k; render(); },
  settings: () => { location.hash = '#settings'; },
  back: () => { location.hash = '#home'; },
  goalNew: () => goalSheet(),
  goalEdit: d => goalSheet(d.id),
  limits: limitsSheet,
  backup: backupNow,
  restore: () => $('#restoreFile').click(),
  csv: exportCsv,
  demo: loadDemo,
  clearDemo: () => { S.tx = S.tx.filter(x => !x.id.startsWith('demo-')); save(); toast('Sample data removed'); render(); },
  stopRecur: d => { const r = S.recurs.find(r => r.id === d.id); if (r) r.on = false; save(); render(); },
  erase: async () => {
    if (!await ask('Erase everything?', 'This deletes all entries, goals and settings on this device. Make a backup first if you might want them back.', 'Erase', true)) return;
    S = blank(); save(); location.hash = '#home'; viewMonth = thisMonth(); render(); welcomeSheet();
  },
  dismiss: d => { let o = {}; try { o = JSON.parse(localStorage.getItem('pp-dismiss') || '{}'); localStorage.setItem('pp-dismiss', JSON.stringify({ ...o, [d.k]: 1 })); } catch (e) { /* ignore */ } render(); },
  install: async () => { const p = window.deferredInstall; if (!p) return; p.prompt(); await p.userChoice; window.deferredInstall = null; render(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const f = ACT[el.dataset.act]; if (f) { e.preventDefault(); f(el.dataset); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'hq') { hQuery = e.target.value; renderHistoryList(); }
  else if (e.target.id === 's-name') { S.settings.name = e.target.value.trim(); save(); }
  else if (e.target.id === 's-rate') { S.settings.saveRate = +e.target.value; $('#s-rate-l').textContent = e.target.value + '%'; save(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 's-cur') { S.settings.currency = e.target.value; save(); toast('Currency updated'); }
  else if (e.target.id === 'restoreFile') { const f = e.target.files[0]; e.target.value = ''; if (f) restoreFrom(f); }
});
window.addEventListener('hashchange', () => { closeSheet(); window.scrollTo(0, 0); render(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.deferredInstall = e; if (route === 'home') render(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------- boot ---------- */
(async function boot() {
  const saved = await DB.get();
  if (saved) S = norm(saved);
  genRecurring();
  render();
  if (!S.settings.onboarded && !S.tx.length) welcomeSheet();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  // if the day rolls over while the app sits open in the background, refresh on return
  let day = todayStr();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && todayStr() !== day) { day = todayStr(); genRecurring(); if (viewMonth > thisMonth()) viewMonth = thisMonth(); render(); } });
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded && !$('.sheet-wrap')) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
