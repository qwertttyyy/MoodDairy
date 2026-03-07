/* app.js — Moods (client-side encryption + DRF backend) */

// ============================================
// CONSTANTS
// ============================================

const MOOD_COLORS = ['', '#ff3b30', '#ff6b3d', 'rgb(255, 149, 0)', '#ffcc00', '#c7c729', '#a8d84e', '#34c759', '#30b0c7', '#5ac8fa'];
const MOOD_LABELS = ['', 'Ужасно', 'Очень плохо', 'Плохо', 'Так себе', 'Нормально', 'Неплохо', 'Хорошо', 'Отлично', 'Прекрасно'];
const MOOD_EMOJI = ['', '😣', '😞', '😕', '😐', '🙂', '😊', '😄', '😁', '🤩'];
const SETTINGS_KEY = 'moods_settings';

// ============================================
// UTILS
// ============================================

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function dayLabel(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T12:00:00');
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function isoDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoTimeStr(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : '';
}

function showToast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden', 'error', 'show');
  if (isError) t.classList.add('error');
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 300); }, 2500);
}

// ============================================
// CRYPTO — Web Crypto API (PBKDF2 + AES-GCM)
// ============================================

const Crypto = {
  PBKDF2_ITERATIONS: 600000,
  ENC_KEY_STORAGE: 'enc_key',
  WRAPPED_KEY_STORAGE: 'wrapped_enc_key',

  _encKey: null,

  async deriveKey(password, saltB64) {
    const enc = new TextEncoder();
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: this.PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return bits;
  },

  generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...salt));
  },

  async encrypt(plaintext) {
    const key = await this._getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
    return btoa(String.fromCharCode(...iv)) + ':' + btoa(String.fromCharCode(...new Uint8Array(ct)));
  },

  async decrypt(blob) {
    if (!blob || !blob.includes(':')) return '';
    const [ivB64, ctB64] = blob.split(':', 2);
    const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
    const key = await this._getCryptoKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  },

  async wrapKey(wrappingKeyB64) {
    const raw = this._getRawKey();
    if (!raw) return;
    const wk = Uint8Array.from(atob(wrappingKeyB64), c => c.charCodeAt(0));
    const wrapKey = await crypto.subtle.importKey('raw', wk, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw);
    const blob = btoa(String.fromCharCode(...iv)) + ':' + btoa(String.fromCharCode(...new Uint8Array(wrapped)));
    localStorage.setItem(this.WRAPPED_KEY_STORAGE, blob);
  },

  async unwrapKey(wrappingKeyB64) {
    const blob = localStorage.getItem(this.WRAPPED_KEY_STORAGE);
    if (!blob) return false;
    const [ivB64, ctB64] = blob.split(':', 2);
    const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
    const wk = Uint8Array.from(atob(wrappingKeyB64), c => c.charCodeAt(0));
    const wrapKey = await crypto.subtle.importKey('raw', wk, 'AES-GCM', false, ['decrypt']);
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
    this._storeRawKey(new Uint8Array(raw));
    return true;
  },

  storeFromDerived(bits) {
    const raw = new Uint8Array(bits);
    this._storeRawKey(raw);
  },

  _storeRawKey(raw) {
    sessionStorage.setItem(this.ENC_KEY_STORAGE, btoa(String.fromCharCode(...raw)));
    this._encKey = null;
  },

  _getRawKey() {
    const b64 = sessionStorage.getItem(this.ENC_KEY_STORAGE);
    return b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : null;
  },

  async _getCryptoKey() {
    if (this._encKey) return this._encKey;
    const raw = this._getRawKey();
    if (!raw) throw new Error('Encryption key not available');
    this._encKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return this._encKey;
  },

  hasKey() { return !!sessionStorage.getItem(this.ENC_KEY_STORAGE); },
  hasWrapped() { return !!localStorage.getItem(this.WRAPPED_KEY_STORAGE); },

  clear() {
    sessionStorage.removeItem(this.ENC_KEY_STORAGE);
    localStorage.removeItem(this.WRAPPED_KEY_STORAGE);
    this._encKey = null;
  }
};

// ============================================
// API
// ============================================

const Api = {
  async _fetch(url, opts = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf(), ...(opts.headers || {}) };
    const res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
    return res;
  },

  async get(url) { return this._fetch(url); },

  async post(url, body) {
    return this._fetch(url, { method: 'POST', body: JSON.stringify(body) });
  },

  async put(url, body) {
    return this._fetch(url, { method: 'PUT', body: JSON.stringify(body) });
  },

  async del(url) {
    return this._fetch(url, { method: 'DELETE' });
  },

  parseErrors(data) {
    if (typeof data === 'string') return data;
    if (data.detail) return data.detail;
    if (data.non_field_errors) return data.non_field_errors.join(' ');
    const msgs = [];
    for (const [field, errs] of Object.entries(data)) {
      const e = Array.isArray(errs) ? errs.join(' ') : errs;
      msgs.push(`${field}: ${e}`);
    }
    return msgs.join('\n') || 'Произошла ошибка';
  }
};

// ============================================
// AUTH
// ============================================

const Auth = {
  mode: 'login',
  _password: null,

  init() {
    $$('.auth-tab').forEach(t => t.addEventListener('click', () => this.switchMode(t.dataset.auth)));
    $('#auth-submit').addEventListener('click', () => this.submit());
    $('#auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') this.submit(); });
  },

  switchMode(mode) {
    this.mode = mode;
    $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.auth === mode));
    $('#auth-submit').textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
    $('#auth-password').placeholder = mode === 'register' ? 'Минимум 8 символов' : 'Пароль';
    $('#auth-error').classList.add('hidden');
  },

  async submit() {
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    $('#auth-error').classList.add('hidden');

    if (!username) return this.showError('Введите логин');
    if (!password) return this.showError('Введите пароль');
    if (this.mode === 'register' && password.length < 8) return this.showError('Пароль минимум 8 символов');

    this._password = password;

    try {
      if (this.mode === 'register') {
        await this.register(username, password);
      } else {
        await this.login(username, password);
      }
    } catch (err) {
      this.showError(err.message);
    }
  },

  async register(username, password) {
    const salt = Crypto.generateSalt();
    const bits = await Crypto.deriveKey(password, salt);
    Crypto.storeFromDerived(bits);

    const res = await Api.post('/api/auth/register/', { username, password, encryption_salt: salt });
    const data = await res.json();
    if (!res.ok) throw new Error(Api.parseErrors(data));

    await Crypto.wrapKey(data.wrapping_key);
    this._password = null;
    App.start();
  },

  async login(username, password) {
    const res = await Api.post('/api/auth/login/', { username, password });
    const data = await res.json();
    if (!res.ok) throw new Error(Api.parseErrors(data));

    const profRes = await Api.get('/api/auth/profile/');
    const profData = await profRes.json();

    const bits = await Crypto.deriveKey(password, profData.encryption_salt);
    Crypto.storeFromDerived(bits);
    await Crypto.wrapKey(data.wrapping_key);
    this._password = null;
    App.start();
  },

  async tryRestore() {
    const meRes = await Api.get('/api/auth/me/');
    if (!meRes.ok) return false;

    if (Crypto.hasKey()) return true;

    if (Crypto.hasWrapped()) {
      const res = await Api.get('/api/auth/unwrap-key/');
      if (!res.ok) return false;
      const data = await res.json();
      await Crypto.unwrapKey(data.wrapping_key);
      return true;
    }

    return false;
  },

  async logout() {
    Crypto.clear();
    await Api.post('/api/auth/logout/', {});
    location.reload();
  },

  showError(msg) {
    const el = $('#auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
};

// ============================================
// TAGS
// ============================================

const Tags = {
  list: [],

  async load() {
    const res = await Api.get('/api/tags/');
    if (res.ok) this.list = await res.json();
  },

  render(selectedIds = []) {
    const el = $('#tag-chips');
    el.innerHTML = this.list.map(t =>
      `<button type="button" class="tag-chip${selectedIds.includes(t.id) ? ' selected' : ''}" data-id="${t.id}">${esc(t.name)}</button>`
    ).join('');
    el.querySelectorAll('.tag-chip').forEach(c => {
      c.addEventListener('click', () => c.classList.toggle('selected'));
    });
  },

  getSelected() {
    return [...$('#tag-chips').querySelectorAll('.tag-chip.selected')].map(c => +c.dataset.id);
  }
};

// ============================================
// ENTRIES
// ============================================

const Entries = {
  groups: {},
  nextBefore: undefined,
  loading: false,
  hasMore: true,
  decryptedCache: {},

  async loadPage() {
    if (this.loading || !this.hasMore) return;
    this.loading = true;
    $('#scroll-loader').classList.remove('hidden');

    let url = '/api/entries/grouped/';
    if (this.nextBefore) url += `?before=${this.nextBefore}`;

    try {
      const res = await Api.get(url);
      if (!res.ok) { showToast('Ошибка загрузки', true); return; }
      const data = await res.json();

      for (const [day, items] of Object.entries(data.results)) {
        const decrypted = await Promise.all(items.map(e => this._decryptEntry(e)));
        if (!this.groups[day]) this.groups[day] = [];
        this.groups[day].push(...decrypted);
      }

      this.nextBefore = data.next_before;
      this.hasMore = !!data.next_before;
      this.render();
    } catch (err) {
      showToast('Ошибка сети', true);
    } finally {
      this.loading = false;
      $('#scroll-loader').classList.toggle('hidden', !this.hasMore);
    }
  },

  async _decryptEntry(raw) {
    const mood = parseInt(await Crypto.decrypt(raw.mood), 10) || 0;
    const note = raw.note ? await Crypto.decrypt(raw.note) : '';
    const entry = { ...raw, mood, note, _raw: raw };
    this.decryptedCache[raw.id] = entry;
    return entry;
  },

  render() {
    const list = $('#entries-list');
    const days = Object.keys(this.groups).sort().reverse();
    const hasEntries = days.length > 0;

    $('#empty-home').classList.toggle('hidden', hasEntries);
    list.classList.toggle('hidden', !hasEntries);
    if (!hasEntries) { list.innerHTML = ''; return; }

    let html = '';
    for (const day of days) {
      html += `<div class="date-group-label">${dayLabel(day)}</div>`;
      for (const e of this.groups[day]) html += this._cardHTML(e);
    }
    list.innerHTML = html;

    list.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.entry-delete-btn')) return;
        this.openDetail(+card.dataset.id);
      });
    });

    list.querySelectorAll('.entry-delete-btn').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        Confirm.show('Удалить запись?', 'Это действие нельзя отменить.', () => this.remove(+btn.dataset.id));
      });
    });
  },

  _cardHTML(e) {
    const note = e.note ? `<p class="entry-note">${esc(e.note)}</p>` : '';
    const tags = (e.tags || []).map(t => `<span class="entry-tag">#${esc(t.name)}</span>`).join(' ');

    return `
      <div class="entry-card" data-id="${e.id}">
        <div class="entry-mood-badge" style="background:${MOOD_COLORS[e.mood]}">${MOOD_EMOJI[e.mood]}</div>
        <div class="entry-body">
          <div class="entry-top-row">
            <span class="entry-mood-text">${MOOD_LABELS[e.mood]}</span>
            <span class="entry-time">${formatTime(e.timestamp)}</span>
          </div>
          <div class="entry-card-footer">
            <div class="entry-block-right">
              ${note}${tags ? `<div class="entry-block-tags">${tags}</div>` : ''}
            </div>
            <button class="entry-delete-btn" data-id="${e.id}" aria-label="Удалить">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>

        </div>
      </div>`;
  },

  openDetail(id) {
    const e = this.decryptedCache[id];
    if (!e) return;
    EntryModal.open(e);
  },

  async save(data, editId) {
    const mood = await Crypto.encrypt(String(data.mood));
    const note = data.note ? await Crypto.encrypt(data.note) : '';

    const body = { mood, note, tags: data.tags, timestamp: data.timestamp };

    let res;
    if (editId) {
      res = await Api.put(`/api/entries/${editId}/`, body);
    } else {
      res = await Api.post('/api/entries/', body);
    }

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(Api.parseErrors(errData));
    }

    this.reset();
    await this.loadPage();
  },

  async remove(id) {
    const res = await Api.del(`/api/entries/${id}/`);
    if (!res.ok) { showToast('Ошибка удаления', true); return; }
    this.reset();
    await this.loadPage();
  },

  reset() {
    this.groups = {};
    this.nextBefore = undefined;
    this.hasMore = true;
    this.decryptedCache = {};
  }
};

// ============================================
// ENTRY MODAL
// ============================================

const EntryModal = {
  editId: null,
  selectedMood: 0,

  init() {
    this.buildMoodPicker();
    $('#modal-entry-close').addEventListener('click', () => this.close());
    $('#modal-entry').addEventListener('click', e => { if (e.target.id === 'modal-entry') this.close(); });
    $('#btn-save-entry').addEventListener('click', () => this.save());
    $('#entry-date').setAttribute('max', isoDateStr(new Date()));
    $('#entry-date').addEventListener('change', () => this._enforceDTMax());
    $('#entry-time').addEventListener('change', () => this._enforceDTMax());
  },

  buildMoodPicker() {
    const el = $('#mood-picker');
    el.innerHTML = '';
    for (let i = 1; i <= 9; i++) {
      const b = document.createElement('button');
      b.className = 'mood-btn'; b.type = 'button'; b.dataset.mood = i;
      b.textContent = i; b.style.background = MOOD_COLORS[i];
      b.addEventListener('click', () => this.selectMood(i));
      el.appendChild(b);
    }
  },

  selectMood(v) {
    this.selectedMood = v;
    $$('#mood-picker .mood-btn').forEach(b => b.classList.toggle('selected', +b.dataset.mood === v));
    $('#mood-value-display').textContent = `${MOOD_EMOJI[v]} ${MOOD_LABELS[v]}`;
    $('#btn-save-entry').disabled = false;
  },

  open(entry = null) {
    this.editId = entry ? entry.id : null;
    this.selectedMood = entry ? entry.mood : 0;
    $('#form-error').classList.add('hidden');

    $('#modal-entry-title').textContent = entry ? 'Редактировать' : 'Новая запись';
    $('#entry-note').value = entry ? (entry.note || '') : '';
    $('#entry-id').value = entry ? entry.id : '';

    const now = new Date();
    const ts = entry ? new Date(entry.timestamp) : now;
    $('#entry-date').value = isoDateStr(ts);
    $('#entry-time').value = isoTimeStr(ts);
    $('#entry-date').setAttribute('max', isoDateStr(now));
    this._enforceDTMax();

    const selectedTagIds = entry ? (entry.tags || []).map(t => t.id) : [];
    Tags.render(selectedTagIds);

    $$('#mood-picker .mood-btn').forEach(b =>
      b.classList.toggle('selected', entry && +b.dataset.mood === entry.mood)
    );
    $('#mood-value-display').textContent = entry ? `${MOOD_EMOJI[entry.mood]} ${MOOD_LABELS[entry.mood]}` : '—';
    $('#btn-save-entry').disabled = !entry;
    $('#btn-save-entry').textContent = entry ? 'Сохранить' : 'Добавить';

    $('#modal-entry').classList.remove('hidden');
  },

  close() {
    $('#modal-entry').classList.add('hidden');
    this.editId = null;
    this.selectedMood = 0;
  },

  async save() {
    if (!this.selectedMood) return;
    const dateVal = $('#entry-date').value;
    const timeVal = $('#entry-time').value;

    if (!dateVal || !timeVal) {
      this._showError('Укажите дату и время');
      return;
    }

    const ts = new Date(`${dateVal}T${timeVal}:00`);
    if (ts > new Date()) {
      this._showError('Дата не может быть в будущем');
      return;
    }

    const data = {
      mood: this.selectedMood,
      note: $('#entry-note').value.trim(),
      tags: Tags.getSelected(),
      timestamp: ts.toISOString()
    };

    $('#btn-save-entry').disabled = true;
    try {
      await Entries.save(data, this.editId);
      this.close();
      showToast(this.editId ? 'Запись обновлена' : 'Запись добавлена');
    } catch (err) {
      this._showError(err.message);
    } finally {
      $('#btn-save-entry').disabled = false;
    }
  },

  _showError(msg) {
    const el = $('#form-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  _enforceDTMax() {
    const today = isoDateStr(new Date());
    if ($('#entry-date').value === today) {
      const now = isoTimeStr(new Date());
      $('#entry-time').setAttribute('max', now);
      if ($('#entry-time').value > now) $('#entry-time').value = now;
    } else {
      $('#entry-time').removeAttribute('max');
    }
  }
};

// ============================================
// CONFIRM DIALOG
// ============================================

const Confirm = {
  _callback: null,

  init() {
    $('#btn-confirm-cancel').addEventListener('click', () => this.close());
    $('#btn-confirm-ok').addEventListener('click', () => { if (this._callback) this._callback(); this.close(); });
    $('#modal-confirm').addEventListener('click', e => { if (e.target.id === 'modal-confirm') this.close(); });
  },

  show(title, text, cb) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    this._callback = cb;
    $('#modal-confirm').classList.remove('hidden');
  },

  close() {
    $('#modal-confirm').classList.add('hidden');
    this._callback = null;
  }
};

// ============================================
// CHART
// ============================================

const Chart = {
  period: 'all',

  init() {
    $$('.seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        $$('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.period = b.dataset.period;
        this._updateSegIndicator();
        this.load();
      });
    });
    requestAnimationFrame(() => this._updateSegIndicator());
  },

  async load() {
    let url = '/api/entries/';
    if (this.period !== 'all') url += `?period=${this.period}`;

    const res = await Api.get(url);
    if (!res.ok) return;
    const raw = await res.json();

    const entries = await Promise.all(raw.map(async e => ({
      mood: parseInt(await Crypto.decrypt(e.mood), 10) || 0,
      timestamp: e.timestamp
    })));

    const valid = entries.filter(e => e.mood >= 1 && e.mood <= 9).sort((a, b) =>
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    const has = valid.length > 0;
    $('#empty-chart').classList.toggle('hidden', has);
    $('#mood-chart').closest('.chart-wrapper').classList.toggle('hidden', !has);
    $('#chart-stats').classList.toggle('hidden', !has);
    if (!has) return;

    this._draw(valid);
    this._stats(valid);
  },

  _draw(entries) {
    const canvas = $('#mood-chart');
    const dpr = devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth - 20, H = 200;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);

    const pL = 28, pR = 12, pT = 16, pB = 30;
    const plotW = W - pL - pR, plotH = H - pT - pB;

    const cs = getComputedStyle(document.documentElement);
    const txtC = cs.getPropertyValue('--c-tertiary').trim() || '#aaa';
    const accC = cs.getPropertyValue('--accent').trim() || '#007aff';

    ctx.font = '500 10px Nunito,sans-serif'; ctx.fillStyle = txtC; ctx.textAlign = 'right';
    for (const v of [1, 3, 5, 7, 9]) {
      const y = pT + plotH - ((v - 1) / 8) * plotH;
      ctx.strokeStyle = 'rgba(128,128,128,0.12)'; ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(v, pL - 6, y + 4);
    }

    // Агрегация: если точек > 90, усредняем по дням
    let pts;
    if (entries.length > 90) {
      const byDay = {};
      entries.forEach(e => {
        const d = e.timestamp.slice(0, 10);
        if (!byDay[d]) byDay[d] = [];
        byDay[d].push(e.mood);
      });
      const days = Object.keys(byDay).sort();
      pts = days.map((d, i) => {
        const avg = byDay[d].reduce((s, v) => s + v, 0) / byDay[d].length;
        return {
          x: pL + (i / Math.max(days.length - 1, 1)) * plotW,
          y: pT + plotH - ((avg - 1) / 8) * plotH,
          mood: Math.round(avg), ts: d
        };
      });
    } else {
      pts = entries.map((e, i) => ({
        x: pL + (i / Math.max(entries.length - 1, 1)) * plotW,
        y: pT + plotH - ((e.mood - 1) / 8) * plotH,
        mood: e.mood, ts: e.timestamp
      }));
    }

    if (pts.length < 2) {
      const p = pts[0];
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = MOOD_COLORS[p.mood]; ctx.fill();
      return;
    }

    // Area
    const grad = ctx.createLinearGradient(0, pT, 0, pT + plotH);
    const r = parseInt(accC.slice(1, 3), 16), g = parseInt(accC.slice(3, 5), 16), b = parseInt(accC.slice(5, 7), 16);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.2)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.01)`);

    ctx.beginPath(); ctx.moveTo(pts[0].x, pT + plotH); ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const cp = (pts[i - 1].x + pts[i].x) / 2;
      ctx.bezierCurveTo(cp, pts[i - 1].y, cp, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.lineTo(pts[pts.length - 1].x, pT + plotH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Line
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const cp = (pts[i - 1].x + pts[i].x) / 2;
      ctx.bezierCurveTo(cp, pts[i - 1].y, cp, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = accC; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();

    // Dots (skip if too many)
    if (pts.length <= 60) {
      pts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = MOOD_COLORS[p.mood] || accC; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      });
    }

    // X labels
    ctx.fillStyle = txtC; ctx.textAlign = 'center'; ctx.font = '500 9px Nunito,sans-serif';
    const maxLabels = 6;
    const step = Math.max(1, Math.floor(pts.length / maxLabels));
    for (let i = 0; i < pts.length; i += step) {
      ctx.fillText(formatDateShort(pts[i].ts), pts[i].x, H - 6);
    }
    const last = pts[pts.length - 1];
    if (pts.length % step !== 1) ctx.fillText(formatDateShort(last.ts), last.x, H - 6);
  },

  _stats(entries) {
    const moods = entries.map(e => e.mood);
    const avg = (moods.reduce((s, v) => s + v, 0) / moods.length).toFixed(1);
    $('#chart-stats').innerHTML = `
      <div class="stat-item"><div class="stat-value">${avg}</div><div class="stat-label">Среднее</div></div>
      <div class="stat-item"><div class="stat-value">${Math.max(...moods)}</div><div class="stat-label">Макс</div></div>
      <div class="stat-item"><div class="stat-value">${Math.min(...moods)}</div><div class="stat-label">Мин</div></div>
      <div class="stat-item"><div class="stat-value">${entries.length}</div><div class="stat-label">Записей</div></div>`;
  },

  _updateSegIndicator() {
    const active = document.querySelector('.seg-btn.active');
    const ind = $('#seg-indicator');
    if (!active || !ind) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  }
};

// ============================================
// TABS
// ============================================

const TabNav = {
  current: 'home',

  init() {
    $$('.tab-btn').forEach(b => b.addEventListener('click', () => this.switchTo(b.dataset.tab)));
    requestAnimationFrame(() => this._updateIndicator());
  },

  switchTo(name) {
    this.current = name;
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $('#tab-home').classList.toggle('hidden', name !== 'home');
    $('#tab-chart').classList.toggle('hidden', name !== 'chart');
    $('#tab-settings').classList.toggle('hidden', name !== 'settings');

    const titles = { home: 'Moods', chart: 'График', settings: 'Настройки' };
    $('#screen-title').textContent = titles[name];
    $('#btn-add-entry').classList.toggle('hidden', name !== 'home');

    this._updateIndicator();
    if (name === 'chart') { Chart._updateSegIndicator(); Chart.load(); }
  },

  _updateIndicator() {
    const active = document.querySelector('.tab-btn.active');
    const ind = $('#tab-indicator');
    if (!active || !ind) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  }
};

// ============================================
// SETTINGS
// ============================================

const Settings = {
  init() {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (s.darkMode) { document.documentElement.setAttribute('data-theme', 'dark'); $('#toggle-theme').checked = true; }
    if (s.reduceTransparency) { document.documentElement.classList.add('reduce-transparency'); $('#toggle-transparency').checked = true; }

    $('#toggle-theme').addEventListener('change', () => {
      const dark = $('#toggle-theme').checked;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      this._save({ darkMode: dark });
    });

    $('#toggle-transparency').addEventListener('change', () => {
      const r = $('#toggle-transparency').checked;
      document.documentElement.classList.toggle('reduce-transparency', r);
      this._save({ reduceTransparency: r });
    });

    $('#btn-export').addEventListener('click', () => {
      window.location.href = '/api/entries/export/';
    });

    $('#btn-logout').addEventListener('click', () => {
      Confirm.show('Выйти из аккаунта?', 'Зашифрованные ключи будут удалены.', () => Auth.logout());
    });
  },

  _save(patch) {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, ...patch }));
  }
};

// ============================================
// INFINITE SCROLL
// ============================================

function initScroll() {
  const container = $('#tab-home');
  window.addEventListener('scroll', () => {
    if (TabNav.current !== 'home') return;
    if (Entries.loading || !Entries.hasMore) return;
    const threshold = document.documentElement.scrollHeight - window.innerHeight - 200;
    if (window.scrollY >= threshold) Entries.loadPage();
  });
}

// ============================================
// APP
// ============================================

const App = {
  async init() {
    Settings.init();
    Auth.init();

    try {
      const restored = await Auth.tryRestore();
      if (restored) {
        this.start();
      } else {
        this.showAuth();
      }
    } catch {
      this.showAuth();
    }
  },

  async start() {
    $('#auth-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');

    TabNav.init();
    EntryModal.init();
    Confirm.init();
    Chart.init();
    await Tags.load();
    await Entries.loadPage();
    initScroll();
    $('#btn-add-entry').addEventListener('click', () => EntryModal.open());
  },

  showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#app').classList.add('hidden');
  }
};

// ============================================
// RESIZE
// ============================================

let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    TabNav._updateIndicator();
    Chart._updateSegIndicator();
    if (TabNav.current === 'chart') Chart.load();
  }, 150);
});

// ============================================
// BOOT
// ============================================

document.addEventListener('DOMContentLoaded', () => App.init());
