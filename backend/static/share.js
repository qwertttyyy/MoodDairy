/* share.js — Страница врача (read-only, без авторизации) */

const MOOD_COLORS = ['', '#ff3b30', '#ff6b3d', '#ff9500', '#ffcc00', '#c7c729', '#a8d84e', '#34c759', '#30b0c7', '#5ac8fa'];
const MOOD_LABELS = ['', 'Ужасно', 'Очень плохо', 'Плохо', 'Так себе', 'Нормально', 'Неплохо', 'Хорошо', 'Отлично', 'Прекрасно'];
const MOOD_EMOJI = ['', '😣', '😞', '😕', '😐', '🙂', '😊', '😄', '😁', '🤩'];

const ANXIETY_COLORS = ['','#34c759','#a8d84e','#ffcc00','#ff9500','#ff3b30'];
const ANXIETY_EMOJI  = ['','😌','😐','😟','😰','🫨'];

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const $ = s => document.querySelector(s);

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateShort(iso) {
    return new Date(iso).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short'
    });
}

function dayLabel(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function uint8ToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function b64ToUint8(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

async function decryptBlob(blobStr, keyB64) {
    const [ivB64, ctB64] = blobStr.split(':', 2);
    const iv = b64ToUint8(ivB64);
    const ct = b64ToUint8(ctB64);
    const rawKey = b64ToUint8(keyB64);
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, key, ct);
    return new TextDecoder().decode(plain);
}

let allEntries = [];
let currentYear, currentMonth;
let minYear, minMonth, maxYear, maxMonth;

document.addEventListener('DOMContentLoaded', async () => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    const pathParts = location.pathname.split('/').filter(Boolean);
    const token = pathParts[pathParts.length - 1];
    const shareKeyB64 = location.hash ? location.hash.slice(1) : '';

    try {
        const res = await fetch(`/api/sharing/${token}/data/`);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();

        let json;
        if (data.is_encrypted) {
            if (!shareKeyB64) throw new Error('no_key');
            json = await decryptBlob(data.data_blob, shareKeyB64);
        } else {
            json = data.data_blob;
        }

        allEntries = JSON.parse(json);
        allEntries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        initApp();
    } catch (err) {
        $('#share-loading').classList.add('hidden');
        $('#share-error').classList.remove('hidden');
        if (err.message === 'no_key') {
            $('#share-error-title').textContent = 'Ключ отсутствует';
        }
    }
});

function initApp() {
    $('#share-loading').classList.add('hidden');
    $('#share-content').classList.remove('hidden');

    if (allEntries.length) {
        const first = new Date(allEntries[0].timestamp);
        const last = new Date(allEntries[allEntries.length - 1].timestamp);
        minYear = first.getFullYear();
        minMonth = first.getMonth() + 1;
        maxYear = last.getFullYear();
        maxMonth = last.getMonth() + 1;
    } else {
        const now = new Date();
        minYear = maxYear = now.getFullYear();
        minMonth = maxMonth = now.getMonth() + 1;
    }

    currentYear = maxYear;
    currentMonth = maxMonth;

    $('#month-prev').addEventListener('click', () => changeMonth(-1));
    $('#month-next').addEventListener('click', () => changeMonth(1));

    renderMonth();
}

function changeMonth(dir) {
    currentMonth += dir;
    if (currentMonth > 12) {
        currentYear++;
        currentMonth = 1;
    }
    if (currentMonth < 1) {
        currentYear--;
        currentMonth = 12;
    }
    clampMonth();
    renderMonth();
}

function clampMonth() {
    if (currentYear < minYear || (currentYear === minYear && currentMonth < minMonth)) {
        currentYear = minYear;
        currentMonth = minMonth;
    }
    if (currentYear > maxYear || (currentYear === maxYear && currentMonth > maxMonth)) {
        currentYear = maxYear;
        currentMonth = maxMonth;
    }
}

function getMonthEntries() {
    return allEntries.filter(e => {
        const d = new Date(e.timestamp);
        return d.getFullYear() === currentYear && d.getMonth() + 1 === currentMonth;
    });
}

function renderMonth() {
    $('#month-label').textContent = `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

    const atMin = currentYear === minYear && currentMonth === minMonth;
    const atMax = currentYear === maxYear && currentMonth === maxMonth;
    $('#month-prev').disabled = atMin;
    $('#month-next').disabled = atMax;
    $('#month-prev').style.opacity = atMin ? '0.3' : '1';
    $('#month-next').style.opacity = atMax ? '0.3' : '1';

    const entries = getMonthEntries();
    const has = entries.length > 0;

    $('#chart-wrapper').classList.toggle('hidden', !has);
    $('#chart-stats').classList.toggle('hidden', !has);
    $('#empty-month').classList.toggle('hidden', has);

    if (has) {
        drawChart(entries);
        drawStats(entries);
    }
    renderEntries(entries);
}

function drawChart(entries) {
    const canvas = $('#mood-chart');
    const dpr = devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth - 20, H = 200;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const pL = 28, pR = 12, pT = 16, pB = 32;
    const plotW = W - pL - pR, plotH = H - pT - pB;

    const cs = getComputedStyle(document.documentElement);
    const txtC = cs.getPropertyValue('--c-tertiary').trim() || '#aaa';
    const accC = cs.getPropertyValue('--accent').trim() || '#007aff';

    ctx.font = '500 10px Nunito,sans-serif';
    ctx.fillStyle = txtC;
    ctx.textAlign = 'right';
    for (const v of [1, 3, 5, 7, 9]) {
        const y = pT + plotH - ((v - 1) / 8) * plotH;
        ctx.strokeStyle = 'rgba(128,128,128,0.12)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pL, y);
        ctx.lineTo(pL + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(v, pL - 6, y + 4);
    }

    const byDay = {};
    entries.forEach(e => {
        const d = e.timestamp.slice(0, 10);
        if (!byDay[d]) byDay[d] = [];
        byDay[d].push(e.mood);
    });
    const days = Object.keys(byDay).sort();
    let dayAvgs = days.map(d => ({
        day: d,
        avg: byDay[d].reduce((s, v) => s + v, 0) / byDay[d].length,
    }));

    if (dayAvgs.length > 14) {
        dayAvgs = sma(dayAvgs, 3);
    }

    const pts = dayAvgs.map((d, i) => ({
        x: pL + (i / Math.max(dayAvgs.length - 1, 1)) * plotW,
        y: pT + plotH - ((d.avg - 1) / 8) * plotH,
        mood: Math.round(d.avg),
        ts: d.day,
    }));

    if (pts.length < 2) {
        if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI * 2);
            ctx.fillStyle = MOOD_COLORS[pts[0].mood];
            ctx.fill();
        }
        return;
    }

    const r = parseInt(accC.slice(1, 3), 16),
        g = parseInt(accC.slice(3, 5), 16), b = parseInt(accC.slice(5, 7), 16);
    const grad = ctx.createLinearGradient(0, pT, 0, pT + plotH);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.2)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.01)`);

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pT + plotH);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        const cp = (pts[i - 1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cp, pts[i - 1].y, cp, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.lineTo(pts[pts.length - 1].x, pT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
        const cp = (pts[i - 1].x + pts[i].x) / 2;
        ctx.bezierCurveTo(cp, pts[i - 1].y, cp, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = accC;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    if (pts.length <= 60) {
        pts.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = MOOD_COLORS[p.mood] || accC;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.2;
            ctx.stroke();
        });
    }

    ctx.fillStyle = txtC;
    ctx.font = '500 9px Nunito,sans-serif';
    const labelY = H - pB + 14;
    for (let i = 0; i < pts.length; i++) {
        const dayNum = new Date(pts[i].ts).getDate();
        if (dayNum % 2 === 1) {
            ctx.save();
            ctx.translate(pts[i].x, labelY);
            ctx.rotate(-Math.PI / 6);
            ctx.textAlign = 'right';
            ctx.fillText(formatDateShort(pts[i].ts), 0, 0);
            ctx.restore();
        }
    }
}

function sma(data, window) {
    const half = Math.floor(window / 2);
    return data.map((item, i) => {
        let sum = 0, count = 0;
        for (let j = i - half; j <= i + half; j++) {
            if (j >= 0 && j < data.length) {
                sum += data[j].avg;
                count++;
            }
        }
        return {day: item.day, avg: sum / count};
    });
}

function drawStats(entries) {
    const moods = entries.map(e => e.mood);
    const avg = (moods.reduce((s, v) => s + v, 0) / moods.length).toFixed(1);

    const anxieties = entries.map(e => e.anxiety).filter(a => a >= 1 && a <= 5);
    const anxAvg = anxieties.length
        ? (anxieties.reduce((s, v) => s + v, 0) / anxieties.length).toFixed(1)
        : '—';

    $('#chart-stats').innerHTML = `
    <div class="stat-item"><div class="stat-value">${avg}</div><div class="stat-label">Среднее</div></div>
    <div class="stat-item"><div class="stat-value">${Math.max(...moods)}</div><div class="stat-label">Макс</div></div>
    <div class="stat-item"><div class="stat-value">${Math.min(...moods)}</div><div class="stat-label">Мин</div></div>
    <div class="stat-item"><div class="stat-value">${anxAvg}</div><div class="stat-label">Тревога</div></div>
    <div class="stat-item"><div class="stat-value">${entries.length}</div><div class="stat-label">Записей</div></div>`;
}

function renderEntries(entries) {
    const el = $('#share-entries');
    if (!entries.length) {
        el.innerHTML = '';
        return;
    }

    const sorted = [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const groups = {};
    sorted.forEach(e => {
        const day = e.timestamp.slice(0, 10);
        if (!groups[day]) groups[day] = [];
        groups[day].push(e);
    });

    let html = '';
    for (const [day, items] of Object.entries(groups)) {
        html += `<div class="date-group-label">${dayLabel(day)}</div>`;
        for (const e of items) {
            const m = e.mood || 0;
            const a = e.anxiety || 0;
            const note = e.note ? `<p class="share-entry-note">${esc(e.note)}</p>` : '';
            const anxietyBadge = a
                ? `<span class="entry-anxiety-badge" style="background:${ANXIETY_COLORS[a]}">${ANXIETY_EMOJI[a]} ${a}</span>`
                : '';
            html += `
        <div class="share-entry-card">
          <div class="entry-mood-badge" style="background:${MOOD_COLORS[m]}">
            <span class="badge-emoji">${MOOD_EMOJI[m]}</span>
            <span class="badge-num">${m}</span>
          </div>
          <div class="share-entry-body">
            <div class="entry-top-row">
              <span class="entry-mood-text">${MOOD_LABELS[m]}${anxietyBadge}</span>
              <span class="entry-time">${formatTime(e.timestamp)}</span>
            </div>
            ${note}
          </div>
        </div>`;
        }
    }
    el.innerHTML = html;
}

let _rt;
window.addEventListener('resize', () => {
    clearTimeout(_rt);
    _rt = setTimeout(() => {
        const entries = getMonthEntries();
        if (entries.length) drawChart(entries);
    }, 150);
});
