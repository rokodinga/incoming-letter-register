(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Connection config (localStorage overrides config.js defaults)
  // ---------------------------------------------------------------
  var cfg = {
    webAppUrl: localStorage.getItem('ilr_url') || (window.DEFAULT_CONFIG && window.DEFAULT_CONFIG.webAppUrl) || '',
    apiKey: localStorage.getItem('ilr_key') || (window.DEFAULT_CONFIG && window.DEFAULT_CONFIG.apiKey) || ''
  };

  var state = {
    months: [],
    currentMonth: null,
    letters: [],
    searchMode: false
  };

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var monthSelect = $('month-select');
  var searchInput = $('search-input');
  var statusFilter = $('status-filter');
  var ledgerBody = $('ledger-body');
  var connDot = $('conn-status');

  var letterModal = $('letter-modal');
  var settingsModal = $('settings-modal');

  // ---------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------
  function api(action, params, isWrite) {
    if (!cfg.webAppUrl || !cfg.apiKey) {
      openSettings();
      return Promise.reject(new Error('Not connected yet'));
    }
    params = params || {};
    params.action = action;
    params.key = cfg.apiKey;

    if (!isWrite) {
      var qs = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(
          typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]
        );
      }).join('&');
      return fetch(cfg.webAppUrl + '?' + qs).then(function (r) { return r.json(); });
    }

    // Use text/plain to avoid a CORS preflight against Apps Script.
    return fetch(cfg.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(params)
    }).then(function (r) { return r.json(); });
  }

  // ---------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------
  var toastEl = $('toast');
  var toastTimer;
  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (kind ? ' toast--' + kind : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------
  // Date helpers (dd/mm/yyyy strings, as used in the sheet)
  // ---------------------------------------------------------------
  function parseDMY(s) {
    if (!s) return null;
    var parts = String(s).split(/[\/\-]/);
    if (parts.length !== 3) return null;
    var d = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, y = parseInt(parts[2], 10);
    if (y < 100) y += 2000;
    var dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function isOverdue(letter) {
    if (letter.status !== 'Pending') return false;
    var due = parseDMY(letter.timeLine);
    if (!due) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }

  function todayLabelMonth() {
    var now = new Date();
    return now.toLocaleString('en-US', { month: 'long' }) + ' ' + now.getFullYear();
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function renderMonths() {
    monthSelect.innerHTML = '';
    state.months.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      monthSelect.appendChild(opt);
    });
    if (state.currentMonth) monthSelect.value = state.currentMonth;
  }

  function renderSummary(letters) {
    var pending = letters.filter(function (l) { return l.status === 'Pending' && !isOverdue(l); }).length;
    var overdue = letters.filter(isOverdue).length;
    var responded = letters.filter(function (l) { return l.status === 'Responded'; }).length;
    $('count-pending').textContent = pending;
    $('count-overdue').textContent = overdue;
    $('count-responded').textContent = responded;
    $('count-total').textContent = letters.length;
  }

  function statusBadge(letter) {
    if (isOverdue(letter)) return '<span class="status-stamp status-stamp--overdue">Overdue</span>';
    if (letter.status === 'Responded') return '<span class="status-stamp status-stamp--responded">Responded</span>';
    return '<span class="status-stamp status-stamp--pending">Pending</span>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderTable(letters) {
    if (!letters.length) {
      ledgerBody.innerHTML = '<tr><td colspan="8" class="empty-row">No letters found for this view.</td></tr>';
      return;
    }
    ledgerBody.innerHTML = letters.map(function (l) {
      return '<tr>' +
        '<td class="col-sl"><span class="sl-badge">' + escapeHtml(l.slNo) + '</span></td>' +
        '<td class="col-subject">' + escapeHtml(l.subject) + (state.searchMode ? ' <span style="color:var(--ink-soft);font-size:11px">(' + escapeHtml(l.month) + ')</span>' : '') + '</td>' +
        '<td class="col-memo">' + escapeHtml(l.memoNo) + '</td>' +
        '<td class="col-date">' + escapeHtml(l.date) + '</td>' +
        '<td class="col-date">' + escapeHtml(l.timeLine) + '</td>' +
        '<td class="col-status">' + statusBadge(l) + '</td>' +
        '<td class="col-responded">' + escapeHtml(l.respondedMemo) + '</td>' +
        '<td class="col-actions"><button class="row-link" data-edit="' + l.row + '" data-month="' + escapeHtml(l.month) + '">Edit</button></td>' +
        '</tr>';
    }).join('');

    ledgerBody.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = Number(btn.getAttribute('data-edit'));
        var month = btn.getAttribute('data-month');
        var letter = (state.searchMode ? state.searchResults : state.letters).find(function (l) {
          return l.row === row && l.month === month;
        });
        if (letter) openLetterModal(letter);
      });
    });
  }

  function applyFilters() {
    var source = state.searchMode ? state.searchResults : state.letters;
    var status = statusFilter.value;
    var filtered = status ? source.filter(function (l) { return l.status === status; }) : source;
    renderSummary(state.searchMode ? state.letters : source);
    renderTable(filtered);
  }

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------
  function loadMonths() {
    return api('listMonths', {}, false).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      state.months = res.months.length ? res.months : [todayLabelMonth()];
      if (!state.currentMonth) {
        state.currentMonth = state.months.indexOf(todayLabelMonth()) !== -1
          ? todayLabelMonth()
          : state.months[state.months.length - 1];
      }
      renderMonths();
      setConnected(true);
    });
  }

  function loadLetters(month) {
    return api('listLetters', { month: month }, false).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      state.letters = res.letters;
      state.searchMode = false;
      applyFilters();
    });
  }

  function refreshAll() {
    return loadMonths().then(function () { return loadLetters(state.currentMonth); });
  }

  function setConnected(on) {
    connDot.classList.toggle('conn-dot--on', !!on);
    connDot.classList.toggle('conn-dot--off', !on);
    connDot.title = on ? 'Connected' : 'Not connected';
  }

  // ---------------------------------------------------------------
  // Letter modal
  // ---------------------------------------------------------------
  var fields = ['slNo', 'subject', 'memoNo', 'date', 'timeLine', 'respondedMemo', 'respondedThrough', 'status', 'remarks'];

  function openLetterModal(letter) {
    var isEdit = !!letter;
    $('modal-title').textContent = isEdit ? 'Edit letter #' + letter.slNo : 'New letter';
    $('modal-delete').hidden = !isEdit;
    $('f-row').value = isEdit ? letter.row : '';
    $('f-month').value = isEdit ? letter.month : state.currentMonth;

    fields.forEach(function (f) {
      var el = $('f-' + f);
      el.value = isEdit ? (letter[f] || '') : (f === 'status' ? 'Pending' : '');
    });
    letterModal.showModal();
  }

  $('new-letter-btn').addEventListener('click', function () { openLetterModal(null); });
  $('modal-cancel').addEventListener('click', function () { letterModal.close(); });

  $('letter-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var row = $('f-row').value;
    var month = $('f-month').value;
    var data = {};
    fields.forEach(function (f) { data[f] = $('f-' + f).value; });

    var action = row ? 'updateLetter' : 'addLetter';
    var params = row ? { month: month, row: row, data: data } : { month: month, data: data };

    api(action, params, true).then(function (res) {
      if (!res.ok) { toast('Error: ' + res.error, 'error'); return; }
      toast(row ? 'Letter updated' : 'Letter added', 'ok');
      letterModal.close();
      if (month === state.currentMonth) loadLetters(state.currentMonth);
      else refreshAll();
    }).catch(function (err) { toast('Error: ' + err.message, 'error'); });
  });

  $('modal-delete').addEventListener('click', function () {
    var row = $('f-row').value;
    var month = $('f-month').value;
    if (!row) return;
    if (!confirm('Delete this letter? This cannot be undone.')) return;
    api('deleteLetter', { month: month, row: row }, true).then(function (res) {
      if (!res.ok) { toast('Error: ' + res.error, 'error'); return; }
      toast('Letter deleted', 'ok');
      letterModal.close();
      loadLetters(state.currentMonth);
    });
  });

  // ---------------------------------------------------------------
  // Settings modal
  // ---------------------------------------------------------------
  function openSettings() {
    $('s-url').value = cfg.webAppUrl;
    $('s-key').value = cfg.apiKey;
    settingsModal.showModal();
  }
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-cancel').addEventListener('click', function () { settingsModal.close(); });

  $('settings-form').addEventListener('submit', function (e) {
    e.preventDefault();
    cfg.webAppUrl = $('s-url').value.trim();
    cfg.apiKey = $('s-key').value.trim();
    localStorage.setItem('ilr_url', cfg.webAppUrl);
    localStorage.setItem('ilr_key', cfg.apiKey);
    settingsModal.close();
    toast('Connecting…');
    refreshAll().then(function () { toast('Connected', 'ok'); })
      .catch(function (err) { setConnected(false); toast('Connection failed: ' + err.message, 'error'); });
  });

  // ---------------------------------------------------------------
  // Toolbar events
  // ---------------------------------------------------------------
  monthSelect.addEventListener('change', function () {
    state.currentMonth = monthSelect.value;
    searchInput.value = '';
    loadLetters(state.currentMonth);
  });

  statusFilter.addEventListener('change', applyFilters);

  var searchTimer;
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = searchInput.value.trim();
    if (!q) {
      state.searchMode = false;
      applyFilters();
      return;
    }
    searchTimer = setTimeout(function () {
      api('search', { query: q }, false).then(function (res) {
        if (!res.ok) { toast('Search error: ' + res.error, 'error'); return; }
        state.searchMode = true;
        state.searchResults = res.results;
        applyFilters();
      });
    }, 350);
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  if (cfg.webAppUrl && cfg.apiKey) {
    refreshAll().catch(function (err) {
      setConnected(false);
      toast('Could not connect: ' + err.message, 'error');
    });
  } else {
    setTimeout(openSettings, 400);
  }
})();
