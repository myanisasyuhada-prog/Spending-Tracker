import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyChCBCo3sBlhtnGSb_6nN7nnt9vdAbR6qE",
  authDomain: "spending-tracker-75fcc.firebaseapp.com",
  databaseURL: "https://spending-tracker-75fcc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "spending-tracker-75fcc",
  storageBucket: "spending-tracker-75fcc.firebasestorage.app",
  messagingSenderId: "994344745480",
  appId: "1:994344745480:web:6ddc37e9e2e6c957a22fbd"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const KEY = 'spending-tracker-v1'; // local copy: used as a cache and as the source for the one-time move to the cloud
const PHOTO_KEY = 'spending-tracker-photo'; // local copy of the profile photo so it shows straight away

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const rm = n => 'RM ' + (Math.round(n * 100) / 100).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
const todayStr = () => ymd(new Date());
const curMonth = () => todayStr().slice(0, 7);
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(m) {
  return new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
}
const uid_ = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- intro screen ----------
const SPLASH_MS = 1800; // how long the intro stays at least (counted from when the page started loading)
function hideSplash() {
  const el = $('splash');
  if (!el || el.classList.contains('done')) return;
  const wait = Math.max(0, SPLASH_MS - performance.now());
  setTimeout(() => {
    el.classList.add('done');
    setTimeout(() => { el.hidden = true; }, 700); // remove it completely after the fade
  }, wait);
}

// ---------- state + cloud storage ----------
const blank = () => ({ allowance: 0, savings: 0, foods: 0, items: [], spends: [], months: {} });
let S = blank();
let uid = null;
let unsubscribe = null;
let unsubProfile = null;
let viewMonth = curMonth();

// Realtime Database drops empty arrays/objects and may hand arrays back as objects, so tidy up what we read
function normalize(v) {
  const toArr = x => Array.isArray(x) ? x.filter(Boolean) : (x ? Object.values(x) : []);
  return {
    allowance: Number(v.allowance) || 0,
    savings: Number(v.savings) || 0,
    foods: Number(v.foods) || 0,
    items: toArr(v.items),
    spends: toArr(v.spends),
    months: v.months || {}
  };
}
function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}
function setStatus(msg, isErr) {
  $('status').textContent = msg;
  $('status').className = 'status' + (isErr ? ' err' : '');
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  if (!uid) return;
  setStatus('Saving…');
  set(ref(db, 'users/' + uid + '/state'), JSON.parse(JSON.stringify(S)))
    .then(() => setStatus('Saved to cloud ✓'))
    .catch(e => setStatus(String(e.message || e).includes('PERMISSION_DENIED')
      ? 'Could not save: database Rules are blocking this account. Re-check the Rules.'
      : 'Could not save: ' + (e.message || e), true));
}

// Each month remembers the allowance/savings it had, so old months stay accurate
function ensureMonthSnapshot() {
  const m = curMonth();
  if (!S.months[m]) { S.months[m] = { allowance: S.allowance, savings: S.savings, foods: S.foods }; return true; }
  return false;
}

function startSync() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onValue(ref(db, 'users/' + uid + '/state'), snap => {
    const v = snap.val();
    let needsSave = false;
    if (v) {
      S = normalize(v);
    } else {
      // first time on the cloud: bring over anything already saved on this phone
      const local = readLocal();
      S = local ? normalize(local) : blank();
      needsSave = !!local;
    }
    if (ensureMonthSnapshot()) needsSave = true;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    if (needsSave) save(); else setStatus('Saved to cloud ✓');
    render();
  }, err => {
    setStatus(String(err.message || err).includes('permission_denied') || String(err.code || '').includes('PERMISSION')
      ? 'Cannot read database: check that the Rules were published.'
      : 'Cannot read database: ' + (err.message || err), true);
  });
}

// ---------- profile photo ----------
function showPhoto(dataUrl) {
  const has = !!dataUrl;
  if (has) $('avatarImg').src = dataUrl;
  $('avatarImg').hidden = !has;
  $('avatarPh').hidden = has;
  $('avatarPlus').hidden = has;
}

// shrink the chosen photo to a small square so it saves fast
function fileToAvatar(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(e); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read that photo')); };
    img.src = url;
  });
}

function startProfileSync() {
  if (unsubProfile) unsubProfile();
  try { const cached = localStorage.getItem(PHOTO_KEY); if (cached) showPhoto(cached); } catch (e) {}
  unsubProfile = onValue(ref(db, 'users/' + uid + '/profile'), snap => {
    const v = snap.val();
    const photo = v && typeof v.photo === 'string' ? v.photo : '';
    try { if (photo) localStorage.setItem(PHOTO_KEY, photo); else localStorage.removeItem(PHOTO_KEY); } catch (e) {}
    showPhoto(photo);
  }, () => {});
}

$('avatarBtn').onclick = () => $('photoInput').click();
$('photoInput').onchange = async ev => {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file || !uid) return;
  if (!file.type.startsWith('image/')) { setStatus('Please choose a photo.', true); return; }
  try {
    setStatus('Saving photo…');
    const dataUrl = await fileToAvatar(file);
    await set(ref(db, 'users/' + uid + '/profile'), { photo: dataUrl });
    setStatus('Photo saved ✓');
  } catch (e) {
    setStatus('Could not save photo: ' + (e.message || e), true);
  }
};

// ---------- numbers for any month ----------
function settingsFor(m) { return S.months[m] || { allowance: S.allowance, savings: S.savings, foods: S.foods }; }
function budgetFor(m) {
  const s = settingsFor(m);
  return Math.max((s.allowance || 0) - (s.savings || 0) - (s.foods || 0), 0);
}
function spentIn(m) { return S.spends.filter(x => x.date.startsWith(m)).reduce((t, x) => t + x.amount, 0); }
function remainingIn(m) { return budgetFor(m) - spentIn(m); }

// ---------- render ----------
function render() {
  const cur = curMonth();
  const isCur = viewMonth === cur;

  $('monthName').textContent = monthLabel(viewMonth);
  $('nextM').disabled = viewMonth >= shiftMonth(cur, 1);
  $('nextM').onclick = () => { if (viewMonth < shiftMonth(curMonth(), 1)) { viewMonth = shiftMonth(viewMonth, 1); render(); } };

  const rem = remainingIn(viewMonth), bud = budgetFor(viewMonth), spent = spentIn(viewMonth);
  const over = rem < 0;
  const pct = bud > 0 ? Math.min(spent / bud * 100, 100) : 0;
  $('hero').className = 'card hero' + (over ? ' over' : '');
  $('hero').innerHTML =
    '<div class="label">' + (isCur ? 'Remaining this month' : 'Left over in ' + monthLabel(viewMonth)) + '</div>' +
    '<div class="big">' + (over ? '-' : '') + rm(Math.abs(rem)) + '</div>' +
    '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
    '<div class="small">Spent ' + rm(spent) + ' of ' + rm(bud) + ' spending budget</div>' +
    (over ? '<div class="warn">' + (isCur ? 'You are over budget by ' : 'You went over budget by ') + rm(-rem) + '.</div>' : '') +
    (bud === 0 && isCur ? '<div class="small">Set your allowance under Monthly setup.</div>' : '');

  $('addSpendCard').hidden = !isCur;
  $('addWishForm').hidden = !isCur;

  $('spTitle').textContent = 'Bought in ' + monthLabel(viewMonth);
  const sp = S.spends.filter(x => x.date.startsWith(viewMonth)).sort((a, b) => b.date.localeCompare(a.date));
  $('spList').innerHTML = sp.length ? sp.map(x =>
    '<div class="item"><div class="top"><span>' + esc(x.note || 'Spending') + '</span><span>' + rm(x.amount) + '</span></div>' +
    '<div class="small">' + x.date + '</div>' +
    '<div class="actions"><button class="ghost" data-delsp="' + x.id + '">Delete</button></div></div>'
  ).join('') : '<div class="empty">Nothing spent this month.</div>';

  const list = S.items
    .filter(i => i.added.startsWith(viewMonth) || (isCur && i.status === 'pending'))
    .sort((a, b) => b.added.localeCompare(a.added));
  $('wList').innerHTML = list.length ? list.map(i => {
    const label = { pending: 'on wishlist', bought: 'bought', skipped: 'skipped' }[i.status];
    let actions = '';
    if (i.status === 'pending') {
      actions =
        '<button data-buy="' + i.id + '">Bought it</button>' +
        '<button class="ghost" data-delw="' + i.id + '">Remove</button>';
    }
    return '<div class="item"><div class="top"><span>' + esc(i.name) + '<span class="badge ' + i.status + '">' + label + '</span></span><span>' + rm(i.price) + '</span></div>' +
      '<div class="small">Added ' + i.added +
      (i.doneDate ? ' · ' + (i.status === 'bought' ? 'Bought ' : 'Skipped ') + i.doneDate : '') + '</div>' +
      (actions ? '<div class="actions">' + actions + '</div>' : '') + '</div>';
  }).join('') : '<div class="empty">Nothing on the wishlist for this month.</div>';

  const cfg = settingsFor(viewMonth);
  $('allowance').value = cfg.allowance || '';
  $('savings').value = cfg.savings || '';
  $('foods').value = cfg.foods || '';
  $('setupTitle').textContent = 'Monthly setup (' + monthLabel(viewMonth) + ')';
}

// ---------- actions ----------
function addSpend(amount, note) {
  const cur = curMonth();
  if (amount > remainingIn(cur) && !confirm('Over budget by ' + rm(amount - remainingIn(cur)) + '. Add anyway?')) return false;
  S.spends.push({ id: uid_(), amount, note, date: todayStr() });
  save(); render(); return true;
}

$('prevM').onclick = () => { viewMonth = shiftMonth(viewMonth, -1); render(); };

$('spAdd').onclick = () => {
  const amount = parseFloat($('spAmount').value);
  if (!(amount > 0)) return;
  if (addSpend(amount, $('spNote').value.trim())) { $('spAmount').value = ''; $('spNote').value = ''; }
};

$('wAdd').onclick = () => {
  const name = $('wName').value.trim(), price = parseFloat($('wPrice').value);
  if (!name || !(price > 0)) return;
  S.items.push({ id: uid_(), name, price, added: todayStr(), status: 'pending' });
  save(); render();
  $('wName').value = ''; $('wPrice').value = '';
};

$('saveSetup').onclick = () => {
  const cfg = {
    allowance: parseFloat($('allowance').value) || 0,
    savings: parseFloat($('savings').value) || 0,
    foods: parseFloat($('foods').value) || 0
  };
  S.months[viewMonth] = cfg;
  if (viewMonth === curMonth()) {
    S.allowance = cfg.allowance;
    S.savings = cfg.savings;
    S.foods = cfg.foods;
  }
  save(); render();
};

document.addEventListener('click', e => {
  const t = e.target;
  if (t.dataset.delsp) { S.spends = S.spends.filter(x => x.id !== t.dataset.delsp); save(); render(); }
  if (t.dataset.delw) { S.items = S.items.filter(x => x.id !== t.dataset.delw); save(); render(); }
  if (t.dataset.buy) {
    const i = S.items.find(x => x.id === t.dataset.buy);
    if (addSpend(i.price, i.name)) { i.status = 'bought'; i.doneDate = todayStr(); save(); render(); }
  }
});

// ---------- login / logout ----------
function loginMessage(e) {
  const c = e.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email'))
    return 'Email or password is wrong.';
  if (c.includes('operation-not-allowed'))
    return 'Email/Password sign-in is not enabled yet in Firebase Authentication.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a bit and try again.';
  if (c.includes('network')) return 'No internet connection.';
  return 'Could not log in: ' + (e.message || c);
}

$('loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('loginErr').textContent = '';
  $('loginBtn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
  } catch (e) {
    $('loginErr').textContent = loginMessage(e);
  }
  $('loginBtn').disabled = false;
});

$('logout').onclick = async () => {
  if (!confirm('Log out? Your data stays safe in the cloud.')) return;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unsubProfile) { unsubProfile(); unsubProfile = null; }
  try { localStorage.removeItem(KEY); localStorage.removeItem(PHOTO_KEY); } catch (e) {}
  S = blank();
  showPhoto('');
  await signOut(auth);
};

onAuthStateChanged(auth, user => {
  $('loading').hidden = true;
  if (user) {
    uid = user.uid;
    $('acct').textContent = 'Logged in as ' + user.email;
    $('loginView').hidden = true;
    $('appView').hidden = false;
    $('password').value = '';
    setStatus('Loading your data…');
    startSync();
    startProfileSync();
  } else {
    uid = null;
    $('appView').hidden = true;
    $('loginView').hidden = false;
  }
  hideSplash();
});

// ---------- install as an app (PWA) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}