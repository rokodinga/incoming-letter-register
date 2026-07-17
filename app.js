(function () {
  'use strict';

  var cfg = {
    webAppUrl: window.DEFAULT_CONFIG ? window.DEFAULT_CONFIG.webAppUrl : '',
    apiKey: localStorage.getItem('ilr_key') || ''
  };

  var state = {
    months: [], currentMonth: null, letters: [], searchMode: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var monthSelect = $('month-select'), searchInput = $('search-input'), statusFilter = $('status-filter');
  var ledgerBody = $('ledger-body'), connDot = $('conn-status');

  // Drawer Elements
  var drawer = $('letter-drawer'), drawerOverlay = $('drawer-overlay');

  // Live Clock Engine
  function startLiveClock() {
    var clockEl = $('live-clock');
    if(!clockEl) return;
    setInterval(function() {
      var now = new Date();
      clockEl.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) + ' ' + 
                            now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }, 1000);
  }
  startLiveClock();

  // API helper
  function api(action, params, isWrite) {
    if (!cfg.webAppUrl || !cfg.apiKey) return Promise.reject(new Error('Missing credentials'));
    params = params || {}; params.action = action; params.key = cfg.apiKey;
    if (!isWrite) {
      var qs = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]);
      }).join('&');
      return fetch(cfg.webAppUrl + '?' + qs).then(function (r) { return r.json(); });
    }
    return fetch(cfg.webAppUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(params) }).then(function (r) { return r.json(); });
  }

  // Modern Toast Animation
  var toastEl = $('toast'), toastTimer;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast toast--' + (kind || 'info') + ' active';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('active'); }, 3000);
  }

  // Date Parsing
  function parseDMY(s) {
    if (!s) return null;
    var parts = String(s).split(/[\/\-]/);
    if (parts.length !== 3) return null;
    if (parts[0].length === 4) return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var y = parseInt(parts[2], 10); if (y < 100) y += 2000;
    return new Date(y, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  }
  function formatForInput(dateStr) {
    var dt = parseDMY(dateStr); if (!dt) return '';
    var m = dt.getMonth() + 1, d = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  function isOverdue(letter) {
    if (letter.status !== 'Pending') return false;
    var due = parseDMY(letter.timeLine); if (!due) return false;
    var today = new Date(); today.setHours(0, 0, 0, 0); return due < today;
  }
  function todayLabelMonth() {
    var now = new Date(); return now.toLocaleString('en-US', { month: 'long' }) + ' ' + now.getFullYear();
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Upgraded Link Parser (Enterprise Styling)
  function parseLinks(text, context) {
    var str = escapeHtml(text);
    var urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|mail\.google\.com[^\s]+|gmail\.com[^\s]+)/g;
    return str.replace(urlRegex, function(url) {
      var href = url.startsWith('http') ? url : 'https://' + url;
      var label = 'View Link', isGmail = url.indexOf('mail.google.com') !== -1 || url.indexOf('gmail.com') !== -1;
      var icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>';
      
      if (isGmail) {
        label = context === 'incoming' ? 'Incoming Dak' : (context === 'outgoing' ? 'Sent Mail' : 'View Email');
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>';
        return '<a href="' + href + '" target="_blank" class="link-badge link-badge--gmail">' + icon + label + '</a>';
      }
      return '<a href="' + href + '" target="_blank" class="link-badge">' + icon + label + '</a>';
    });
  }

  // UI Rendering
  function renderSummary(letters) {
    var t = letters.length, p = 0, o = 0, r = 0, c = 0;
    letters.forEach(function(l) {
      if(l.status === 'Pending') { p++; if(isOverdue(l)) o++; }
      else if(l.status === 'Responded') r++;
      else if(l.status === 'Communicated') c++;
    });
    $('count-pending').textContent = p; $('count-overdue').textContent = o;
    $('count-responded').textContent = r; $('count-communicated').textContent = c;
    $('count-rate').textContent = t === 0 ? '0%' : Math.round(((r + c) / t) * 100) + '%';
  }

  function getStatusBadge(letter) {
    if (isOverdue(letter)) return '<span class="status-badge status-badge--overdue">Overdue</span>';
    var lower = letter.status.toLowerCase();
    return '<span class="status-badge status-badge--'+lower+'">'+escapeHtml(letter.status)+'</span>';
  }

  function renderTable(letters) {
    if (!letters.length) { ledgerBody.innerHTML = '<tr><td colspan="8" class="empty-row">No records found for this view.</td></tr>'; return; }
    ledgerBody.innerHTML = letters.map(function (l) {
      var sOut = parseLinks(l.subject, 'incoming'), mOut = parseLinks(l.memoNo, 'incoming');
      var rMemo = parseLinks(l.respondedMemo, 'outgoing'), rVia = escapeHtml(l.respondedThrough);
      var rDisp = (rMemo ? '<div style="margin-bottom:4px;"><b>Ref:</b> ' + rMemo + '</div>' : '') + (rVia ? '<div style="color:var(--text-muted);font-size:0.8rem;"><b>Via:</b> ' + rVia + '</div>' : '');
      
      return '<tr>' +
        '<td><b>' + escapeHtml(l.slNo) + '</b></td>' +
        '<td>' + sOut + '</td>' + '<td>' + mOut + '</td>' +
        '<td>' + escapeHtml(l.date) + '</td>' + '<td>' + escapeHtml(l.timeLine) + '</td>' +
        '<td>' + getStatusBadge(l) + '</td>' + '<td>' + rDisp + '</td>' +
        '<td><button class="btn btn--ghost" data-edit="' + l.row + '" data-month="' + escapeHtml(l.month) + '">Edit</button></td>' +
        '</tr>';
    }).join('');

    ledgerBody.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = Number(btn.getAttribute('data-edit')), month = btn.getAttribute('data-month');
        var letter = (state.searchMode ? state.searchResults : state.letters).find(function (l) { return l.row === row && l.month === month; });
        if (letter) openDrawer(letter);
      });
    });
  }

  function applyFilters() {
    var source = state.searchMode ? state.searchResults : state.letters;
    var filtered = statusFilter.value ? source.filter(function (l) { return l.status === statusFilter.value; }) : source;
    renderSummary(state.searchMode ? state.letters : source); renderTable(filtered);
  }

  // Data Loading
  function refreshAll() {
    return api('listMonths', {}, false).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      state.months = res.months.length ? res.months : [todayLabelMonth()];
      state.currentMonth = state.currentMonth || (state.months.includes(todayLabelMonth()) ? todayLabelMonth() : state.months[state.months.length - 1]);
      monthSelect.innerHTML = state.months.map(function(m){ return '<option value="'+m+'">'+m+'</option>'; }).join('');
      monthSelect.value = state.currentMonth; setConnected(true);
      return api('listLetters', { month: state.currentMonth }, false);
    }).then(function (res) {
      state.letters = res.letters; state.searchMode = false; applyFilters();
    });
  }

  function setConnected(on) {
    connDot.className = 'conn-dot ' + (on ? 'conn-dot--on' : 'conn-dot--off');
  }

  // Drawer Controller (Replaces Modal logic)
  function openDrawer(letter) {
    var isEdit = !!letter;
    $('modal-title').textContent = isEdit ? 'Update Entry #' + letter.slNo : 'Register New Dak';
    $('modal-delete').hidden = !isEdit;
    $('f-row').value = isEdit ? letter.row : '';
    $('f-month').value = isEdit ? letter.month : state.currentMonth;

    ['slNo','subject','memoNo','date','timeLine','respondedMemo','respondedThrough','status','remarks'].forEach(function (f) {
      var el = $('f-' + f), val = isEdit ? (letter[f] || '') : (f === 'status' ? 'Pending' : '');
      el.value = el.type === 'date' && val ? formatForInput(val) : val;
    });
    
    drawerOverlay.classList.add('active');
    drawer.classList.add('active');
  }

  function closeDrawer() {
    drawer.classList.remove('active');
    drawerOverlay.classList.remove('active');
  }

  $('new-letter-btn').addEventListener('click', function () { openDrawer(null); });
  $('drawer-close-btn').addEventListener('click', closeDrawer);
  $('drawer-cancel-btn').addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  $('letter-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var row = $('f-row').value, month = $('f-month').value, data = {};
    ['slNo','subject','memoNo','date','timeLine','respondedMemo','respondedThrough','status','remarks'].forEach(function (f) {
      var el = $('f-' + f); data[f] = (el.type === 'date' && el.value) ? el.value.split('-').reverse().join('/') : el.value;
    });

    api(row ? 'updateLetter' : 'addLetter', row ? { month: month, row: row, data: data } : { month: month, data: data }, true).then(function (res) {
      if (!res.ok) return toast('Error: ' + res.error, 'error');
      toast(row ? 'Record Updated' : 'Record Registered', 'ok');
      closeDrawer();
      if (month === state.currentMonth) refreshAll(); // Simpler refresh for sync
    });
  });

  $('modal-delete').addEventListener('click', function () {
    var row = $('f-row').value, month = $('f-month').value;
    if (confirm('Permanently delete this entry?')) {
      api('deleteLetter', { month: month, row: row }, true).then(function (res) {
        if (!res.ok) return toast('Error: ' + res.error, 'error');
        toast('Record Deleted', 'ok'); closeDrawer(); refreshAll();
      });
    }
  });

  // Login & Toolbar Events
  $('logout-btn').addEventListener('click', function() { localStorage.removeItem('ilr_key'); cfg.apiKey = ''; setConnected(false); $('login-screen').hidden = false; toast('Session Ended'); });
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault(); cfg.apiKey = $('login-key').value.trim(); localStorage.setItem('ilr_key', cfg.apiKey);
    toast('Authenticating Securely...');
    refreshAll().then(function () { $('login-screen').hidden = true; toast('Access Granted', 'ok'); }).catch(function () { toast('Access Denied', 'error'); });
  });

  monthSelect.addEventListener('change', function () { state.currentMonth = monthSelect.value; searchInput.value = ''; refreshAll(); });
  statusFilter.addEventListener('change', applyFilters);
  $('export-btn').addEventListener('click', function() { window.print(); });

  var searchTimer;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer); var q = searchInput.value.trim();
    if (!q) { state.searchMode = false; return applyFilters(); }
    searchTimer = setTimeout(function () {
      api('search', { query: q }, false).then(function (res) {
        state.searchMode = true; state.searchResults = res.results; applyFilters();
      });
    }, 350);
  });

  if (cfg.webAppUrl && cfg.apiKey) {
    refreshAll().catch(function () { setConnected(false); $('login-screen').hidden = false; });
  } else $('login-screen').hidden = false;
})();
