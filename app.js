(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Connection config
  // ---------------------------------------------------------------
  var cfg = {
    webAppUrl: window.DEFAULT_CONFIG ? window.DEFAULT_CONFIG.webAppUrl : '',
    apiKey: localStorage.getItem('ilr_key') || ''
  };

  var state = {
    months: [],
    currentMonth: null,
    letters: [],
    searchMode: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var monthSelect = $('month-select');
  var searchInput = $('search-input');
  var statusFilter = $('status-filter');
  var ledgerBody = $('ledger-body');
  var connDot = $('conn-status');

  var letterModal = $('letter-modal');

  // ---------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------
  function api(action, params, isWrite) {
    if (!cfg.webAppUrl || !cfg.apiKey) {
      return Promise.reject(new Error('Missing credentials'));
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

    return fetch(cfg.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(params)
    }).then(function (r) { return r.json(); });
  }

  // ---------------------------------------------------------------
  // Toast & Dates
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

  function parseDMY(s) {
    if (!s) return null;
    var parts = String(s).split(/[\/\-]/);
    if (parts.length !== 3) return null;
    
    if (parts[0].length === 4) {
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } else {
      var y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      return new Date(y, parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }

  function formatForInput(dateStr) {
    var dt = parseDMY(dateStr);
    if (!dt) return '';
    var m = dt.getMonth() + 1;
    var d = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
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
  // Link Parser Helper
  // ---------------------------------------------------------------
  function parseLinks(text) {
    var str = escapeHtml(text);
    // Upgraded Regex: Catches mail.google.com and gmail.com even if https:// is missing
    var urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|mail\.google\.com[^\s]+|gmail\.com[^\s]+)/g;
    
    return str.replace(urlRegex, function(url) {
      var href = url;
      // Auto-add https:// if it was forgotten
      if (!href.startsWith('http')) {
          href = 'https://' + href;
      }
      
      var label = 'View Link';
      var isGmail = url.indexOf('mail.google.com') !== -1 || url.indexOf('gmail.com') !== -1;
      
      // Default icon
      var icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:2px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
      
      if (isGmail) {
        label = 'View in Gmail';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:2px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>';
      } else if (url.indexOf('drive.google') !== -1) {
        label = 'Google Drive';
      } else if (url.indexOf('docs.google') !== -1) {
        label = 'Docs/Sheets';
      } else if (url.indexOf('.pdf') !== -1) {
        label = 'PDF File';
      }
      
      // Custom Red Badge for Gmail
      if (isGmail) {
        return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="link-badge" ' +
               'style="background-color: #fce8e6; color: #ea4335;" ' +
               'onmouseover="this.style.backgroundColor=\'#ea4335\'; this.style.color=\'#ffffff\'" ' +
               'onmouseout="this.style.backgroundColor=\'#fce8e6\'; this.style.color=\'#ea4335\'">' + 
               icon + label + '</a>';
      }
      
      return '<a href="' + href + '" target="_blank" rel="noopener noreferrer" class="link-badge">' + icon + label + '</a>';
    });
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
    var total = letters.length;
    var pending = letters.filter(function (l) { return l.status === 'Pending' && !isOverdue(l); }).length;
    var overdue = letters.filter(isOverdue).length;
    var responded = letters.filter(function (l) { return l.status === 'Responded'; }).length;
    var communicated = letters.filter(function (l) { return l.status === 'Communicated'; }).length;
    
    $('count-pending').textContent = pending;
    $('count-overdue').textContent = overdue;
    $('count-responded').textContent = responded;
    $('count-communicated').textContent = communicated;
    $('count-total').textContent = total;

    var rate = total === 0 ? 0 : Math.round(((responded + communicated) / total) * 100);
    $('count-rate').textContent = rate + '%';
  }

  function statusBadge(letter) {
    if (isOverdue(letter)) return '<span class="status-stamp status-stamp--overdue">Overdue</span>';
    if (letter.status === 'Communicated') return '<span class="status-stamp status-stamp--communicated">Communicated</span>';
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
      var subjectOutput = parseLinks(l.subject);
      var memoOutput = parseLinks(l.memoNo);
      
      var respondedMemoOutput = parseLinks(l.respondedMemo);
      var respondedThroughOutput = escapeHtml(l.respondedThrough);
      var respondedDisplay = '';
      if (respondedMemoOutput) {
          respondedDisplay += '<div style="font-size:0.9em; margin-bottom:4px;"><b>Memo:</b> ' + respondedMemoOutput + '</div>';
      }
      if (respondedThroughOutput) {
          respondedDisplay += '<div style="font-size:0.9em; color:var(--text-secondary);"><b>Via:</b> ' + respondedThroughOutput + '</div>';
      }
      
      return '<tr>' +
        '<td class="col-sl"><span class="sl-badge">' + escapeHtml(l.slNo) + '</span></td>' +
        '<td class="col-subject">' + subjectOutput + (state.searchMode ? ' <br><span style="color:var(--text-secondary);font-size:0.75rem">(' + escapeHtml(l.month) + ')</span>' : '') + '</td>' +
        '<td class="col-memo">' + memoOutput + '</td>' +
        '<td class="col-date">' + escapeHtml(l.date) + '</td>' +
        '<td class="col-date">' + escapeHtml(l.timeLine) + '</td>' +
        '<td class="col-status">' + statusBadge(l) + '</td>' +
        '<td class="col-responded">' + respondedDisplay + '</td>' +
        '<td class="col-actions"><button class="row-link" data-edit="' + l.row + '" data-month="' + escapeHtml(l.month) + '">Edit Data</button></td>' +
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
  // Login Flow
  // ---------------------------------------------------------------
  var loginScreen = $('login-screen');

  function showLogin() {
    document.body.style.overflow = 'hidden';
    loginScreen.hidden = false;
    if ($('login-key')) $('login-key').value = cfg.apiKey;
  }

  function hideLogin() {
    document.body.style.overflow = 'auto';
    loginScreen.hidden = true;
  }

  $('logout-btn').addEventListener('click', function() {
      localStorage.removeItem('ilr_key');
      cfg.apiKey = '';
      setConnected(false);
      showLogin();
      toast('Logged out successfully.');
  });

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!cfg.webAppUrl) {
        toast('Configuration Error: Web App URL is missing in config.js', 'error');
        return;
    }
    
    cfg.apiKey = $('login-key').value.trim();
    localStorage.setItem('ilr_key', cfg.apiKey);
    
    toast('Authenticating...');
    
    refreshAll().then(function () { 
      toast('Login Successful', 'ok'); 
      hideLogin();
    }).catch(function (err) { 
      setConnected(false); 
      toast('Authentication failed. Check your token.', 'error'); 
    });
  });

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
      if (!el) return;
      var val = isEdit ? (letter[f] || '') : (f === 'status' ? 'Pending' : '');
      if (el.type === 'date' && val) {
        el.value = formatForInput(val);
      } else {
        el.value = val;
      }
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
    
    fields.forEach(function (f) {
      var el = $('f-' + f);
      if (el.type === 'date' && el.value) {
          var parts = el.value.split('-');
          data[f] = parts[2] + '/' + parts[1] + '/' + parts[0]; 
      } else {
          data[f] = el.value; 
      }
    });

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
  
  // PDF Export Trigger
  $('export-btn').addEventListener('click', function() {
    setTimeout(function() {
      window.print();
    }, 150);
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  if (cfg.webAppUrl && cfg.apiKey) {
    refreshAll().catch(function (err) {
      setConnected(false);
      showLogin(); 
      toast('Session expired or invalid. Please log in again.', 'error');
    });
  } else {
    showLogin();
  }
})();
