// ==UserScript==
// @name         Caro Order
// @namespace    caro
// @version      3.2
// @updateURL    https://greekefire.github.io/open/caro-order.user.js
// @downloadURL  https://greekefire.github.io/open/caro-order.user.js
// @description  From a 🧾 order note: picks the Shopee option and quantity, goes to checkout, puts the buyer in the reused address slot, ticks Shopee Coins, picks PayNow. Never places the order.
// @match        https://shopee.sg/*
// @match        https://greekefire.github.io/open/*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==
/*
 * Laptop (Tampermonkey in Chrome) and iPhone (the Userscripts app in Safari), 8 Nov.
 * 1. Tap 🛍 Order in Safari in the 🧾 order note. It opens greekefire.github.io/open/#<product>#caro=<ORDER line>&to=<SHIP TO line>:
 *    this script keeps the address in its own storage and opens the Shopee product without it (Shopee never sees it),
 *    then picks the option and quantity and taps Buy Now, then Check Out.
 * 2. At checkout it fills the address by itself (📋 Paste note is the fallback). It writes the buyer into the last saved address
 *    (never your default, so the 10-address limit never comes up) with your number +6591517321, selects it, ticks
 *    Shopee Coins when the item allows it, and picks PayNow.
 * 3. You check the address, item and total, then tap Place Order yourself. Pay by scanning the PayNow QR
 *    (on the phone: screenshot it and scan it from Photos in your bank app).
 * Shopee's check page (/verify) is never touched: do it yourself and tap the link again.
 * Anything not found → the panel says so, with 🔍 Copy page info to send to Claude. Shopee's phone layout was not seen
 * when this was written (Shopee blocks test browsers), so the first phone order is the test.
 */
(async () => {
  const dec = s => { for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(s); i++) { try { s = decodeURIComponent(s); } catch { break; } } return s; };  // iPhone: Telegram + Safari encode it twice
  const gm = typeof GM !== 'undefined' && GM.setValue;  // the iPhone Userscripts app has GM.*, Tampermonkey has both
  const store = { set: (k, v) => gm ? GM.setValue(k, v) : GM_setValue(k, v), get: async k => (gm ? await GM.getValue(k, '') : GM_getValue(k, '')) };
  if (location.hostname === 'greekefire.github.io') {  // our in-between page: keep the address here, open Shopee without it
    const h = location.hash.slice(1).replace(/^!/, '').replace(/%23/gi, '#'), to = h.match(/&to=(.*)$/);
    if (to && /^[\w\/.%-]+#caro=/.test(h)) {
      document.documentElement.dataset.caro = '1';  // tells the page we're handling it, so it doesn't redirect by itself
      await store.set('caro-to', JSON.stringify({ to: dec(to[1]), t: Date.now() }));
      location.replace('https://shopee.sg/' + h.replace(/&to=.*$/, ''));
    }
    return;
  }
  // Shopee's site keeps trying to launch the app (Safari: "Open this page in Shopee?"). Block its app links (shopeesg://…)
  // in the page itself, so Safari never asks. ponytail: covers window.open, iframes and link clicks; a plain location change can't be blocked.
  const s = document.createElement('script');
  s.textContent = `(() => { const bad = u => /^(?!https?:|about:|blob:|data:|javascript:)[a-z][\w+.-]*:/i.test(String(u || ''));
    const o = window.open; window.open = function (u, ...a) { return bad(u) ? null : o.call(this, u, ...a); };
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); }, set(v) { if (!bad(v)) d.set.call(this, v); } });
    const sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function (n, v) { if (/^(src|href)$/i.test(n) && this.tagName === 'IFRAME' && bad(v)) return; return sa.call(this, n, v); };
    const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (!bad(this.href)) return c.call(this); };
    document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && bad(a.getAttribute('href'))) e.preventDefault(); }, true);
  })();`;
  (document.head || document.documentElement).appendChild(s); s.remove();
  const PHONE = '+6591517321';  // always your number, so couriers call you; Shopee rejects it with spaces or without +65 (8 Nov)
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const until = async (f, ms = 15000) => { for (let t = 0; t < ms; t += 300) { const v = f(); if (v) return v; await wait(300); } return null; };
  const vis = e => e && e.getClientRects().length > 0;
  // buttons by their words, so the same code works on the laptop and phone layouts
  const clickables = () => [...document.querySelectorAll('button, [role=button], a, [role=radio], div[tabindex]')].filter(vis);
  const byText = (re, root = document) => [...root.querySelectorAll('button, [role=button], a, div, span')].filter(e => vis(e) && re.test((e.innerText || '').trim()))
    .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];  // the innermost match
  const setVal = (el, v) => {  // React inputs ignore el.value = v
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const field = re => [...document.querySelectorAll('input')].find(i => vis(i) && re.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.name || '')));

  const box = html => {
    let p = document.getElementById('caro-order');
    if (!p) {
      p = document.createElement('div'); p.id = 'caro-order';
      p.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-width:320px;margin-left:auto;z-index:2147483647;background:#fff;color:#222;' +
        'border:2px solid #ee4d2d;border-radius:8px;padding:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)';
      document.body.appendChild(p);
      p.addEventListener('click', e => { const f = handlers[e.target.dataset.caro]; if (f) f(e); });  // on the panel: survives text changes
    }
    p.innerHTML = '<b>Caro order</b> <small>v3.2</small> <span data-caro="close" style="float:right;cursor:pointer">✕</span><br>' + html; return p;
  };
  const btn = (id, label) => `<button data-caro="${id}" style="margin:6px 6px 0 0;padding:8px 12px;background:#ee4d2d;color:#fff;border:0;border-radius:4px;font-size:14px">${label}</button>`;
  const stuck = msg => box(msg + '<br>' + btn('info', '🔍 Copy page info') + '<span style="font-size:12px"> then send it to Claude</span>');
  const handlers = {
    close: () => document.getElementById('caro-order')?.remove(),
    info: async () => {  // what the script sees, minus anything personal-looking (numbers)
      const t = clickables().map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean);
      const ins = [...document.querySelectorAll('input')].filter(vis).map(i => i.type + ':' + (i.placeholder || i.getAttribute('aria-label') || i.name));
      const info = JSON.stringify({ page: location.pathname, width: innerWidth, buttons: [...new Set(t)].slice(0, 80), inputs: ins }).replace(/\d{4,}/g, '#');
      try { await navigator.clipboard.writeText(info); box('Copied. Paste it to Claude.'); } catch { box('<textarea style="width:100%" rows="6">' + info.replace(/</g, '&lt;') + '</textarea>Copy this to Claude.'); }
    },
    paste: async () => {
      let t = '';
      try { t = await navigator.clipboard.readText(); } catch { }
      if (!t) return box('Could not read the clipboard. Paste the 🧾 note here:' + form());
      go(t);
    },
    fill: () => go(document.getElementById('caro-note').value),
  };
  const form = () => '<textarea id="caro-note" rows="4" style="width:100%;margin-top:6px;box-sizing:border-box;font-size:14px" placeholder="Paste the 🧾 order note"></textarea>' + btn('fill', 'Fill');

  // ── 1. product page: pick the option and quantity, Buy Now ──
  async function product(order) {
    const qty = +((order.match(/^\s*(\d+)\s*x\b/i) || order.match(/\bx\s*(\d+)\s*$/i) || [0, 1])[1]);
    const want = order.replace(/^\s*\d+\s*x\s*|\s*x\s*\d+\s*$/gi, '').trim();
    if (/\s\+\s/.test(want)) return box('This order has several options (<b>' + want + '</b>). Add each to the cart yourself.');
    const opt = () => {
      // phone layout (8 Nov): the option chips are plain divs, not buttons, so look at any element and take the innermost
      const all = [...document.querySelectorAll('button, [role=button], div, span, li, label')].filter(vis);
      const label = b => b.getAttribute('aria-label') || b.innerText || '';
      const small = l => l.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
      return small(all.filter(b => norm(label(b)) === norm(want))) || small(all.filter(b => norm(label(b)).startsWith(norm(want)) && norm(label(b)).length < norm(want).length + 12));
    };
    const cls = e => typeof e.className === 'string' ? e.className : '';
    const selected = b => { for (let e = b, k = 0; e && k < 4; e = e.parentElement, k++)  // the chip, or a wrapper around its text
      if (/selected|active/i.test(cls(e)) && !/unselected|inactive/i.test(cls(e)) || e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-checked') === 'true') return true; return false; };
    const ranges = () => (document.body.innerText.match(/\$\s?[\d.,]+\s*-\s*\$?\s?[\d.,]+/g) || []).length;  // "$11.50 - $40.07" turns into one price once an option is picked
    // iPhone (8 Nov): Shopee's page pops "Open this page in Shopee?" or jumps to the app, and taps made meanwhile are lost.
    // So every step waits until Safari is in front again and keeps trying for up to 90s instead of giving up after 4 taps.
    const front = () => until(() => !document.hidden, 600000);
    box(`Picking <b>${want}</b>… don't tap anything.`);
    const end = Date.now() + 90000;
    let picked = false;
    while (!picked && Date.now() < end) {
      await front(); await until(() => byText(/^Buy Now$/i), 15000);
      await wait(2000);  // a click while the page is still loading (or just back from the app) gets undone
      if (!opt()) { byText(/^Buy Now$/i)?.click(); await wait(1500); }  // phone layout: the options are in a sheet that Buy Now opens
      if (!await until(opt, 6000)) continue;
      // picked = the chip looks selected, or the "$11.50 - $40.07" range became one price. Measured now, with the options on
      // screen (3.0 measured it before the page loaded, never saw a pick, and kept tapping the chip on and off)
      // or its text changed colour after our tap (Shopee's class names are scrambled, the picked chip turns red)
      const col = () => { const o = opt(); return o ? getComputedStyle(o).color : ''; };
      const r0 = ranges(), c0 = col(), done = () => selected(opt()) || (r0 > 0 && ranges() < r0) || (tapped && col() !== c0);
      let tapped = false;
      for (let t = 0; t < 3 && !done(); t++) { await front(); opt()?.click(); tapped = true; await until(done, 3000); }
      picked = done();
    }
    if (!picked) return sessionStorage.removeItem('caro-order'), stuck('Could not pick the option <b>' + want + '</b>. Pick it yourself, then Buy Now.');
    const q = () => [...document.querySelectorAll('input')].find(i => vis(i) && /^\d+$/.test(i.value) && i.type !== 'hidden');
    const plus = () => { const i = q(); return i && (document.querySelector('[data-testid=button_quantity_plus]') || (i.nextElementSibling?.matches('button, [role=button]') ? i.nextElementSibling : i.parentElement.querySelector('[aria-label*=ncrease], button:last-of-type'))); };
    for (let n = +(q()?.value || 1); n < qty && plus(); n++) { plus().click(); await wait(400); }  // typed values don't stick; + does
    if (qty > 1 && +(q()?.value || 1) !== qty) return stuck(`Could not set the quantity to ${qty}. Set it yourself, then Buy Now.`);
    box(`Picked <b>${want}</b> × ${qty}. Going to checkout…`);
    await wait(700); await front();
    sessionStorage.removeItem('caro-order');  // only now: if Safari reloads the page after the app jump, it starts over
    const buys = [...document.querySelectorAll('button, [role=button], div, span')].filter(b => vis(b) && /^Buy Now$/i.test((b.innerText || '').trim()) && ![...b.children].some(c => /^Buy Now$/i.test((c.innerText || '').trim())));
    (buys.filter(b => b.tagName === 'BUTTON').pop() || buys.pop())?.click();  // the sheet's own BUY NOW is a button; the bar behind it isn't
  }

  // ── 2. cart (after Buy Now): Check Out ──
  async function cart() {
    const b = await until(() => [...document.querySelectorAll('button, [role=button]')].find(b => vis(b) && /^Check ?Out/i.test(b.innerText.trim())), 10000);
    if (!b) return stuck('No Check Out button found. Tap it yourself.');
    box('Checking out… (if your cart already had this item, Shopee added to it: check the quantity at checkout)');
    await wait(1200); b.click();
  }

  // ── 3. checkout: buyer into the reused slot, coins, PayNow ──
  function parse(note) {
    const line = (note.match(/Ship To:\s*(.+)/i) || [0, ''])[1];
    const p = line.split('|').map(s => s.trim());
    if (p.length < 5 || !/^\d{6}$/.test(p[4])) return null;
    return { name: p[0], street: p[2], unit: /^-?$/.test(p[3]) ? '' : p[3].replace(/^#\s*/, ''), postal: p[4] };
  }
  // ── the address, step by step (8 Nov) ──
  // The laptop does it in popups on the checkout page; the phone goes to separate My Addresses / Edit Address pages
  // and back. So each tick looks at what is on screen and does the next step; the progress lives in sessionStorage.
  const S = { get: () => JSON.parse(sessionStorage.getItem('caro-fill') || 'null'), set: v => v ? sessionStorage.setItem('caro-fill', JSON.stringify(v)) : sessionStorage.removeItem('caro-fill') };
  const leaf = re => [...document.querySelectorAll('*')].filter(e => vis(e) && !e.children.length && re.test(e.textContent.trim()));
  const addrCard = () => { const t = leaf(/SG\s*\d{6}|^\d{6}$/)[0]; let e = t; for (let k = 0; e && k < 4 && !/\d{8}|\(\+65\)/.test(e.innerText); k++) e = e.parentElement; return e || t; };
  function go(note) {
    const a = parse(note || '');
    if (!a) return box('No "Ship To: name | phone | street | unit | postal" line in that. Copy the whole 🧾 note.' + form());
    S.set({ a, stage: 'open', at: 0, idle: 0 }); box('Filling the address…');
  }
  let busy = false;
  async function step() {
    const f = S.get(); if (!f || busy || Date.now() - f.at < 2500) return;  // one action at a time, then let the page react
    busy = true;
    try {
      const a = f.a, act = stage => S.set({ ...f, stage, at: Date.now(), idle: 0 });
      const popup = leaf(/^Install Shopee/i).length && leaf(/^Cancel$/)[0];  // "Install Shopee on your Phone"
      if (popup) { popup.click(); return; }
      const fm = field(/Full Name/i), edits = leaf(/^Edit$/), list = edits.length && leaf(/Add New Address/i).length;
      if (fm && (f.stage === 'open' || f.stage === 'edit')) {  // the address form: fill and submit
        setVal(fm, a.name); setVal(field(/Phone/i), PHONE); setVal(field(/Postal/i), a.postal);
        await wait(1500);  // the postal code can fill the street by itself; ours wins
        setVal(field(/Building|Street|Detailed Address/i), a.street);
        const unit = field(/Unit/i); if (unit) setVal(unit, a.unit);
        await wait(500); byText(/^(Submit|Save)$/i)?.click(); return act('filled');
      }
      if (fm && f.stage === 'filled' && Date.now() - f.at > 5000) {  // still open: Shopee refused it
        S.set(null); return stuck('Shopee did not accept the address form. Read its message on the form, fix it, then tap Submit yourself.');
      }
      if (list && f.stage === 'open') {  // the address list: the last saved address is the buyer slot; the first is your default
        if (edits.length > 1) edits[edits.length - 1].click(); else leaf(/Add New Address/i)[0].click();
        return act('edit');
      }
      if (list && f.stage === 'filled') {  // pick the slot we just wrote
        const card = [...document.querySelectorAll('div, li, label')].filter(x => vis(x) && x.innerText?.includes(a.postal) && /Edit/.test(x.innerText) && x.innerText.length < 200)
          .sort((x, y) => x.innerText.length - y.innerText.length)[0];
        if (card) { (card.querySelector('[role=radio], input[type=radio]')?.closest('label') || card.querySelector('[role=radio]') || card).click(); return act('pick'); }
      }
      if (!fm && !list && byText(/^Place Order$/i)) {  // back on checkout
        if (f.stage !== 'open' && addrCard()?.innerText.includes(a.postal)) { S.set(null); return await finish(a); }
        (byText(/^Change$/i) || addrCard())?.click(); return act(f.stage === 'open' ? 'open' : 'filled');
      }
      if (++f.idle > 25) { S.set(null); return stuck('Stopped at this screen while filling the address.'); }  // ~20s with nothing to do
      S.set(f);
    } finally { busy = false; }
  }
  async function finish(a) {
    // Shopee Coins: tick it when the item allows it
    let coins = leaf(/Coins cannot be redeemed/i).length ? 'cannot be used on this item' : 'none to use';
    const ch = [...document.querySelectorAll('h2, div, span')].find(x => vis(x) && x.innerText?.trim() === 'Shopee Coins');
    let row = ch; for (let k = 0; k < 4 && row && !row.querySelector('input[type=checkbox], [role=switch], [role=checkbox]'); k++) row = row.parentElement;
    const cb = row?.querySelector('input[type=checkbox], [role=switch], [role=checkbox]');
    if (cb) {
      if (cb.getAttribute('aria-disabled') === 'true' || cb.disabled) coins = 'cannot be used on this item';
      else { if (!(cb.checked || cb.getAttribute('aria-checked') === 'true')) { (cb.closest('label') || cb).click(); await wait(1500); } coins = 'used'; }
    }
    // PayNow, unless Shopee says that would drop a voucher (the phone's free-shipping voucher, 8 Nov): then it's your call
    let pay = 'PayNow';
    const pn = leaf(/^PayNow$/)[0];
    if (pn && !pn.closest('[class*=selected]')) {
      pn.click(); await wait(1500);
      const warn = leaf(/vouchers will be removed/i)[0];
      if (warn) {
        leaf(/^Cancel$/)[0]?.click(); await wait(800);
        pay = '<b>not changed</b>: PayNow would drop a voucher (' + (warn.textContent.split(':').pop().trim() || 'shipping discount') + '). Pick the payment yourself';
      }
    }
    const total = (document.body.innerText.match(/Total(?: Payment)?:?\s*\$\s*([\d.,]+)/gi) || []).pop()?.match(/[\d.,]+$/)?.[0];
    box(`✅ Address: ${a.name}, ${a.street} ${a.unit ? '#' + a.unit : ''}, ${a.postal}<br>Shopee Coins: ${coins}<br>Payment: ${pay}` +
        (total ? `<br>Total: <b>S$${total}</b>` : '') + '<br><br>Check the item, quantity and total, then tap <b>Place Order</b> yourself.');
  }
  async function checkout(auto) {
    const saved = JSON.parse(await store.get('caro-to') || 'null');
    if (auto && saved && Date.now() - saved.t < 2 * 3600e3) {  // only right after our own Buy Now, so a checkout of your own is never filled
      await store.set('caro-to', ''); return go('Ship To: ' + saved.to);
    }
    if (!S.get()) box('Copy the 🧾 order note in Telegram, then:<br>' + btn('paste', '📋 Paste note') + '<br>or paste it here:' + form());
  }

  // ── which page (Shopee is a single-page app: watch the URL) ──
  let last = '';
  setInterval(() => {
    if (!document.body) return;  // document-start: wait for the page
    step();
    // phone layout (8 Nov): checkout isn't at /checkout, so after our own Buy Now any page with Place Order counts as checkout
    if (sessionStorage.getItem('caro-going') && byText(/^Place Order$/i)) { sessionStorage.removeItem('caro-going'); return checkout(true); }
    if (location.href === last) return; last = location.href;
    const m = location.hash.match(/caro=([^&]+)/);
    if (m) sessionStorage.setItem('caro-order', dec(m[1]));
    if (location.pathname.startsWith('/verify'))  // Shopee's check: never touched
      return box('Shopee wants a quick check. Do it yourself, then tap the 🛍 link in the 🧾 note again.');
    const order = sessionStorage.getItem('caro-order');
    if (order && /\/product\/|-i\.\d+\.\d+/.test(location.pathname)) {
      sessionStorage.setItem('caro-going', '1');
      history.replaceState(null, '', location.pathname + location.search); last = location.href;
      product(order);
    } else if (/\/cart/.test(location.pathname) && sessionStorage.getItem('caro-going')) cart();
    else if (/checkout/.test(location.pathname) && !S.get()) { const auto = !!sessionStorage.getItem('caro-going'); sessionStorage.removeItem('caro-going'); checkout(auto); }
  }, 700);

  if (location.search.includes('caro-test')) {  // self-check of the note parser
    const u = parse('🧾 Order 013\nShip To: Sue | 85698379 | 1 Mount Faber Road, The Pearl | #01-04 | 099206');
    console.assert(u && u.name === 'Sue' && u.postal === '099206' && u.unit === '01-04' && u.street === '1 Mount Faber Road, The Pearl', JSON.stringify(u));
    console.assert(parse('Ship To: not given yet') === null);
    console.log('caro order parser ok', u);
  }
})();
