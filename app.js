(function () {
  'use strict';

  // State Management Engine
  const state = {
    apiKey: localStorage.getItem('ilr_key') || '',
    months: [],
    currentMonth: null,
    letters: [],
    searchResults: [],
    searchMode: false,
    isProcessing: false // Prevents race conditions during API calls
  };

  const getEl = (id) => document.getElementById(id);
  
  // DOM Elements
  const els = {
    login: getEl('login-screen'), shell: getEl('app-shell'), keyInput: getEl('login-key'),
    monthSel: getEl('month-select'), search: getEl('search-input'), filter: getEl('status-filter'),
    tbody: getEl('ledger-body'), conn: getEl('conn-status'), clock: getEl('live-clock'),
    drawer: getEl('letter-drawer'), overlay: getEl('drawer-overlay'), form: getEl('letter-form'),
    btnSave: getEl('modal-save'), btnDel: getEl('modal-delete'), toast: getEl('toast')
  };

  // Clock Module
  if (els.clock) {
    setInterval(() => {
      const now = new Date();
      els.clock.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) + ' ' + 
                              now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }, 1000);
  }

  // API Gateway
  async function apiFetch(action, params = {}, isWrite = false) {
    if (!window.DEFAULT_CONFIG?.webAppUrl || !state.apiKey) throw new Error('Authentication required');
    
    params.action = action;
    params.key = state.apiKey;
    // Cache buster guarantees fresh data
    const url = new URL(window.DEFAULT_CONFIG.webAppUrl);
    url.searchParams.append('cb', Date.now()); 

    const options = isWrite 
      ? { method: 'POST', body: JSON.stringify(params), headers: { 'Content-Type': 'text/plain' } }
      : { method: 'GET' };

    if (!isWrite) {
      Object.keys(params).forEach(key => url.searchParams.append(key, typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]));
    }

    try {
      const response = await fetch(url.toString(), options);
      if (!response.ok) throw new Error('Network response failure');
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || 'Server rejected request');
      return data;
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  }

  // UI Notification Engine
  let toastTimer;
  function showToast(msg, type = 'info') {
    els.toast.textContent = msg;
    els.toast.className = `toast toast--${type} active`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('active'), 3500);
  }

  // Data Parsing & Security
  const parseDMY = (s) => {
    if (!s) return null;
    const p = String(s).split(/[\/\-]/);
    if (p.length !== 3) return null;
    if (p[0].length === 4) return new Date(p[0], p[1] - 1, p[2]);
    let y = parseInt(p[2], 10); if (y < 100) y += 2000;
    return new Date(y, p[1] - 1, p[0]);
  };
  const isOverdue = (l) => l.status === 'Pending' && parseDMY(l.timeLine) < new Date().setHours(0,0,0,0);
  const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  
  const parseLinks = (text, context) => {
    return escapeHTML(text).replace(/(https?:\/\/[^\s]+|www\.[^\s]+|mail\.google\.com[^\s]+|gmail\.com[^\s]+)/g, url => {
      const href = url.startsWith('http') ? url : `https://${url}`;
      const isGmail = url.includes('mail.google.com') || url.includes('gmail.com');
      const label = isGmail ? (context === 'incoming' ? 'Incoming Dak' : 'Sent Mail') : 'View Link';
      const css = isGmail ? 'link-badge link-badge--gmail' : 'link-badge';
      const icon = isGmail 
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>';
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${css}">${icon}${label}</a>`;
    });
  };

  // Rendering Engine
  function renderDashboard() {
    const data = state.searchMode ? state.searchResults : state.letters;
    const filtered = els.filter.value ? data.filter(l => l.status === els.filter.value) : data;
    
    // KPI Calculation
    let p = 0, o = 0, r = 0, c = 0;
    (state.searchMode ? state.letters : data).forEach(l => {
      if (l.status === 'Pending') { p++; if (isOverdue(l)) o++; }
      else if (l.status === 'Responded') r++;
      else if (l.status === 'Communicated') c++;
    });
    
    getEl('count-pending').textContent = p; getEl('count-overdue').textContent = o;
    getEl('count-responded').textContent = r; getEl('count-communicated').textContent = c;
    const total = p + r + c;
    getEl('count-rate').textContent = total === 0 ? '0%' : Math.round(((r + c) / total) * 100) + '%';

    // Table Generation
    if (!filtered.length) {
      els.tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No records match the current criteria.</td></tr>';
      return;
    }

    els.tbody.innerHTML = filtered.map(l => `
      <tr>
        <td><b>${escapeHTML(l.slNo)}</b></td>
        <td>${parseLinks(l.subject, 'incoming')}</td>
        <td>${parseLinks(l.memoNo, 'incoming')}</td>
        <td>${escapeHTML(l.date)}</td>
        <td>${escapeHTML(l.timeLine)}</td>
        <td><span class="status-badge status-badge--${l.status.toLowerCase()}">${isOverdue(l) ? 'Overdue' : escapeHTML(l.status)}</span></td>
        <td>
          ${l.respondedMemo ? `<div style="margin-bottom:4px;"><b>Ref:</b> ${parseLinks(l.respondedMemo, 'outgoing')}</div>` : ''}
          ${l.respondedThrough ? `<div style="color:var(--text-muted);font-size:0.8rem;"><b>Via:</b> ${escapeHTML(l.respondedThrough)}</div>` : ''}
        </td>
        <td class="no-print"><button type="button" class="btn btn--ghost" data-edit="${l.row}" data-month="${escapeHTML(l.month)}">Edit</button></td>
      </tr>
    `).join('');

    els.tbody.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = (state.searchMode ? state.searchResults : state.letters).find(l => l.row === Number(btn.dataset.edit) && l.month === btn.dataset.month);
        if (target) openDrawer(target);
      });
    });
  }

  // Core Sync Function
  async function syncDatabase() {
    els.tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Synchronizing with enterprise database...</td></tr>';
    els.conn.className = 'conn-dot';
    
    try {
      const monthRes = await apiFetch('listMonths');
      const nowLbl = new Date().toLocaleString('en-US', { month: 'long' }) + ' ' + new Date().getFullYear();
      state.months = monthRes.months.length ? monthRes.months : [nowLbl];
      state.currentMonth = state.currentMonth || (state.months.includes(nowLbl) ? nowLbl : state.months[state.months.length - 1]);
      
      els.monthSel.innerHTML = state.months.map(m => `<option value="${m}">${m}</option>`).join('');
      els.monthSel.value = state.currentMonth;
      
      els.conn.classList.add('conn-dot--on');
      const dataRes = await apiFetch('listLetters', { month: state.currentMonth });
      state.letters = dataRes.letters;
      state.searchMode = !!els.search.value;
      renderDashboard();
    } catch (err) {
      els.tbody.innerHTML = '<tr><td colspan="8" class="empty-row" style="color:var(--danger);">Connection failed. Please check credentials or network.</td></tr>';
      throw err;
    }
  }

  // Drawer Interactions
  function openDrawer(data = null) {
    getEl('modal-title').textContent = data ? `Update Entry #${data.slNo}` : 'Register New Dak';
    els.btnDel.hidden = !data;
    getEl('f-row').value = data ? data.row : '';
    getEl('f-month').value = data ? data.month : state.currentMonth;

    ['slNo','status','subject','memoNo','date','timeLine','respondedThrough','respondedMemo','remarks'].forEach(f => {
      const el = getEl(`f-${f}`);
      let val = data ? (data[f] || '') : (f === 'status' ? 'Pending' : '');
      if (el.type === 'date' && val) {
        const d = parseDMY(val);
        val = d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : '';
      }
      el.value = val;
    });
    
    els.overlay.classList.add('active'); els.overlay.setAttribute('aria-hidden', 'false');
    els.drawer.classList.add('active'); els.drawer.setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    els.drawer.classList.remove('active'); els.drawer.setAttribute('aria-hidden', 'true');
    els.overlay.classList.remove('active'); els.overlay.setAttribute('aria-hidden', 'true');
    els.form.reset();
  }

  // Event Listeners
  getEl('new-letter-btn').addEventListener('click', () => openDrawer());
  getEl('drawer-close-btn').addEventListener('click', closeDrawer);
  getEl('drawer-cancel-btn').addEventListener('click', closeDrawer);
  els.overlay.addEventListener('click', closeDrawer);

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isProcessing) return;
    
    state.isProcessing = true;
    els.btnSave.disabled = true;
    els.btnSave.textContent = 'Saving...';

    const row = getEl('f-row').value;
    const month = getEl('f-month').value;
    const payload = {};
    
    ['slNo','status','subject','memoNo','date','timeLine','respondedThrough','respondedMemo','remarks'].forEach(f => {
      const el = getEl(`f-${f}`);
      payload[f] = (el.type === 'date' && el.value) ? el.value.split('-').reverse().join('/') : el.value;
    });

    try {
      await apiFetch(row ? 'updateLetter' : 'addLetter', row ? { month, row, data: payload } : { month, data: payload }, true);
      showToast(row ? 'Record securely updated' : 'Record registered successfully', 'ok');
      closeDrawer();
      if (month === state.currentMonth) await syncDatabase();
    } catch (err) {
      showToast('Transaction failed: ' + err.message, 'error');
    } finally {
      state.isProcessing = false;
      els.btnSave.disabled = false;
      els.btnSave.textContent = 'Commit Record';
    }
  });

  els.btnDel.addEventListener('click', async () => {
    if (state.isProcessing || !confirm('CONFIRMATION REQUIRED: Irreversibly delete this official record?')) return;
    state.isProcessing = true;
    els.btnDel.disabled = true;
    try {
      await apiFetch('deleteLetter', { month: getEl('f-month').value, row: getEl('f-row').value }, true);
      showToast('Record permanently deleted', 'ok');
      closeDrawer();
      await syncDatabase();
    } catch (err) {
      showToast('Deletion failed: ' + err.message, 'error');
    } finally {
      state.isProcessing = false;
      els.btnDel.disabled = false;
    }
  });

  // Global Controls
  els.monthSel.addEventListener('change', () => { state.currentMonth = els.monthSel.value; els.search.value = ''; syncDatabase(); });
  els.filter.addEventListener('change', renderDashboard);
  getEl('export-btn').addEventListener('click', () => window.print());

  let debounceTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = els.search.value.trim();
    if (!q) { state.searchMode = false; return renderDashboard(); }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await apiFetch('search', { query: q });
        state.searchMode = true; state.searchResults = res.results; renderDashboard();
      } catch(err) { showToast('Search failure', 'error'); }
    }, 400);
  });

  // Auth Management
  function secureWipe() {
    state.letters = []; state.searchResults = [];
    els.tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Authentication required.</td></tr>';
    ['count-pending', 'count-overdue', 'count-responded', 'count-communicated'].forEach(id => getEl(id).textContent = '0');
    getEl('count-rate').textContent = '0%';
  }

  getEl('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('ilr_key'); state.apiKey = '';
    els.conn.className = 'conn-dot'; secureWipe();
    els.shell.hidden = true; 
    els.login.hidden = false; 
    showToast('Secure session terminated');
  });

  getEl('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = getEl('login-submit-btn');
    state.apiKey = els.keyInput.value.trim();
    btn.disabled = true; btn.textContent = 'Verifying Token...';
    
    try {
      await syncDatabase();
      localStorage.setItem('ilr_key', state.apiKey);
      els.login.hidden = true; 
      els.shell.hidden = false;
      showToast('Access Granted', 'ok');
    } catch (err) {
      showToast('Access Denied: Invalid Token', 'error');
      secureWipe();
    } finally {
      btn.disabled = false; btn.textContent = 'Access Dashboard';
    }
  });

  // Initialization Sequence
  if (window.DEFAULT_CONFIG?.webAppUrl && state.apiKey) {
    syncDatabase()
      .then(() => { 
        els.login.hidden = true; 
        els.shell.hidden = false; 
      })
      .catch(() => { 
        secureWipe(); 
        els.login.hidden = false; 
      });
  } else {
    els.login.hidden = false; 
  }
})();
