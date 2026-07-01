// Tab Rendering, UI Controllers, PWA, and Swipe Navigation

// Shared global state variables (declared in participant-config.js):
// _currentTab, _lbReady, LB_ME, LB_REG, LB_ACTS, LB_SCORES, _feedData

var _feedLoaded = false;
var _feedVisibleCount = 30;
var _feedPollInterval = null;
var _feedPolylines = {};

var _highlightsData = {};
var _activeInsight = null;
var _activeRecovery = null;
var _notificationsList = [];
var _notificationsLoaded = false;
var TAB_ORDER = ['dashboard', 'activities', 'leaderboard', 'you'];

// Tab Order for indicator rendering
function updateNavIndicator() {
  var bnav = document.querySelector('.bottom-nav');
  var indicator = document.getElementById('nav-indicator');
  var activeItem = bnav ? bnav.querySelector('.bnav-item.active') : null;
  if (!bnav || !indicator || !activeItem) return;
  var items = Array.from(bnav.querySelectorAll('.bnav-item'));
  var idx = items.indexOf(activeItem);
  if (idx === -1) return;
  var w = 100 / items.length;
  indicator.style.width = w + '%';
  indicator.style.left = (idx * w) + '%';
}

function clearFeedTab() {
  if (window._feedMaps && window._feedMaps.length > 0) {
    window._feedMaps.forEach(function(m) {
      try { m.remove(); } catch(e) {}
    });
  }
  window._feedMaps = [];
  var list = document.getElementById('feed-list');
  if (list) list.innerHTML = '';
}

function clearLeaderboardTab() {
  var list = document.getElementById('lb-list');
  if (list) list.innerHTML = '';
  var tabs = document.getElementById('lb-tabs-container');
  if (tabs) tabs.innerHTML = '';
}

function showTab(tab) {
  if (tab === 'feed' && !CONFIG_LB.announcements_enabled) return;
  if (_currentTab === tab) {
    var container = document.getElementById('tab-' + tab);
    if (container) {
      container.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
    return;
  }

  var prevTab = _currentTab;
  _currentTab = tab;

  // Toggle active class in nav
  document.querySelectorAll('.bnav-item').forEach(function(el) {
    el.classList.toggle('active', el.id === 'bnav-' + tab);
  });

  // Toggle active class on tab content panels
  document.querySelectorAll('.swipe-container-track > .content').forEach(function(el) {
    el.classList.toggle('active', el.id === 'tab-' + tab);
  });

  // Calculate slide displacement
  var idx = TAB_ORDER.indexOf(tab);
  var track = document.getElementById('tab-track');
  if (track && idx !== -1) {
    track.style.transform = 'translateX(-' + (idx * (100 / TAB_ORDER.length)) + '%)';
  }

  updateNavIndicator();

  // Virtualization clean up for offscreen tabs to release browser memory and Leaflet map instances
  if (prevTab === 'feed') {
    clearFeedTab();
  } else if (prevTab === 'leaderboard') {
    clearLeaderboardTab();
  }

  // Lazy loaders for tabs
  if (tab === 'dashboard') {
    triggerRingAnimation();
  }
  if (tab === 'leaderboard') {
    lbBoot();
  }
  if (tab === 'feed') {
    safeSetItem('ag_last_viewed_announcements', new Date().toISOString());
    var badgeEl = document.getElementById('feed-unread-badge');
    if (badgeEl) badgeEl.style.display = 'none';
    if (!_feedLoaded) {
      loadFeed().catch(function(e) { console.warn('showTab loadFeed error:', e); });
      _feedLoaded = true;
    } else {
      renderFeed();
    }
    // Force Leaflet to re-measure container sizes after tab slide animation is complete
    setTimeout(function() {
      if (window._feedMaps && window._feedMaps.length > 0) {
        window._feedMaps.forEach(function(m) {
          try {
            m.invalidateSize();
            if (typeof m._refit === 'function') {
              m._refit();
            }
          } catch(e) {}
        });
      }
    }, 350);
  }

  // Poll intervals for live updates
  if (tab === 'feed' && CONFIG_LB.announcements_enabled) {
    if (!_feedPollInterval) {
      _feedPollInterval = setInterval(function() {
        loadFeed(true).catch(function(e) { console.warn('Poll loadFeed error:', e); });
      }, 10000);
    }
  } else {
    if (_feedPollInterval) {
      clearInterval(_feedPollInterval);
      _feedPollInterval = null;
    }
  }
}

// Swipe Gesture for Tab Navigation
(function() {
  var MIN_SWIPE_X = 40;
  var _swipeDir = null;
  var startX = 0, startY = 0;

  window.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    _swipeDir = null;
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (e.touches.length !== 1) return;
    if (_swipeDir === 'v') return;

    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;

    if (_swipeDir === null) {
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        _swipeDir = 'h';
      } else if (Math.abs(dy) > 6) {
        _swipeDir = 'v';
      }
    }

    if (_swipeDir === 'h') {
      var activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }
      var targetModal = e.target.closest('.detail-modal');
      var leafletTouch = e.target.closest('.leaflet-container');
      var actModalOpen = document.getElementById('activity-detail-modal');
      var profModalOpen = document.getElementById('profile-detail-modal');
      var anyModalOpen = (actModalOpen && actModalOpen.classList.contains('open')) ||
                         (profModalOpen && profModalOpen.classList.contains('open'));
      if (targetModal || leafletTouch || anyModalOpen) {
        return;
      }
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('touchend', function(e) {
    if (_swipeDir !== 'h') return;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < MIN_SWIPE_X) return;

    // Don't switch tabs if a detail modal is open
    var actModal = document.getElementById('activity-detail-modal');
    var profModal = document.getElementById('profile-detail-modal');
    if ((actModal && actModal.classList.contains('open')) ||
        (profModal && profModal.classList.contains('open'))) return;

    var curIdx = TAB_ORDER.indexOf(_currentTab);
    if (curIdx === -1) return;

    if (dx > 0) {
      if (curIdx > 0) showTab(TAB_ORDER[curIdx - 1]);
    } else {
      if (curIdx < TAB_ORDER.length - 1) showTab(TAB_ORDER[curIdx + 1]);
    }
    _swipeDir = null;
  }, { passive: true });

  window.addEventListener('touchcancel', function() {
    _swipeDir = null;
  }, { passive: true });
})();

// Dashboard community pulse tab rendering
function renderCommunityPulse() {
  return; // Temporarily disabled for now

  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    if (a.is_flagged) return;
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });

  var totalKm = 0, totalHours = 0, activeCount = 0;
  var hourBuckets = {};

  LB_REG.forEach(function(p) {
    var acts = actsByAthlete[p.strava_athlete_id] || [];
    var km = acts.reduce(function(s,a){return s+(a.distance_meters||0)/1000;},0);
    var hr = acts.reduce(function(s,a){return s+(a.moving_time_seconds||0)/3600;},0);
    totalKm += km;
    totalHours += hr;
    if (acts.length > 0) {
      activeCount++;
    }

    acts.forEach(function(a) {
      try {
        var localDt = new Date(a.activity_date);
        if (a.start_time) {
          var hp = a.start_time.split(':');
          var hrVal = parseInt(hp[0], 10);
          if (!isNaN(hrVal)) {
            hourBuckets[hrVal] = (hourBuckets[hrVal] || 0) + 1;
          }
        } else if (!isNaN(localDt.getTime())) {
          var hrVal = localDt.getHours();
          hourBuckets[hrVal] = (hourBuckets[hrVal] || 0) + 1;
        }
      } catch (e) {}
    });
  });

  var peakHour = '—';
  var maxActs = 0;
  for (var h = 0; h < 24; h++) {
    if ((hourBuckets[h] || 0) > maxActs) {
      maxActs = hourBuckets[h];
      var startH = h;
      var endH = (h + 1) % 24;
      var fmtH = function(x) {
        var ampm = x >= 12 ? 'PM' : 'AM';
        var h12 = x % 12;
        if (h12 === 0) h12 = 12;
        return h12 + ' ' + ampm;
      };
      peakHour = fmtH(startH) + ' - ' + fmtH(endH);
    }
  }

  var activePct = Math.round((activeCount / LB_REG.length) * 100);
  var co2 = Math.round(totalKm * 0.12);
  var totalSteps = Math.round(totalKm * 1350);

  // K2K journey
  var k2kLength = 3600;
  var k2kRawCount = totalKm / k2kLength;
  var k2kCompletions = Math.floor(k2kRawCount);
  var k2kRemKm = totalKm % k2kLength;
  var k2kRemPct = ((k2kRemKm / k2kLength) * 100).toFixed(1);

  // Odometer HTML
  var target = totalKm.toFixed(0);
  var padTarget = target.padStart(6, '0');
  var odoHtml = '';
  for (var i = 0; i < padTarget.length; i++) {
    odoHtml += '<div class="digit-box">' + padTarget[i] + '</div>';
  }

  // Ring Dash offsets
  var activeOffset = 220 - (220 * activePct) / 100;
  var k2kOffset = 220 - (220 * parseFloat(k2kRemPct)) / 100;

  var cardsHtml = 
    // Odometer section
    '<div class="pulse-odo-card" style="grid-column: span 12;">' +
      '<div style="font-size: 11px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; font-family: var(--font); text-align: left;">' +
        'Odometer' +
      '</div>' +
      '<div style="display: flex; align-items: baseline; gap: 8px;">' +
        '<div class="pulse-odometer" style="display:flex; gap: 4px;">' + odoHtml + '</div>' +
        '<span style="font-size: 16px; font-weight: 800; color: var(--muted); font-family: var(--font);">KM</span>' +
      '</div>' +
    '</div>' +

    // K2K journey card
    '<div class="pulse-card k2k-card" style="grid-column: span 6;">' +
      '<div class="pulse-card-top">' +
        '<div class="pulse-circle">' +
          '<svg viewBox="0 0 80 80" width="80" height="80">' +
            '<circle class="bg" cx="40" cy="40" r="35"></circle>' +
            '<circle class="fill k2k-fill" cx="40" cy="40" r="35" style="stroke-dashoffset: 220; stroke: #A78BFA;"></circle>' +
          '</svg>' +
          '<div class="pulse-pct k2k-pct">0%</div>' +
        '</div>' +
        '<div class="pulse-desc">' +
          '<div class="pulse-title">Virtual Journey</div>' +
          '<div class="pulse-subtitle">Kashmir to Kanyakumari (3,600 km)</div>' +
          '<div class="pulse-metric" style="color: #C084FC;">' + k2kRemKm.toFixed(0) + ' km / 3,600 km</div>' +
        '</div>' +
      '</div>' +
      '<div class="pulse-card-footer">' +
        'Completed <strong style="color:#C084FC; font-weight:800;">' + k2kCompletions + ' times</strong>. ' + (k2kCompletions > 0 ? 'On journey #' + (k2kCompletions + 1) : 'First journey') + '.' +
      '</div>' +
    '</div>' +

    // Active Today card
    '<div class="pulse-card active-card" style="grid-column: span 6;">' +
      '<div class="pulse-card-top">' +
        '<div class="pulse-circle">' +
          '<svg viewBox="0 0 80 80" width="80" height="80">' +
            '<circle class="bg" cx="40" cy="40" r="35"></circle>' +
            '<circle class="fill active-fill" cx="40" cy="40" r="35" style="stroke-dashoffset: 220; stroke: var(--brand);"></circle>' +
          '</svg>' +
          '<div class="pulse-pct active-pct">0%</div>' +
        '</div>' +
        '<div class="pulse-desc">' +
          '<div class="pulse-title">Active Today</div>' +
          '<div class="pulse-subtitle">' + activeCount + ' of ' + LB_REG.length + ' athletes</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Total Steps card
    '<div class="pulse-card-stat" style="grid-column: span 3;">' +
      '<div class="pulse-stat-val">' + totalSteps.toLocaleString('en-IN') + '</div>' +
      '<div class="pulse-stat-lbl">TOTAL STEPS</div>' +
      '<div class="pulse-stat-sub">Based on average cadence</div>' +
    '</div>' +

    // CO2 offset card
    '<div class="pulse-card-stat" style="grid-column: span 3;">' +
      '<div class="pulse-stat-val" style="color: #34D399;">' + co2.toLocaleString('en-IN') + ' kg</div>' +
      '<div class="pulse-stat-lbl" style="color: #34D399;">CO₂ OFFSET</div>' +
      '<div class="pulse-stat-sub">Equivalent trees carbon offset</div>' +
    '</div>' +

    // Total Active Hours card
    '<div class="pulse-card-stat" style="grid-column: span 3;">' +
      '<div class="pulse-stat-val" style="color: #60A5FA;">' + Math.round(totalHours).toLocaleString('en-IN') + ' hrs</div>' +
      '<div class="pulse-stat-lbl" style="color: #60A5FA;">ACTIVE TIME</div>' +
      '<div class="pulse-stat-sub">Cumulative moving duration</div>' +
    '</div>' +

    // Peak active hour card
    '<div class="pulse-card-stat" style="grid-column: span 3;">' +
      '<div class="pulse-stat-val" style="color: #FBBF24;">' + peakHour + '</div>' +
      '<div class="pulse-stat-lbl" style="color: #FBBF24;">PEAK ACTIVE HOUR</div>' +
      '<div class="pulse-stat-sub">Most active start hour bracket</div>' +
    '</div>';

  grid.innerHTML = cardsHtml;

  // Queue ring animation
  var anims = [];
  var actFill = grid.querySelector('.active-fill');
  var actPct = grid.querySelector('.active-pct');
  if (actFill && actPct) {
    anims.push({ fillEl: actFill, pctEl: actPct, offset: activeOffset, displayPct: activePct });
  }
  var k2kFill = grid.querySelector('.k2k-fill');
  var k2kPct = grid.querySelector('.k2k-pct');
  if (k2kFill && k2kPct) {
    anims.push({ fillEl: k2kFill, pctEl: k2kPct, offset: k2kOffset, displayPct: Math.round(parseFloat(k2kRemPct)) });
  }

  window._ringAnimationData = anims;
  setTimeout(function() {
    triggerRingAnimation();
  }, 100);
}

function triggerRingAnimation() {
  if (typeof _ringAnimationData === 'undefined' || !_ringAnimationData.length) return;
  _ringAnimationData.forEach(function(item) {
    item.fillEl.style.strokeDashoffset = item.offset;
    var start = 0;
    var duration = 800;
    var startTime = null;
    function animate(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = timestamp - startTime;
      var current = Math.min(item.displayPct, Math.floor((progress / duration) * item.displayPct));
      item.pctEl.textContent = current + '%';
      if (progress < duration) {
        requestAnimationFrame(animate);
      } else {
        item.pctEl.textContent = item.displayPct + '%';
      }
    }
    requestAnimationFrame(animate);
  });
}

// Activities tab rendering
// Activities tab rendering
var CURRENT_ACTS = [];
var CURRENT_DAY_BREAKDOWN = {};
var CURRENT_ACT_BREAKDOWN = {};
var CURRENT_GENDER = '';

function renderActivities(acts, dayBreakdown, actBreakdown, gender) {
  dayBreakdown = dayBreakdown || {}; actBreakdown = actBreakdown || {};
  CURRENT_ACTS = acts;
  CURRENT_DAY_BREAKDOWN = dayBreakdown;
  CURRENT_ACT_BREAKDOWN = actBreakdown;
  CURRENT_GENDER = gender;

  var list = document.getElementById('act-list');
  if (!list) return;
  if (!acts || !acts.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">' + icoRun + '</div><p>No activities yet.<br>Save a walk or run on Strava — it will appear here.</p></div>';
    return;
  }
  var flaggedCount = acts.filter(function(a){return a.is_flagged;}).length;
  var banner = document.getElementById('flagged-banner');
  if (banner) {
    banner.style.display = flaggedCount > 0 ? 'block' : 'none';
  }

  var groups = {}, dateOrder = [];
  acts.forEach(function(a) {
    var d = getActDate(a);
    if (!d) return;
    if (!groups[d]) {
      groups[d] = [];
      dateOrder.push(d);
    }
    groups[d].push(a);
  });

  list.innerHTML = '';
  dateOrder.forEach(function(date, gi) {
    var dayActs = groups[date], db = dayBreakdown[date] || {km:0,distPts:0,bonusPts:0,challenges:[]};
    var rawKm = dayActs.filter(function(a){return !a.is_flagged;}).reduce(function(s,a){return s+(a.distance_meters||0)/1000;},0);
    var chPts = parseFloat(dayActs.reduce(function(s,a){var ab=actBreakdown[a.strava_activity_id];return s+(ab?ab.challenges.reduce(function(s2,c){return s2+(c.pts||0);},0):0);},0).toFixed(2));
    var dateObj = new Date(date+'T00:00:00');
    var dN = dateObj.getDate();
    var dM = dateObj.toLocaleDateString('en-US',{month:'long'});
    var daySteps = Math.round(rawKm*1350);
    var shortMonth = dM.substring(0, 3).toUpperCase();

    var group = document.createElement('div');
    group.className = 'date-group' + (dayActs.length > 1 ? ' multi-activity' : '');
    group.id = 'dg-'+gi;

    var dateRow = document.createElement('div');
    dateRow.className = 'date-row';
    
    var dayTotal = parseFloat((db.distPts + db.bonusPts + chPts).toFixed(2));
    var hasFlagged = dayActs.some(function(a){ return a.is_flagged; });
    var actValHtml = hasFlagged ? 
      '<span class="whoop-stat-val" style="color: #EF4444;">' + dayActs.length + ' (Flagged)</span>' : 
      '<span class="whoop-stat-val">' + dayActs.length + '</span>';

    dateRow.innerHTML =
      '<div class="whoop-date-box">' +
        '<span class="whoop-date-num">' + dN + '</span>' +
        '<span class="whoop-date-month">' + esc(shortMonth) + '</span>' +
      '</div>' +
      '<div style="flex:1; display:flex; flex-direction:column; margin-left:12px; min-width:0; align-items:stretch;">' +
        '<div class="whoop-stats-box" style="margin-left:auto; justify-content:flex-end; padding-right:8px;">' +
          '<div class="whoop-stat-item">' + actValHtml + '<span class="whoop-stat-lbl">ACTS</span></div>' +
          '<div class="whoop-stat-item"><span class="whoop-stat-val">' + daySteps.toLocaleString('en-IN') + '</span><span class="whoop-stat-lbl">STEPS</span></div>' +
          '<div class="whoop-stat-item"><span class="whoop-stat-val">' + rawKm.toFixed(1) + '</span><span class="whoop-stat-lbl">KM</span></div>' +
        '</div>' +
        '<div class="whoop-points-box" style="display:flex; flex-wrap:wrap; gap:6px; font-size:12px; color:var(--muted); margin-top:6px; justify-content:flex-end; align-self:flex-end; padding-right:8px; font-weight:600; font-family:var(--font);">' +
          '<span>Base: <strong style="color:#60A5FA;">' + db.distPts + '</strong></span>' +
          '<span style="color:rgba(255,255,255,0.15);">&middot;</span>' +
          '<span>Bonus: <strong style="color:#FFD000;">' + db.bonusPts + '</strong></span>' +
          '<span style="color:rgba(255,255,255,0.15);">&middot;</span>' +
          '<span>Challenge: <strong style="color:#A78BFA;">' + chPts + '</strong></span>' +
        '</div>' +
        '<div class="whoop-total-box" style="font-size:13px; font-weight:700; color:var(--muted); margin-top:4px; align-self:flex-end; padding-right:8px; font-family:var(--font);">' +
          'Total: <strong style="color:var(--brand); font-size:14px; font-weight:800;">' + dayTotal + ' pts</strong>' +
        '</div>' +
      '</div>' +
      '<div class="date-chevron">❯</div>';
    
    if (dayActs.length === 1) {
      var _sid = dayActs[0].strava_activity_id;
      dateRow.addEventListener('click', (function(id){return function(e){openActivityDetail(id, e, true);}})(_sid));
    } else {
      dateRow.addEventListener('click', (function(d){return function(){showDateDetails(d);}})(date));
    }
    group.appendChild(dateRow);
    list.appendChild(group);
  });
}

function showDateDetails(dateStr) {
  var detailsView = document.getElementById('date-details-view');
  var titleEl = document.getElementById('details-date-title');
  var contentEl = document.getElementById('details-content-area');
  if (!detailsView || !contentEl) return;

  try {
    var dateObj = new Date(dateStr + 'T00:00:00');
    var weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
    var month = dateObj.toLocaleDateString('en-US', { month: 'long' });
    var dN = dateObj.getDate();
    if (titleEl) {
      titleEl.textContent = weekday + ', ' + month + ' ' + dN;
    }
  } catch(e) {
    if (titleEl) titleEl.textContent = dateStr;
  }

  var dayActs = (CURRENT_ACTS || []).filter(function(a) {
    return getActDate(a) === dateStr;
  });

  if (!dayActs.length) {
    contentEl.innerHTML = '<div class="empty-state"><p>No activities found for this date.</p></div>';
    detailsView.classList.add('visible');
    return;
  }

  var html = '';
  dayActs.forEach(function(a) {
    var sportStr = toTitleCaseDetail(a.sport_type || 'Activity');
    var actName = a.activity_name || 'Activity';
    var tc = tileClass(a.sport_type);
    
    var km = a.base_km ? a.base_km.toFixed(2) : (a.distance_meters ? (a.distance_meters/1000).toFixed(2) : '0.00');
    var dur = a.moving_time_seconds ? fmtDur(a.moving_time_seconds) : '—';
    var ela = a.elapsed_time_seconds ? fmtDur(a.elapsed_time_seconds) : '—';
    var ps = fmtPS(a.avg_speed, a.sport_type);
    
    var dateStartTimeStr = '—';
    var timePart = '';
    try {
      var dt = new Date(a.activity_date);
      var datePart = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      timePart = a.start_time ? fmtTime(a.activity_date, a.start_time) : (a.activity_date.indexOf('T') > -1 ? fmtTime(a.activity_date, '00:00:00') : '');
      dateStartTimeStr = datePart + (timePart ? ' at ' + timePart : '');
    } catch(e) {}

    var isFlag = a.is_flagged;
    var cardId = 'dac-' + a.strava_activity_id;

    var gridItems = [];
    if (km && parseFloat(km) > 0) gridItems.push({ label: 'Distance', val: km + ' km' });
    if (ps && ps !== '—' && ps !== '') gridItems.push({ label: 'Pace', val: ps });
    if (dur && dur !== '—' && dur !== '') gridItems.push({ label: 'Moving Time', val: dur });
    if (ela && ela !== '—' && ela !== '') gridItems.push({ label: 'Elapsed Time', val: ela });
    if (a.avg_heart_rate && parseFloat(a.avg_heart_rate) > 0) gridItems.push({ label: 'Avg HR', val: Math.round(a.avg_heart_rate) + ' bpm' });
    if (a.max_heart_rate && parseFloat(a.max_heart_rate) > 0) gridItems.push({ label: 'Max HR', val: Math.round(a.max_heart_rate) + ' bpm' });
    if (a.avg_cadence && parseFloat(a.avg_cadence) > 0) gridItems.push({ label: 'Avg Cadence', val: Math.round(a.avg_cadence * 2) + ' steps/min' });
    if (a.steps && parseInt(a.steps) > 0) gridItems.push({ label: 'Steps', val: parseInt(a.steps).toLocaleString('en-IN') });
    if (a.distance_meters && parseFloat(a.distance_meters) > 0) {
      var calcSteps = Math.round((a.distance_meters / 1000) * 1350);
      gridItems.push({ label: 'Calculated Steps', val: calcSteps.toLocaleString('en-IN') });
    }
    if (a.elevation_gain && parseFloat(a.elevation_gain) > 0) gridItems.push({ label: 'Elevation', val: Math.round(a.elevation_gain) + ' m' });
    if (a.calories && parseFloat(a.calories) > 0) gridItems.push({ label: 'Calories', val: Math.round(a.calories) + ' kcal' });
    var devName = a.device_name || a.device || '';
    if (devName && devName !== '—' && devName !== '') gridItems.push({ label: 'Device', val: esc(devName) });

    var gridHtml = '';
    gridItems.forEach(function(item) {
      gridHtml += '<div class="detail-item"><span class="detail-label">' + item.label + '</span><span class="detail-value">' + item.val + '</span></div>';
    });

    html +=
      '<div class="detail-act-card' + (isFlag ? ' flagged' : '') + '" id="' + cardId + '">' +
        '<div class="detail-act-hdr" onclick="openActivityDetail(\'' + a.strava_activity_id + '\', event, true)">' +
          '<div class="detail-act-hdr-left">' +
            '<div class="detail-act-icon ' + tc + '">' + renderIcon(a.sport_type) + '</div>' +
            '<div class="detail-act-title-wrap">' +
              '<div class="detail-act-name">' + esc(sportStr + ' - ' + actName) + '</div>' +
              '<div class="detail-act-sub">' + (timePart ? 'Started at ' + timePart : sportStr) + ' &middot; ' + km + ' km</div>' +
            '</div>' +
          '</div>' +
          '<div class="detail-act-hdr-right">' +
            '<div class="detail-act-chevron">›</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-act-body">' +
          '<div class="detail-status-row" style="margin-bottom: 12px; margin-top: 0;">' +
            '<div style="display: flex; align-items: center; justify-content: space-between;">' +
              '<span class="detail-label" style="margin-bottom: 0;">Activity Status</span>' +
              '<span class="status-badge ' + (isFlag ? 'invalid' : 'valid') + '" style="align-self: auto;">' + (isFlag ? (a.is_reviewed === true || a.is_reviewed === 'true' ? '⚑ Invalid (Reviewed)' : '⚑ Invalid (Under Review)') : '✓ Valid') + '</span>' +
            '</div>' +
            (isFlag ? 
            '<div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">' +
              '<span class="detail-label">Flag Reason</span>' +
              '<span class="flag-reason-text" style="margin-top: 0;">' + esc(a.flag_reason || 'Under review') + '</span>' +
            '</div>' : '') +
          '</div>' +
          '<div class="detail-divider" style="margin: 12px 0;"></div>' +
          '<div class="detail-grid">' +
            gridHtml +
          '</div>' +
          '<div class="detail-divider"></div>' +
          '<div id="splits-area-' + a.strava_activity_id + '" style="margin-top: 12px; margin-bottom: 12px;">' +
            '<div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Splits (per km)</div>' +
            '<div style="padding:16px 0;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px;">' +
              'Loading splits…' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  });

  contentEl.innerHTML = html;
  detailsView.classList.add('visible');

  if (dayActs.length === 1) {
    loadSplitsForActivity(dayActs[0].strava_activity_id);
  }
}

function toggleActCard(actId) {
  var card = document.getElementById('dac-' + actId);
  if (card) {
    card.classList.toggle('open');
    if (card.classList.contains('open')) {
      loadSplitsForActivity(actId);
    }
  }
}

function goBackToActivities() {
  var detailsView = document.getElementById('date-details-view');
  if (detailsView) {
    detailsView.classList.remove('visible');
  }
}

function toTitleCaseDetail(str) {
  if (!str) return '';
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

async function loadSplitsForActivity(actId) {
  var area = document.getElementById('splits-area-' + actId);
  if (!area || area.getAttribute('data-loaded') === 'true') return;

  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/activity_splits?activity_id=eq.' + actId + '&order=split_number.asc', { headers: HDR });
    var splits = await res.json();
    if (!splits || !splits.length) {
      area.innerHTML = 
        '<div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Splits (per km)</div>' +
        '<div style="padding:10px 0;font-size:13px;color:var(--muted)">No split data available for this activity.</div>';
      area.setAttribute('data-loaded', 'true');
      return;
    }

    var hasHR = splits.some(function(s){ return s.average_heartrate && parseFloat(s.average_heartrate) > 0; });
    var tableHtml = 
      '<div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Splits (per km)</div>' +
      '<div style="overflow-x:auto;"><table class="splits-table"><thead><tr>' +
        '<th>#</th><th>Pace</th><th>Distance</th>' + (hasHR ? '<th>Avg HR</th>' : '') +
      '</tr></thead><tbody>';

    splits.forEach(function(s) {
      var dVal = (s.distance_meters || 0) / 1000;
      var dStr = dVal.toFixed(2) + ' km';
      var mTime = s.moving_time_seconds || 0;
      var pStr = '—';
      if (dVal > 0 && mTime > 0) {
        var paceSec = mTime / dVal;
        var pMin = Math.floor(paceSec / 60);
        var pSec = Math.round(paceSec % 60);
        pStr = pMin + ':' + (pSec < 10 ? '0' : '') + pSec + '/km';
      }
      var hrVal = s.average_heartrate ? Math.round(s.average_heartrate) + ' bpm' : '—';
      tableHtml += '<tr>' +
        '<td style="color:var(--muted);font-weight:600;">' + s.split_number + '</td>' +
        '<td style="color:var(--brand);font-weight:700;">' + pStr + '</td>' +
        '<td style="color:#fff;font-weight:600;">' + dStr + '</td>' +
        (hasHR ? '<td>' + hrVal + '</td>' : '') +
      '</tr>';
    });
    tableHtml += '</tbody></table></div>';
    area.innerHTML = tableHtml;
    area.setAttribute('data-loaded', 'true');
  } catch(err) {
    console.error('Error loading splits:', err);
    area.innerHTML = 
      '<div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Splits (per km)</div>' +
      '<div style="font-size:13px;color:#EF4444;padding:8px 0;cursor:pointer;" onclick="loadSplitsForActivity(\'' + actId + '\')">Failed to load splits. Click to retry.</div>';
    area.removeAttribute('data-loaded');
  }
}

// Leaderboards Logic
function computeTeamExclusions(){
  function boardRows(filterFn){
    return LB_REG.filter(filterFn).map(function(p){
      var aid = String(p.strava_athlete_id);
      var score = LB_SCORES[aid] || {total:0, km:0, distPts:0, bonusPts:0, challengePts:0};
      return {p:p,pts:score};
    }).filter(function(r){return r.pts.total>0;}).sort(function(a,b){return b.pts.total-a.pts.total;});
  }
  var dsF = boardRows(function(p){var g=norm(p.gender),s=norm(p.shift);return g==='female'&&s.indexOf('day')>-1;});
  var dsM = boardRows(function(p){var g=norm(p.gender),s=norm(p.shift);return (g==='male'||g==='m')&&s.indexOf('day')>-1;});
  var ns  = boardRows(function(p){return norm(p.shift).indexOf('night')>-1;});
  var exFemale = dsF.slice(0,3).map(function(r){return String(r.p.strava_athlete_id);});
  var exMale   = dsM.slice(0,3).map(function(r){return String(r.p.strava_athlete_id);});
  ns.slice(0,3).forEach(function(r){
    var g=norm(r.p.gender),id=String(r.p.strava_athlete_id);
    if(g==='female'){if(exFemale.indexOf(id)===-1)exFemale.push(id);}
    else{if(exMale.indexOf(id)===-1)exMale.push(id);}
  });
  return {male:exMale,female:exFemale};
}

function getRows(mode){
  if(!LB_ME)return[];
  var myGender=norm(LB_ME.gender),myShift=norm(LB_ME.shift),myTeam=norm(LB_ME.leaderboard_team),isNight=myShift.indexOf('night')>-1,isFemale=myGender==='female'||myGender==='f';
  var filtered=LB_REG.filter(function(p){var pg=norm(p.gender),ps=norm(p.shift),pt=norm(p.leaderboard_team),pIsFemale=pg==='female'||pg==='f';if(pIsFemale!==isFemale)return false;if(mode==='team')return pt===myTeam;return ps.indexOf('night')>-1===isNight;});
  var rows=filtered.map(function(p){
    var aid = String(p.strava_athlete_id);
    var score = LB_SCORES[aid] || {total:0, km:0, distPts:0, bonusPts:0, challengePts:0};
    return {p:p,pts:score};
  }).filter(function(r){return r.pts.total>0;}).sort(function(a,b){return b.pts.total-a.pts.total;});
  
  if (mode === 'team') {
    var ex = computeTeamExclusions();
    var exList = isFemale ? ex.female : ex.male;
    return rows.filter(function(r){ return exList.indexOf(String(r.p.strava_athlete_id)) === -1; });
  }
  return rows;
}

function precomputeLBScores() {
  LB_SCORES = {};
  if (!LB_REG || !LB_REG.length) return;
  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });
  LB_REG.forEach(function(p) {
    var aid = String(p.strava_athlete_id);
    var pActs = actsByAthlete[aid] || [];
    LB_SCORES[aid] = calcFullPts(pActs, p.gender, p.shift);
  });
}

(function() {
  try {
    var cachedReg = JSON.parse(safeGetItem('agwalk_ranking_reg') || 'null');
    var cachedActs = JSON.parse(safeGetItem('agwalk_ranking_acts_v3') || 'null');
    if (cachedReg && cachedReg.data && cachedActs && cachedActs.data) {
      LB_REG = cachedReg.data;
      LB_ACTS = cachedActs.data;
      precomputeLBScores();
    }
  } catch(e) {}
})();

function getMedalLB(pts, gender) {
  var gKey = (String(gender||'').trim().toLowerCase() === 'female') ? 'female' : 'male';
  var thresh = { gold:{male:300,female:250}, silver:{male:200,female:150}, bronze:{male:125,female:100} };
  if (typeof medalData !== 'undefined' && Array.isArray(medalData) && medalData.length && medalData[0] && medalData[0].config_value) {
    thresh = medalData[0].config_value;
  }
  var g = Number((thresh.gold   ||{})[gKey]) || (gKey==='female'?250:300);
  var s = Number((thresh.silver ||{})[gKey]) || (gKey==='female'?150:200);
  var b = Number((thresh.bronze ||{})[gKey]) || (gKey==='female'?100:125);
  return pts >= g ? '🥇' : pts >= s ? '🥈' : pts >= b ? '🥉' : '';
}

var LB_currentTab = 'shift';
window.LB_currentTab = LB_currentTab;

function lastActiveLabel(dateStr) {
  if (!dateStr) return {text:'No activity',recent:false};
  var today=new Date(), d=new Date(dateStr+'T12:00:00');
  var diff=Math.floor((today-d)/86400000);
  if(diff===0) return {text:'Active today',recent:true};
  if(diff===1) return {text:'Active yesterday',recent:true};
  return {text:diff+' days ago',recent:false};
}

function buildSparkline(acts) {
  var dayKm={}, now=new Date();
  (acts||[]).filter(function(a){return !a.is_flagged;}).forEach(function(a){
    var d=getActDate(a); if(!d)return;
    dayKm[d]=(dayKm[d]||0)+(a.distance_meters||0)/1000;
  });
  var vals=[];
  for(var i=6;i>=0;i--){var d=new Date(now);d.setDate(d.getDate()-i);d.setHours(12,0,0,0);var ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');vals.push({km:dayKm[ds]||0,isToday:i===0});}
  var maxKm=Math.max.apply(null,vals.map(function(v){return v.km;}))||1;
  return vals.map(function(v){var h=Math.max(2,Math.round((v.km/maxKm)*20));return '<div class="spark-bar'+(v.isToday?' today':'')+'" style="height:'+h+'px" title="'+v.km.toFixed(1)+' km"></div>';}).join('');
}

function renderRows(rows, prevRanks) {
  prevRanks = prevRanks || {};
  var meId = LB_ME ? String(LB_ME.strava_athlete_id) : '', list = document.getElementById('lb-list');
  if (!list) return;
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty-box"><div class="ei">🏃</div><p>No activities yet in this category.</p></div>';
    safeSetText('lb-my-rank', '—');
    return;
  }
  list.innerHTML = '';
  
  var myRank = 0;
  var meRow = null;
  rows.forEach(function(r, i) {
    if (String(r.p.strava_athlete_id) === meId) {
      myRank = i + 1;
      meRow = r;
    }
  });

  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });

  function buildRowElement(r, i, isMePinned) {
    var isMe = String(r.p.strava_athlete_id) === meId;
    var isTeam = (LB_currentTab === 'team');
    var topCls = '';
    var rankIcon = '';
    var rankColCls = '';

    if (isTeam) {
      if (i === 0) {
        topCls = 'rank-1'; rankIcon = '1'; rankColCls = 'r1';
      } else if (i === 1) {
        topCls = 'rank-2'; rankIcon = '2'; rankColCls = 'r2';
      } else {
        topCls = ''; rankIcon = '#' + (i + 1); rankColCls = 'rn';
      }
    } else {
      if (i === 0) {
        topCls = 'rank-1'; rankIcon = '1'; rankColCls = 'r1';
      } else if (i === 1) {
        topCls = 'rank-2'; rankIcon = '2'; rankColCls = 'r2';
      } else if (i === 2) {
        topCls = 'rank-3'; rankIcon = '3'; rankColCls = 'r3';
      } else {
        topCls = ''; rankIcon = '#' + (i + 1); rankColCls = 'rn';
      }
    }
    var mPts = r.pts.total;
    var rowMedal = getMedalLB(mPts, r.p.gender);
    var teamName = (r.p.leaderboard_team || '').replace(/^Team\s+/i, '');

    var athId = String(r.p.strava_athlete_id);
    var prev = prevRanks[athId];
    var deltaHtml = '';
    if (prev != null) {
      var diff = prev - (i + 1);
      if (diff > 0) deltaHtml = '<span class="rank-delta delta-up">↑' + diff + '</span>';
      else if (diff < 0) deltaHtml = '<span class="rank-delta delta-dn">↓' + Math.abs(diff) + '</span>';
      else deltaHtml = '<span class="rank-delta delta-same">—</span>';
    }

    var myActsForRow = actsByAthlete[athId] || [];
    var la = getLastActive(myActsForRow);
    var laInfo = lastActiveLabel(la);

    var sparkHtml = '<div class="sparkline">' + buildSparkline(myActsForRow) + '</div>';

    var row = document.createElement('div');
    row.className = 'lb-row ' + topCls + (isMe ? ' is-me' : '') + (isMePinned ? ' is-me-pinned' : '');

    var summary = document.createElement('div');
    summary.className = 'row-summary';
    summary.innerHTML =
      '<div class="rank-col ' + rankColCls + '" style="display:flex;flex-direction:column;align-items:center;">' + rankIcon + deltaHtml + '</div>' +
      '<div class="row-body">' +
        '<div class="row-left">' +
          '<span class="row-name">' + esc(r.p.full_name || '—') + (isMe ? '<span class="you-chip">You</span>' : '') + '</span>' +
          (teamName ? '<span style="font-size:12px;color:var(--label);margin-top:2px;display:block;">' + esc(teamName) + '</span>' : '') +
        '</div>' +
        '<div class="row-right" style="display:flex;align-items:center;gap:6px;">' +
          '<div class="row-pts">' +
            '<span class="row-pts-num">' + r.pts.total.toFixed(2) + '</span>' +
            '<span class="row-pts-unit"> pts</span>' +
            (rowMedal ? '<span class="row-medal">' + rowMedal + '</span>' : '') +
          '</div>' +
          '<span class="row-chevron">▼</span>' +
        '</div>' +
      '</div>';

    var detail = document.createElement('div');
    detail.className = 'row-detail';

    var chalHtml = r.pts.challengePts > 0
      ? '<div class="detail-cell"><div class="detail-cell-lbl">🎯 Challenge</div><div class="detail-cell-val green">' + r.pts.challengePts.toFixed(1) + '</div></div>'
      : '';

    detail.innerHTML =
      '<div class="detail-grid">' +
        '<div class="detail-cell"><div class="detail-cell-lbl">📏 Distance</div><div class="detail-cell-val blue">' + r.pts.km.toFixed(1) + ' km</div></div>' +
        '<div class="detail-cell"><div class="detail-cell-lbl">⭐ Dist Pts</div><div class="detail-cell-val brand">' + r.pts.distPts.toFixed(1) + '</div></div>' +
        '<div class="detail-cell"><div class="detail-cell-lbl">⚡ Bonus</div><div class="detail-cell-val gold">' + r.pts.bonusPts + '</div></div>' +
        (chalHtml || '<div class="detail-cell"><div class="detail-cell-lbl">🎯 Challenge</div><div class="detail-cell-val" style="color:var(--label)">—</div></div>') +
        '<div class="detail-cell" style="grid-column:span ' + (r.pts.challengePts > 0 ? '2' : '3') + '"><div class="detail-cell-lbl">🏆 Total</div><div class="detail-cell-val brand" style="font-size:18px;">' + r.pts.total.toFixed(2) + '</div></div>' +
      '</div>' +
      '<div class="detail-meta">' +
        '<span class="last-active-chip' + (laInfo.recent ? ' recent' : '') + '">' + laInfo.text + '</span>' +
        sparkHtml +
      '</div>';

    row.appendChild(summary);
    row.appendChild(detail);

    row.addEventListener('click', function() {
      var isExp = row.classList.contains('expanded');
      var allRows = list.querySelectorAll('.lb-row');
      allRows.forEach(function(r2) { r2.classList.remove('expanded'); });
      if (!isExp) row.classList.add('expanded');
    });

    return row;
  }

  var frag = document.createDocumentFragment();
  rows.forEach(function(r, i) {
    var isMe = String(r.p.strava_athlete_id) === meId;
    if (isMe && myRank > 3) {
      return;
    }
    
    var rowEl = buildRowElement(r, i, false);
    frag.appendChild(rowEl);
    
    if (i === 2 && myRank > 3 && meRow) {
      var pinnedEl = buildRowElement(meRow, myRank - 1, true);
      frag.appendChild(pinnedEl);
    }
  });
  requestAnimationFrame(function() {
    list.appendChild(frag);
    var rnkEl = document.getElementById('lb-my-rank');
    if (rnkEl && myRank > 0) rnkEl.textContent = '#' + myRank;
  });
}

function renderHallOfFame() {
  var list = document.getElementById('lb-list');
  if (!list) return;
  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    if (a.is_flagged) return;
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });

  var allScored = LB_REG.map(function(p) {
    var acts = actsByAthlete[p.strava_athlete_id] || [];
    var totalKm = acts.reduce(function(s,a){return s+(a.distance_meters||0)/1000;},0);
    var dayKm = {};
    acts.forEach(function(a){var d=getActDate(a);if(d)dayKm[d]=(dayKm[d]||0)+(a.distance_meters||0)/1000;});
    var maxDayKm = Object.values(dayKm).reduce(function(m,v){return Math.max(m,v);},0);
    var days = Object.keys(dayKm).sort(), streak=0, cur=0, prev=null;
    days.forEach(function(d){if(prev){var diff=Math.round((new Date(d+'T12:00:00')-new Date(prev+'T12:00:00'))/86400000);cur=diff===1?cur+1:1;}else cur=1;streak=Math.max(streak,cur);prev=d;});
    return {name:p.full_name||'—', totalKm:totalKm, maxDayKm:maxDayKm, streak:streak, actCount:acts.length};
  }).filter(function(x){return x.totalKm>0;});

  var byKm = allScored.slice().sort(function(a,b){return b.totalKm-a.totalKm;});
  var byDay = allScored.slice().sort(function(a,b){return b.maxDayKm-a.maxDayKm;});
  var byStreak = allScored.slice().sort(function(a,b){return b.streak-a.streak;});
  var byCount = allScored.slice().sort(function(a,b){return b.actCount-a.actCount;});

  function hofCard(title, icon, name, val) {
    return '<div class="hof-card">'+
      '<div style="font-size:28px;flex-shrink:0;">'+icon+'</div>'+
      '<div style="flex:1;min-width:0;">'+
        '<div class="hof-title">'+title+'</div>'+
        '<div class="hof-val">'+val+'</div>'+
        '<div class="hof-name">'+esc(name)+'</div>'+
      '</div>'+
    '</div>';
  }

  list.innerHTML = '<div class="hof-grid">'+
    hofCard('Most km', '🏅', byKm[0]?byKm[0].name:'—', byKm[0]?byKm[0].totalKm.toFixed(1)+' km':'—') +
    hofCard('Best Day', '🌟', byDay[0]?byDay[0].name:'—', byDay[0]?byDay[0].maxDayKm.toFixed(1)+' km':'—') +
    hofCard('Longest Streak', '🔥', byStreak[0]?byStreak[0].name:'—', byStreak[0]?byStreak[0].streak+' days':'—') +
    hofCard('Most Activities', '⚡', byCount[0]?byCount[0].name:'—', byCount[0]?byCount[0].actCount+' acts':'—') +
  '</div>';
}

function switchTab(mode) {
  LB_currentTab = mode;
  safeToggleClass('lb-tab-shift', 'active', mode === 'shift');
  safeToggleClass('lb-tab-team', 'active', mode === 'team');
  safeToggleClass('lb-tab-hof', 'active', mode === 'hof');
  if (mode === 'hof') {
    renderHallOfFame();
    return;
  }
  renderRows(getRows(mode));
}
window.switchTab = switchTab;

function buildTabs() {
  if (!LB_ME) return;
  var myGender = norm(LB_ME.gender), myShift = norm(LB_ME.shift), myTeam = LB_ME.leaderboard_team || 'My Team', isNight = myShift.indexOf('night') > -1, isFemale = myGender === 'female' || myGender === 'f';
  safeSetText('lb-tab-shift', isNight ? 'Nightshift' : 'Dayshift');
  safeSetText('lb-tab-team', myTeam);
}

function showSkeletons() {
  var h = '';
  for (var i = 0; i < 6; i++) h += '<div class="skel-row"><div class="skeleton skel-c"></div><div class="skel-lines"><div class="skeleton skel-l m"></div><div class="skeleton skel-l s"></div></div></div>';
  safeSetHtml('lb-list', h);
}

function lbRender() {
  var s = JSON.parse(localStorage.getItem('wk_user') || '{}');
  try {
    renderStanding();
    var name = (LB_ME && LB_ME.full_name) || s.name || 'Participant';
    safeSetText('lb-my-name', name.toUpperCase());
    var tags = [];
    if (LB_ME && LB_ME.gender) tags.push(LB_ME.gender);
    if (LB_ME && LB_ME.shift) tags.push(LB_ME.shift);
    if (LB_ME && LB_ME.leaderboard_team) tags.push(LB_ME.leaderboard_team);
    safeSetHtml('lb-my-tags', tags.map(function(t) { return '<span class="my-tag">' + esc(t) + '</span>'; }).join(''));
    
    buildTabs();
    renderRows(getRows(LB_currentTab));
    
    var allRows = getRows(LB_currentTab);
    var myRow = allRows.find(function(r) { return String(r.p.strava_athlete_id) === String(s.athleteId); });
    safeSetText('lb-my-pts', myRow ? myRow.pts.total.toFixed(2) : '—');
    
    (function() {
      try {
        var meId = s.athleteId;
        var curRank = allRows.findIndex(function(r) { return String(r.p.strava_athlete_id) === String(meId); }) + 1;
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        var cutoffStr = getISTDate(cutoff.toISOString());
        var oldActs = LB_ACTS.filter(function(a) { return getActDate(a) <= cutoffStr; });
        
        var oldActsMap = {};
        oldActs.forEach(function(a) {
          var aid = String(a.strava_athlete_id);
          if (!oldActsMap[aid]) oldActsMap[aid] = [];
          oldActsMap[aid].push(a);
        });
        
        var myGd = norm(LB_ME.gender), myShd = norm(LB_ME.shift), isNd = myShd.indexOf('night') > -1, isFd = myGd === 'female' || myGd === 'f';
        var oldRows = LB_REG.filter(function(q) {
          var pg = norm(q.gender), ps = norm(q.shift), pt = norm(q.leaderboard_team), pIsFemale = pg === 'female' || pg === 'f';
          if (pIsFemale !== isFd) return false;
          return LB_currentTab === 'team' ? pt === norm(LB_ME.leaderboard_team) : ps.indexOf('night') > -1 === isNd;
        }).map(function(q) {
          var aid = String(q.strava_athlete_id);
          var acts = oldActsMap[aid] || [];
          return { id: aid, pts: calcFullPts(acts, q.gender, q.shift).total };
        }).filter(function(r) { return r.pts > 0; }).sort(function(a, b) { return b.pts - a.pts; });
        
        var oldRank = oldRows.findIndex(function(r) { return r.id === String(meId); }) + 1;
        var rmEl = document.getElementById('lb-rank-move');
        if (rmEl && curRank > 0) {
          if (oldRank <= 0 || oldRank === curRank) {
            rmEl.textContent = 'same';
            rmEl.style.color = 'var(--muted)';
          } else if (curRank < oldRank) {
            rmEl.innerHTML = '<span style="color:var(--green)">&#8679; ' + (oldRank - curRank) + '</span> up';
          } else {
            rmEl.innerHTML = '<span style="color:#f87171">&#8681; ' + (curRank - oldRank) + '</span> down';
          }
        }
        
        var ngEl = document.getElementById('lb-next-gap');
        var nnEl = document.getElementById('lb-next-name');
        if (ngEl && curRank > 1 && allRows.length >= curRank) {
          var above = allRows[curRank - 2];
          var gap = above.pts.total - (myRow ? myRow.pts.total : 0);
          ngEl.textContent = gap.toFixed(1) + ' pts behind';
          if (nnEl) nnEl.textContent = esc(above.p.full_name || '');
        } else if (ngEl && curRank === 1) {
          ngEl.textContent = 'You are #1!';
          ngEl.style.color = 'var(--gold)';
          if (nnEl) nnEl.textContent = 'Lead to the finish';
        }
      } catch (e2) {
        console.warn('RankMove:', e2);
      }
    })();
  } catch (e) {
    console.error('lbRender error:', e);
  }
}
window.lbRender = lbRender;

function lbBoot() {
  if (!_lbReady) {
    precomputeLBScores();
    _lbReady = true;
  }
  showSkeletons();
  setTimeout(function() { lbRender(); }, 0);
}
window.lbBoot = lbBoot;

function renderStanding() {
  try {
    var reg = LB_ME || {};
    var athleteId = reg.strava_athlete_id || (currentSession && currentSession.athleteId);
    if (!athleteId || !LB_REG || !LB_REG.length) return;

    var allReg=LB_REG,myGenderN=norm(reg.gender),myShiftN=norm(reg.shift);
    var myTeamN=norm(reg.leaderboard_team),isNight=myShiftN.indexOf('night')>-1,isFemale=myGenderN==='female'||myGenderN==='f';
    function rankIn(peers){
      var scored=peers.map(function(p){
        var aid = String(p.strava_athlete_id);
        var score = LB_SCORES[aid];
        var total = score ? score.total : 0;
        return{id:p.strava_athlete_id,pts:total};
      }).filter(function(x){return x.pts>0;}).sort(function(a,b){return b.pts-a.pts;});
      var pos=scored.findIndex(function(x){return String(x.id)===String(athleteId);});
      return pos>=0?pos+1:null;
    }

    var shiftPeers=allReg.filter(function(p){
      var pg=norm(p.gender),ps=norm(p.shift);
      return ps.indexOf('night')>-1===isNight&&(pg==='female'||pg==='f')===isFemale;
    });

    var excl=computeTeamExclusions();
    var exSet=isFemale?excl.female:excl.male;
    var teamPeers=allReg.filter(function(p){
      var pg=norm(p.gender),pt=norm(p.leaderboard_team);
      return pt===myTeamN&&(pg==='female'||pg==='f')===isFemale&&exSet.indexOf(String(p.strava_athlete_id))===-1;
    });

    var shiftRank=rankIn(shiftPeers),teamRank=rankIn(teamPeers);
    function ordinal(n){if(!n)return'—';var sfx=['th','st','nd','rd'],v=n%100;var s=sfx[(v-20)%10]||sfx[v]||sfx[0];return n+'<span class="rank-sup">'+s+'</span>';}
    var shiftLabel=isNight?'Nightshift · '+(isFemale?'Female':'Male'):'Dayshift · '+(isFemale?'Female':'Male');
    var teamLabel=(reg.leaderboard_team||'Team')+' · '+(isFemale?'Female':'Male');

    var sLabelEl = document.getElementById('standing-shift-label'); if (sLabelEl) sLabelEl.textContent=shiftLabel;
    var sRankEl = document.getElementById('standing-shift-rank'); if (sRankEl) sRankEl.innerHTML=shiftRank?ordinal(shiftRank):'—';
    var tLabelEl = document.getElementById('standing-team-label'); if (tLabelEl) tLabelEl.textContent=teamLabel;
    var tRankEl = document.getElementById('standing-team-rank'); if (tRankEl) tRankEl.innerHTML=teamRank?ordinal(teamRank):'—';

    var isTop3Individual = shiftRank && shiftRank <= 3;
    var standingGrid = document.querySelector('.standing-grid');
    var teamCard = tRankEl ? tRankEl.closest('.standing-card') : null;
    if(isTop3Individual){
      if(teamCard) teamCard.style.display='none';
      if(standingGrid) standingGrid.style.gridTemplateColumns='1fr';
    } else {
      if(teamCard) teamCard.style.display='';
      if(standingGrid) standingGrid.style.gridTemplateColumns='1fr 1fr';
    }

    var myActs = LB_ACTS.filter(function(a){return String(a.strava_athlete_id)===String(athleteId);});
    var currentPoints = calcFullPts(myActs, reg.gender, reg.shift).total;
    checkMilestoneNotifications(athleteId, shiftRank, currentPoints, reg.gender, myActs, reg);
  } catch(e) {
    console.warn('renderStanding failed:', e);
  }
}

async function checkMilestoneNotifications(athleteId, currentRank, currentPoints, currentGender, myActs, reg) {
  if (!_notificationsLoaded) return;
  if (window._checkingMilestones) return;
  window._checkingMilestones = true;

  async function triggerAchievement(triggerKey, vars) {
    if (!athleteId) return;

    fetch(BACKEND + '/push/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_key: triggerKey, athlete_id: athleteId, vars: vars })
    }).catch(function(err){});

    var isAllowed = false;
    var rules = (typeof CONFIG_LB !== 'undefined' && CONFIG_LB.feed_config && CONFIG_LB.feed_config.rules) ? CONFIG_LB.feed_config.rules : {};

    if (triggerKey.indexOf('medal_') === 0 && rules.allow_medals) {
      isAllowed = true;
    } else if (triggerKey.indexOf('club_') === 0 && rules.allow_distance_clubs) {
      isAllowed = true;
    } else if (triggerKey === 'rank_top1' && rules.allow_rank_top1) {
      isAllowed = true;
    }

    if (isAllowed) {
      fetch(BACKEND + '/feed/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger_key: triggerKey, athlete_id: athleteId, vars: vars })
      }).catch(function(err){});
    }
  }

  try {
    var keyRank = 'agprev_prev_rank_' + athleteId;
    var keyMedals = 'agprev_prev_medals_' + athleteId;
    var keyChallenges = 'agprev_prev_challenges_' + athleteId;

    var prevRank = localStorage.getItem(keyRank);
    var prevMedalsRaw = localStorage.getItem(keyMedals);
    var prevChallengesRaw = localStorage.getItem(keyChallenges);

    var prevMedals = prevMedalsRaw ? JSON.parse(prevMedalsRaw) : [];
    var prevChallenges = prevChallengesRaw ? JSON.parse(prevChallengesRaw) : [];

    var gKey = (currentGender || '').toLowerCase() === 'female' ? 'female' : 'male';
    var medalsThresh = { gold: 300, silver: 200, bronze: 125 };
    if (typeof medalData !== 'undefined' && Array.isArray(medalData) && medalData.length && medalData[0].config_value) {
      medalsThresh = medalData[0].config_value;
    }
    var bt = Number(medalsThresh.bronze[gKey]) || 125;
    var st = Number(medalsThresh.silver[gKey]) || 200;
    var gt = Number(medalsThresh.gold[gKey]) || 300;

    var currentMedals = [];
    if (currentPoints >= bt) currentMedals.push('medal_bronze');
    if (currentPoints >= st) currentMedals.push('medal_silver');
    if (currentPoints >= gt) currentMedals.push('medal_gold');

    for (var i = 0; i < currentMedals.length; i++) {
      var mKey = currentMedals[i];
      var searchTitle = mKey === 'medal_bronze' ? 'Bronze Medal' : mKey === 'medal_silver' ? 'Silver Medal' : 'Gold Medal';
      var alreadyNotifiedDb = _notificationsList.some(function(n) {
        return n.title && n.title.indexOf(searchTitle) !== -1;
      });
      if (prevMedals.indexOf(mKey) === -1 && !alreadyNotifiedDb) {
        await triggerAchievement(mKey);
      }
    }

    var validActs = myActs.filter(function(a) { 
      return !a.is_flagged && !a.is_deleted; 
    });
    validActs.forEach(function(a) {
      a.base_km = parseFloat(a.distance_meters || 0) / 1000;
    });

    var totalKm = validActs.reduce(function(sum, a) { return sum + a.base_km; }, 0);
    var keyClubs = 'agprev_prev_clubs_' + athleteId;
    var prevClubsRaw = localStorage.getItem(keyClubs);
    var prevClubs = prevClubsRaw ? JSON.parse(prevClubsRaw) : [];

    var clubsToCheck = [
      { key: 'club_100', thresh: 100, title: '100 KM Club' },
      { key: 'club_200', thresh: 200, title: '200 KM Club' },
      { key: 'club_300', thresh: 300, title: '300 KM Club' }
    ];

    for (var i = 0; i < clubsToCheck.length; i++) {
      var club = clubsToCheck[i];
      if (totalKm >= club.thresh) {
        var alreadyNotifiedDb = _notificationsList.some(function(n) {
          return n.title && n.title.indexOf(club.title) !== -1;
        });
        if (prevClubs.indexOf(club.key) === -1 && !alreadyNotifiedDb) {
          await triggerAchievement(club.key);
          prevClubs.push(club.key);
          localStorage.setItem(keyClubs, JSON.stringify(prevClubs));
        }
      }
    }

    var completedChallenges = [];
    if (typeof CHALLENGES_LB !== 'undefined' && Array.isArray(CHALLENGES_LB)) {
      CHALLENGES_LB.forEach(function(c) {
        if (!c.is_active) return;
        var qualifies = myActs.some(function(act) { return checkChallengeSingle(act, c); });
        if (qualifies) {
          completedChallenges.push(c.id);
          var alreadyNotifiedDb = _notificationsList.some(function(n) {
            return n.title && n.title.indexOf(c.name) !== -1;
          });
          if (prevChallenges.indexOf(c.id) === -1 && !alreadyNotifiedDb) {
            triggerAchievement('challenge_bonus', { name: c.name });
          }
        }
      });
    }

    if (currentRank && prevRank !== null && prevRank !== undefined && prevRank !== '') {
      var cRank = parseInt(currentRank, 10);
      var pRank = parseInt(prevRank, 10);
      if (cRank < pRank) {
        var tKey = cRank === 1 ? 'rank_top1' : 'rank_improved';
        triggerAchievement(tKey, { rank: String(cRank) });
      } else if (cRank > pRank) {
        triggerAchievement('rank_dropped', { rank: String(cRank) });
      }
    }

    localStorage.setItem(keyRank, String(currentRank));
    localStorage.setItem(keyMedals, JSON.stringify(currentMedals));
    localStorage.setItem(keyChallenges, JSON.stringify(completedChallenges));
  } catch (err) {
    console.warn('Failed to check milestone notifications:', err);
  } finally {
    window._checkingMilestones = false;
  }
}

function getLastActive(acts) {
  if (!acts || !acts.length) return null;
  var sorted = acts.filter(function(a){return !a.is_flagged;}).map(function(a){return getActDate(a);}).filter(Boolean).sort();
  return sorted.length ? sorted[sorted.length-1] : null;
}

// Feed Tab Rendering
function initializeFeedTab(enabled) {
  var track = document.getElementById('tab-track');
  var bnavFeed = document.getElementById('bnav-feed');
  var tabFeed = document.getElementById('tab-feed');
  var bnav = document.querySelector('.bottom-nav');
  
  if (enabled) {
    if (TAB_ORDER.indexOf('feed') === -1) {
      TAB_ORDER.splice(3, 0, 'feed');
    }
    if (bnavFeed) bnavFeed.style.display = '';
    if (tabFeed) tabFeed.classList.remove('hidden-tab');
    if (bnav) bnav.classList.add('nav-five-tabs');
  } else {
    var idx = TAB_ORDER.indexOf('feed');
    if (idx !== -1) {
      TAB_ORDER.splice(idx, 1);
    }
    if (bnavFeed) bnavFeed.style.display = 'none';
    if (tabFeed) tabFeed.classList.add('hidden-tab');
    if (bnav) bnav.classList.remove('nav-five-tabs');
  }
  
  if (track) {
    track.style.width = (TAB_ORDER.length * 100) + '%';
    var contents = track.querySelectorAll('.content:not(.hidden-tab)');
    var contentWidth = (100 / TAB_ORDER.length) + '%';
    contents.forEach(function(el) {
      el.style.width = contentWidth;
    });
  }
  setTimeout(updateNavIndicator, 50);
}

function formatMarkdown(text) {
  if (!text) return '';
  var html = esc(text);
  // Bold: **text** or __text__
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
  // Italics: *text* or _text_
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');
  return html;
}

async function loadFeed(isSilent) {
  var list = document.getElementById('feed-list');
  if (list && !isSilent) {
    list.innerHTML = `
      <div class="skel-card"><div class="skeleton skel-line full"></div><div class="skeleton skel-line medium"></div><div class="skeleton skel-line short"></div></div>
      <div class="skel-card"><div class="skeleton skel-line full"></div><div class="skeleton skel-line medium"></div><div class="skeleton skel-line short"></div></div>
    `;
  }

  try {
    var athleteId = currentSession ? currentSession.athleteId : '';
    var res = await fetch(BACKEND + '/announcements?athlete_id=' + encodeURIComponent(athleteId) + '&_t=' + Date.now());
    var d = await res.json();
    if (d.success && Array.isArray(d.feed)) {
      var sortedNewFeed = d.feed;
      sortedNewFeed.sort(function(a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
      });
      
      var changed = JSON.stringify(sortedNewFeed) !== JSON.stringify(_feedData);
      if (changed || !isSilent) {
        _feedData = sortedNewFeed;
        if (!isSilent) {
          _feedVisibleCount = 30;
        }
        if (list) {
          renderFeed();
        }
        updateInAppNotificationBanner();
      }
      
      var lastViewedStr = safeGetItem('ag_last_viewed_announcements') || '';
      var lastViewedTime = lastViewedStr ? new Date(lastViewedStr).getTime() : 0;
      if (_currentTab === 'feed') {
        lastViewedTime = Date.now();
        safeSetItem('ag_last_viewed_announcements', new Date(lastViewedTime).toISOString());
      }
      var hasNew = _feedData.some(function(item) {
        var itemTime = item.created_at ? new Date(item.created_at).getTime() : 0;
        return itemTime > lastViewedTime;
      });
      var badgeEl = document.getElementById('feed-unread-badge');
      if (badgeEl) {
        badgeEl.style.display = hasNew ? 'block' : 'none';
      }
    } else {
      if (list && !isSilent) {
        list.innerHTML = '<div class="empty-state"><div class="icon">📢</div><p>No updates in the feed yet. Check back later!</p></div>';
      }
    }
  } catch(e) {
    console.warn('Failed to load feed:', e);
    if (list && !isSilent) {
      list.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><p>Could not load feed.</p></div>';
    }
  }
}

function getMilestoneWeight(title) {
  var t = (title || '').toLowerCase();
  if (t.indexOf('gold medal') > -1) return 100;
  if (t.indexOf('silver medal') > -1) return 90;
  if (t.indexOf('bronze medal') > -1) return 80;
  if (t.indexOf('300 km club') > -1) return 70;
  if (t.indexOf('200 km club') > -1) return 60;
  if (t.indexOf('100 km club') > -1) return 50;
  if (t.indexOf('21-day') > -1) return 45;
  if (t.indexOf('14-day') > -1) return 40;
  if (t.indexOf('7-day') > -1) return 35;
  if (t.indexOf('half-marathon') > -1 || t.indexOf('21+ km') > -1) return 30;
  if (t.indexOf('super-distance') > -1 || t.indexOf('15+ km') > -1) return 25;
  if (t.indexOf('double-digit') > -1 || t.indexOf('10+ km') > -1) return 20;
  if (t.indexOf('21 km daily') > -1) return 15;
  if (t.indexOf('15 km daily') > -1) return 10;
  if (t.indexOf('10 km daily') > -1) return 5;
  return 1;
}

function renderFeedHighlights() {
  var container = document.getElementById('feed-highlights-row');
  if (container) container.style.display = 'none';
  return;

  var actsByAthlete = {};
  LB_ACTS.forEach(function(a) {
    var aid = String(a.strava_athlete_id);
    if (!actsByAthlete[aid]) actsByAthlete[aid] = [];
    actsByAthlete[aid].push(a);
  });

  var scored = LB_REG.map(function(p) {
    var acts = actsByAthlete[p.strava_athlete_id] || [];
    var totalKm = acts.reduce(function(s,a){return s+(a.distance_meters||0)/1000;}, 0);
    var dayKm = {};
    acts.forEach(function(a){var d=getActDate(a);if(d)dayKm[d]=(dayKm[d]||0)+(a.distance_meters||0)/1000;});
    
    var days = Object.keys(dayKm).sort(), streak=0, cur=0, prev=null;
    days.forEach(function(d){if(prev){var diff=Math.round((new Date(d+'T12:00:00')-new Date(prev+'T12:00:00'))/86400000);cur=diff===1?cur+1:1;}else cur=1;streak=Math.max(streak,cur);prev=d;});
    
    return {
      id: String(p.strava_athlete_id),
      name: p.full_name || '—',
      totalKm: totalKm,
      streak: streak,
      actCount: acts.length,
      team: p.leaderboard_team || ''
    };
  }).filter(function(x){return x.totalKm > 0;});

  if (!scored.length) {
    container.style.display = 'none';
    return;
  }

  var topDist = scored.slice().sort(function(a,b){return b.totalKm - a.totalKm;})[0];
  var topStreak = scored.slice().sort(function(a,b){return b.streak - a.streak;})[0];
  var topCount = scored.slice().sort(function(a,b){return b.actCount - a.actCount;})[0];

  var teamDist = {};
  scored.forEach(function(x) {
    if (x.team) teamDist[x.team] = (teamDist[x.team] || 0) + x.totalKm;
  });
  var topTeamName = '';
  var topTeamKm = 0;
  Object.keys(teamDist).forEach(function(team) {
    if (teamDist[team] > topTeamKm) {
      topTeamKm = teamDist[team];
      topTeamName = team;
    }
  });

  _highlightsData = {
    champ: topDist ? {
      emoji: '🚶‍♂️',
      title: 'Distance Champion',
      subtitle: topDist.totalKm.toFixed(1) + ' km walked',
      body: topDist.name + ' is leading the walkathon leaderboard with an outstanding total distance of ' + topDist.totalKm.toFixed(1) + ' km! Keep pacing the way!',
      ringColor: '#FFD000'
    } : null,
    streak: topStreak && topStreak.streak > 0 ? {
      emoji: '🔥',
      title: 'Streak Master',
      subtitle: topStreak.streak + ' Days Active',
      body: topStreak.name + ' is on fire with a consecutive daily log streak of ' + topStreak.streak + ' days! Consistency wins!',
      ringColor: '#E8622A'
    } : null,
    active: topCount ? {
      emoji: '⚡',
      title: 'Most Active',
      subtitle: topCount.actCount + ' Activities',
      body: topCount.name + ' has logged the highest activity frequency with ' + topCount.actCount + ' verified workouts this month! Relentless drive!',
      ringColor: '#22C55E'
    } : null,
    team: topTeamName ? {
      emoji: '🏆',
      title: 'Top Team',
      subtitle: topTeamKm.toFixed(1) + ' km accumulated',
      body: topTeamName + ' is leading the team leaderboard with a total combined distance of ' + topTeamKm.toFixed(1) + ' km! Strength in numbers!',
      ringColor: '#A78BFA'
    } : null
  };

  container.innerHTML = '';
  container.style.display = 'flex';
  
  var cardsHtml = [];
  ['champ', 'streak', 'active', 'team'].forEach(function(key) {
    var data = _highlightsData[key];
    if (data) {
      cardsHtml.push(`
        <div class="highlight-card" onclick="openHighlightDetail('${key}')" style="border-top: 2.5px solid ${data.ringColor};">
          <div class="highlight-emoji">${data.emoji}</div>
          <div class="highlight-info">
            <div class="highlight-title">${esc(data.title)}</div>
            <div class="highlight-sub">${esc(data.subtitle)}</div>
          </div>
        </div>
      `);
    }
  });
  container.innerHTML = cardsHtml.join('');
}

function openHighlightDetail(key) {
  var data = _highlightsData[key];
  if (!data) return;
  var modal = document.getElementById('highlight-detail-modal');
  if (!modal) return;
  
  var emojiEl = document.getElementById('highlight-modal-emoji');
  var titleEl = document.getElementById('highlight-modal-title');
  var subEl = document.getElementById('highlight-modal-subtitle');
  var bodyEl = document.getElementById('highlight-modal-body');
  
  if (emojiEl) emojiEl.textContent = data.emoji;
  if (titleEl) titleEl.textContent = data.title;
  if (subEl) {
    subEl.textContent = data.subtitle;
    subEl.style.color = data.ringColor;
  }
  if (bodyEl) bodyEl.textContent = data.body;
  
  modal.style.display = 'flex';
  var card = modal.querySelector('.modal-card');
  if (card) {
    card.style.transform = 'scale(0.9)';
    setTimeout(function() {
      card.style.transform = 'scale(1)';
    }, 10);
  }
}

function triggerHighlightCheer() {
  triggerConfettiBurst();
  var modal = document.getElementById('highlight-detail-modal');
  if (modal) modal.style.display = 'none';
}

function triggerConfettiBurst() {
  if (typeof confetti === 'function') {
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.85 } });
  }
}

function initFeedMaps() {
  if (_currentTab !== 'feed') return;

  var elements = document.querySelectorAll('.feed-map-container');
  elements.forEach(function(el) {
    if (el.classList.contains('leaflet-container')) {
      try {
        var mapInstance = el._leafletMap;
        if (mapInstance) {
          mapInstance.invalidateSize();
          if (typeof mapInstance._refit === 'function') {
            mapInstance._refit();
          }
        }
      } catch(e) {}
      return;
    }

    var polylineStr = _feedPolylines[el.id];
    if (!polylineStr) return;

    try {
      var coordinates = decodePolyline(polylineStr);
      if (coordinates && coordinates.length > 0) {
        var map = L.map(el.id, {
          zoomControl: false,
          dragging: false,
          touchZoom: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          attributionControl: false
        }).setView(coordinates[0], 14);

        el._leafletMap = map;
        window._feedMaps.push(map);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 20,
          className: 'app-map-tile'
        }).addTo(map);

        var poly = L.polyline(coordinates, {
          color: '#E8622A', // Brand orange matching detail map
          weight: 4,
          opacity: 0.9,
          lineJoin: 'round'
        }).addTo(map);

        // Add start and end point circle markers
        L.circleMarker(coordinates[0], {
          radius: 5,
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#22c55e', // Emerald Green for start
          fillOpacity: 1
        }).addTo(map);

        L.circleMarker(coordinates[coordinates.length - 1], {
          radius: 5,
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#ef4444', // Red for end
          fillOpacity: 1
        }).addTo(map);

        map._refit = function() {
          try {
            map.fitBounds(poly.getBounds(), { padding: [12, 12] });
          } catch(e) {}
        };

        map._refit();

        setTimeout(function() {
          try {
            map.invalidateSize();
            map._refit();
          } catch(e) {}
        }, 100);
      }
    } catch (err) {
      console.warn('Failed lazy initializing map for ' + el.id + ':', err);
    }
  });
}

function getFeedItemPriority(item) {
  if (item.type === 'milestone') {
    var title = (item.title || '').toLowerCase();
    var isRank = title.indexOf('#1') > -1 || title.indexOf('rank 1') > -1 || title.indexOf('first rank') > -1 || title.indexOf('leading') > -1;
    if (isRank) return 4;
    var isMedal = title.indexOf('medal') > -1 || title.indexOf('bronze') > -1 || title.indexOf('silver') > -1 || title.indexOf('gold') > -1;
    if (isMedal) return 3;
    var isClub = title.indexOf('club') > -1 || title.indexOf('km') > -1;
    if (isClub) return 2;
    return 1;
  }
  return 1;
}

function renderFeed() {
  var list = document.getElementById('feed-list');
  if (!list) return;

  // Clean up existing feed map instances to prevent severe memory leak
  if (window._feedMaps && window._feedMaps.length > 0) {
    window._feedMaps.forEach(function(m) {
      try { m.remove(); } catch(e) {}
    });
  }
  window._feedMaps = [];

  renderFeedHighlights();
  renderCommunityPulse();
  
  if (!_feedData.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📢</div><p>No updates in the feed yet. Check back later!</p></div>';
    return;
  }

  // Load configuration rules
  var config = (CONFIG_LB && CONFIG_LB.feed_config) ? CONFIG_LB.feed_config : defaultConfig;
  var rules = config.rules || {};
  var filters = config.filters || {};

  // Build registration profile map
  var regMap = {};
  if (Array.isArray(LB_REG)) {
    LB_REG.forEach(function(r) {
      regMap[String(r.strava_athlete_id)] = r;
    });
  }

  var filteredFeed = [];
  var milestoneGroups = {};

  _feedData.forEach(function(item) {
    // 1. Private profile filter
    var targetAthleteId = item.tagged_athlete_id || '';
    if (!targetAthleteId && item.type === 'activity') {
      try {
        var tempAct = JSON.parse(item.body);
        targetAthleteId = tempAct.athlete_id || '';
      } catch(e) {}
    }
    targetAthleteId = String(targetAthleteId);
    
    if (rules.allow_private_profiles !== false) {
      var athReg = regMap[targetAthleteId];
      if (athReg && (athReg.is_private === true || athReg.is_private === 'true')) {
        return; // Exclude private profiles
      }
    }

    if (item.type === 'activity') {
      // 2. Allow standard activities rule
      if (rules.allow_standard_activities === false) return;

      var act = {};
      try { act = JSON.parse(item.body); } catch(e) {}

      // 3. Allow flagged activities rule
      if (act.is_flagged && rules.allow_flagged_activities !== true) return;

      // 4. Minimum activity distance filter
      var distKm = (act.distance_meters || 0) / 1000;
      var minDist = parseFloat(filters.minimum_activity_distance_km !== undefined ? filters.minimum_activity_distance_km : 1.0);
      if (distKm < minDist) return;

      // 5. Allowed sport types filter
      var allowedSports = filters.allowed_sports || ["Walk", "Run", "Hike", "Ride"];
      var sport = act.sport_type || '';
      if (allowedSports.indexOf(sport) === -1) return;

      filteredFeed.push(item);

    } else if (item.type === 'milestone') {
      var title = (item.title || '').toLowerCase();
      
      // 6. Allow medals rule
      var isMedal = title.indexOf('medal') > -1 || title.indexOf('bronze') > -1 || title.indexOf('silver') > -1 || title.indexOf('gold') > -1;
      if (isMedal && rules.allow_medals === false) return;

      // 7. Allow distance clubs rule
      var isClub = title.indexOf('club') > -1 || title.indexOf('km') > -1;
      if (isClub && rules.allow_distance_clubs === false) return;

      // 8. Allow rank top1 rule
      var isRank = title.indexOf('#1') > -1 || title.indexOf('rank 1') > -1 || title.indexOf('first rank') > -1 || title.indexOf('leading') > -1;
      if (isRank && rules.allow_rank_top1 === false) return;

      // Deduplicate milestone groups by athlete + date
      var athleteId = item.tagged_athlete_id || 'unknown';
      var dateStr = getISTDate(item.created_at);
      var key = athleteId + '_' + dateStr;
      var w = getMilestoneWeight(item.title);
      
      if (!milestoneGroups[key]) {
        milestoneGroups[key] = { item: item, weight: w };
      } else {
        if (w > milestoneGroups[key].weight) {
          milestoneGroups[key] = { item: item, weight: w };
        }
      }
    } else {
      // Allow custom announcements
      filteredFeed.push(item);
    }
  });

  // Push deduplicated milestones
  Object.keys(milestoneGroups).forEach(function(key) {
    filteredFeed.push(milestoneGroups[key].item);
  });

  // 9. Chronological and priority tie-breaker sorting
  if (rules.priority_feed_sorting !== false) {
    filteredFeed.sort(function(a, b) {
      var dateA = new Date(a.created_at);
      var dateB = new Date(b.created_at);
      if (Math.abs(dateA - dateB) < 1000) {
        var prioA = getFeedItemPriority(a);
        var prioB = getFeedItemPriority(b);
        return prioB - prioA;
      }
      return dateB - dateA;
    });
  } else {
    filteredFeed.sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  var visibleItems = filteredFeed.slice(0, _feedVisibleCount);
  var html = '';

  var myId = currentSession ? String(currentSession.athleteId) : '';

  visibleItems.forEach(function(item) {
    var dateLabel = timeAgo(item.created_at);
    var initials = '';
    var athleteName = 'Participant';

    var reactionButtonsHtml = '';
    var reactionsList = [
      { type: 'like', iconReg: 'fa-regular fa-thumbs-up', iconActive: 'fa-solid fa-thumbs-up' },
      { type: 'heart', iconReg: 'fa-regular fa-heart', iconActive: 'fa-solid fa-heart' }
    ];

    reactionsList.forEach(function(emo) {
      var count = (item.reaction_counts && item.reaction_counts[emo.type]) || 0;
      var displayCount = count > 0 ? count : '0';
      var isActive = (item.my_reactions && item.my_reactions.indexOf(emo.type) > -1);
      var activeClass = isActive ? 'active' : '';
      var iconClass = isActive ? emo.iconActive : emo.iconReg;
      reactionButtonsHtml += `<button class="feed-react-btn ${activeClass} type-${emo.type}" data-ann-id="${item.id}" data-react-type="${emo.type}" data-icon-reg="${emo.iconReg}" data-icon-active="${emo.iconActive}" onclick="reactToAnnouncement('${item.id}', '${emo.type}', event, this)"><i class="${iconClass} reaction-fa"></i><span class="count">${displayCount}</span></button>`;
    });

    var avatarPileHtml = '';
    if (Array.isArray(item.reactions_detail) && item.reactions_detail.length > 0) {
      var maxAvatars = 3;
      var totalReactions = item.reactions_detail.length;
      var avatarsHtml = '';
      var shownReactions = item.reactions_detail.slice(0, maxAvatars);
      
      shownReactions.forEach(function(r, index) {
        var pName = (r.name && r.name !== 'Participant') ? r.name : (regMap[r.athlete_id] ? regMap[r.athlete_id].full_name : 'Participant');
        var uInitials = (function(){
          var parts = (pName || '').trim().split(/\s+/);
          if(parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
          return (parts[0] || '?')[0].toUpperCase();
        })();
        
        var customStyle = getAvatarStyle(pName);
        var style = `width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:700; border:1px solid; margin-left: ${index > 0 ? '-6px' : '0'}; z-index: ${10 - index}; transition: transform 0.2s; ${customStyle}`;
        avatarsHtml += `<div style="${style}">${uInitials}</div>`;
      });
      
      var plusLabel = '';
      if (totalReactions > maxAvatars) {
        plusLabel = `<span style="font-size:11px; font-weight:600; color:var(--muted); margin-left:6px;">+${totalReactions - maxAvatars}</span>`;
      }
      
      avatarPileHtml = `
        <div class="reactions-avatar-pile" style="display:flex; align-items:center; margin-left:auto; cursor:pointer;" onclick="openReactionsDetail('${item.id}'); event.stopPropagation();">
          <div style="display:flex; align-items:center;">${avatarsHtml}</div>
          ${plusLabel}
        </div>
      `;
    }

    var actionsHtml = `<div class="feed-card-actions" onclick="event.stopPropagation();">${reactionButtonsHtml}${avatarPileHtml}</div>`;

    if (item.type === 'activity') {
      var act = {};
      try { act = JSON.parse(item.body); } catch(e) {}
      athleteName = act.athlete_name || 'Participant';
      initials = (function(){var parts=(athleteName||'').trim().split(/\s+/);if(parts.length>=2)return(parts[0][0]+(parts[parts.length-1][0])).toUpperCase();return(parts[0]||'?')[0].toUpperCase();})();
      
      var timeStr = '', dateTimeStr = '';
      try {
        var adt = new Date(act.activity_date || item.created_at);
        if (!isNaN(adt.getTime())) {
          timeStr = adt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          dateTimeStr = adt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        }
      } catch(e) {}

      var distKm = ((act.distance_meters || 0) / 1000).toFixed(2);
      var paceStr = (act.distance_meters > 0 && act.moving_time_seconds > 0) ? fmtPS(act.distance_meters / act.moving_time_seconds, act.sport_type) : '—';
      var steps = Math.round((act.distance_meters / 1000) * 1350);
      var calculatedStepsDisplay = (act.steps && act.steps > 0) ? act.steps.toLocaleString('en-IN') : steps.toLocaleString('en-IN');
      var deviceText = act.device_name ? ' via ' + act.device_name : '';
      var sportIcon = act.sport_type ? renderIcon(act.sport_type) : '🌱';
      var descriptionHtml = act.description ? `<div class="feed-card-activity-desc">${esc(act.description)}</div>` : '';
      
      var mapHtml = '';
      if (act.summary_polyline) {
        var mapContainerId = 'map-' + item.id;
        _feedPolylines[mapContainerId] = act.summary_polyline;
        mapHtml = `<div class="feed-card-map-wrap" onclick="event.stopPropagation();" style="position: relative; margin: 12px 0 16px 0; height: 160px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.06); overflow: hidden; background: #0E1012;"><div id="${mapContainerId}" class="feed-map-container" style="width: 100%; height: 100%;"></div></div>`;
      }

      var appreciationHtml = '';
      var isSpecialAppreciation = false;
      var elevGain = parseFloat(act.elevation_gain || 0);
      if (act.sport_type === 'Walk' || act.sport_type === 'Run' || act.sport_type === 'VirtualRun' || act.sport_type === 'Hike') {
        var paceVal = (act.moving_time_seconds / 60) / (act.distance_meters / 1000);
        var customApps = [
          { cond: function() { return act.sport_type === 'Run' && paceVal < 5.0; }, emoji: '⚡', text: 'Lightning speed! Incredible run pace!' },
          { cond: function() { return act.distance_meters >= 21100; }, emoji: '🏅', text: 'Half marathon distance! Pure legend status!' },
          { cond: function() { return act.distance_meters >= 15000; }, emoji: '🔥', text: 'Super distance! Absolutely crushing it!' },
          { cond: function() { return act.distance_meters >= 10000; }, emoji: '🌟', text: 'Double digits! Outstanding distance effort!' },
          { cond: function() { return act.sport_type === 'Walk' && paceVal < 8.5; }, emoji: '🚶‍♂️💨', text: 'Power walking champion! Brisk pace!' }
        ];
        for (var cIdx = 0; cIdx < customApps.length; cIdx++) {
          if (customApps[cIdx].cond()) {
            appreciationHtml = `<div class="activity-appreciation-badge special"><span class="appreciation-icon">${customApps[cIdx].emoji}</span><span class="appreciation-text">${customApps[cIdx].text}</span></div>`;
            isSpecialAppreciation = true;
            break;
          }
        }
      }

      if (!isSpecialAppreciation && distKm > 0) {
        var actId = String(act.strava_activity_id || act.activity_id || item.created_at || 'act');
        var seed = athleteName + '_' + parseFloat(distKm).toFixed(2) + '_' + actId;
        var icon = '🌱';
        var pool = ["Wonderful active minutes! Keep this beautiful rhythm going.", "Every single step counts! Great job staying active today."];
        var hash = 0;
        for (var i = 0; i < seed.length; i++) {
          hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        var index = Math.abs(hash) % pool.length;
        var msg = pool[index];
        appreciationHtml = `<div class="activity-appreciation-badge"><span class="appreciation-icon">${icon}</span><span class="appreciation-text">"${msg}"</span></div>`;
      }

      var kudosInsightsHtml = '';
      if (appreciationHtml) {
        kudosInsightsHtml = `
          <div style="margin-top: 14px;">
            <div style="font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px;">Kudos Insights</div>
            ${appreciationHtml}
          </div>
        `;
      }

      var targetAthleteId = String(act.athlete_id || item.tagged_athlete_id || '');
      var timeHour = new Date(act.activity_date || item.created_at).getHours();
      var timeClass = (timeHour >= 5 && timeHour < 12) ? 'time-morning' : (timeHour >= 12 && timeHour < 17) ? 'time-afternoon' : (timeHour >= 17 && timeHour < 20) ? 'time-evening' : 'time-night';

      html += `
        <div class="feed-card type-activity ${timeClass}" onclick="openActivityDetail('${act.activity_id || act.strava_activity_id}', event, true)">
          <div class="feed-card-header">
            <div class="feed-card-avatar" style="${getAvatarStyle(athleteName)};">${initials}</div>
            <div class="feed-card-meta">
              <div class="feed-card-athlete-name">
                <a href="#" onclick="openProfileDetail('${targetAthleteId}', event); event.stopPropagation(); return false;" class="athlete-profile-link">${esc(athleteName)}</a>
              </div>
              <div class="feed-card-time">${timeStr}${dateTimeStr ? ' &middot; ' + dateTimeStr : ''}${deviceText}</div>
            </div>
          </div>
          <div class="feed-card-activity-info">
            <div class="feed-card-activity-title-row">
              <span class="sport-icon">${sportIcon}</span>
              <a href="#" onclick="openActivityDetail('${act.activity_id || act.strava_activity_id}', event, true); event.stopPropagation(); return false;" class="activity-detail-link">${esc(act.activity_name || 'Activity')}</a>
            </div>
            ${descriptionHtml}
            ${(function() {
              var statsCols = [];
              
              // 1. Distance (Always show)
              statsCols.push(`<div class="stat-item"><span class="stat-val">${distKm}</span><span class="stat-unit">km</span></div>`);

              // 2. Pace (if allowed from Feed-config)
              var showPace = rules.smart_pace_filter !== false;
              if (showPace) {
                var paceVal = paceStr, paceUnit = 'pace';
                if (paceStr.indexOf('/') > -1) {
                  var parts = paceStr.split('/');
                  paceVal = parts[0];
                  paceUnit = '/' + parts[1];
                } else if (paceStr.indexOf(' ') > -1) {
                  var parts = paceStr.split(' ');
                  paceVal = parts[0];
                  paceUnit = parts[1];
                }
                statsCols.push(`<div class="stat-item"><span class="stat-val">${paceVal}</span><span class="stat-unit">${paceUnit}</span></div>`);
              }

              // 3. Moving Time (Always show)
              statsCols.push(`<div class="stat-item"><span class="stat-val">${fmtDur(act.moving_time_seconds || 0)}</span><span class="stat-unit">Time</span></div>`);

              // 4. Steps (Calculated - if allowed from Feed-config)
              var showSteps = rules.show_steps !== false;
              if (showSteps) {
                statsCols.push(`<div class="stat-item"><span class="stat-val">${calculatedStepsDisplay}</span><span class="stat-unit">Steps</span></div>`);
              }

              // 5. Elevation (if allowed from Feed-config)
              var showElevation = rules.show_elevation !== false;
              if (showElevation && elevGain > 0) {
                statsCols.push(`<div class="stat-item"><span class="stat-val">${Math.round(elevGain)}</span><span class="stat-unit">m</span></div>`);
              }

              var gridStyle = 'grid-template-columns: repeat(' + statsCols.length + ', 1fr);';
              return '<div class="feed-card-stats-grid" style="' + gridStyle + '">' + statsCols.join('') + '</div>';
            })()}
            ${mapHtml}
            ${kudosInsightsHtml}
          </div>
          ${actionsHtml}
        </div>
      `;
    } else {
      var iconHtml = '';
      if (item.type === 'milestone') {
        iconHtml = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>';
      } else if (item.type === 'broadcast') {
        iconHtml = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
      }

      var bodyHtml = item.body ? `<div class="feed-card-body">${formatMarkdown(item.body)}</div>` : '';
      var targetAthleteId = String(item.tagged_athlete_id || '');
      var athleteReg = regMap[targetAthleteId];
      var athleteName = athleteReg ? athleteReg.full_name : 'Participant';
      
      var nameHtml = '';
      var titleHtml = '';
      var cardOnclick = '';
      if (item.type === 'broadcast') {
        athleteName = item.title;
        nameHtml = `<span class="athlete-profile-static" style="color:#fff; font-weight:700; font-size:15px; line-height:1.3; display:block;">${esc(athleteName)}</span>`;
        titleHtml = '';
        cardOnclick = 'event.stopPropagation();';
      } else {
        nameHtml = `<a href="#" onclick="openProfileDetail('${targetAthleteId}', event); event.stopPropagation(); return false;" class="athlete-profile-link">${esc(athleteName)}</a>`;
        titleHtml = `<div class="feed-card-title" style="font-size: 13px; font-weight: 700; color: var(--brand); margin-top: 2px;">${esc(item.title)}</div>`;
        cardOnclick = `openProfileDetail('${targetAthleteId}', event)`;
      }

      html += `
        <div class="feed-card type-${item.type}" onclick="${cardOnclick}">
          <div class="feed-card-header">
            <div class="feed-card-icon">${iconHtml}</div>
            <div class="feed-card-meta">
              <div class="feed-card-athlete-name">
                ${nameHtml}
              </div>
              ${titleHtml}
              <div class="feed-card-time">${dateLabel}</div>
            </div>
          </div>
          ${bodyHtml}
          ${actionsHtml}
        </div>
      `;
    }
  });

  if (filteredFeed.length > _feedVisibleCount) {
    html += '<div id="feed-sentinel" class="feed-spinner-wrap"><div class="feed-infinite-spinner"></div></div>';
  } else if (filteredFeed.length > 0) {
    html += '<div style="text-align:center; padding:24px 0 32px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:1px; opacity:0.5;">✨ YOU\'RE ALL CAUGHT UP</div>';
  }
  list.innerHTML = html;
  initFeedMaps();
}

function showMoreAnnouncements() {
  _feedVisibleCount += 30;
  renderFeed();
}

async function reactToAnnouncement(announcementId, reactionType, event, btnElement) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  var athleteId = currentSession ? currentSession.athleteId : '';
  if (!athleteId || athleteId === 'null' || athleteId === 'undefined') {
    alert('⚠️ Please connect your Strava account first.');
    return;
  }

  var item = _feedData.find(function(x) { return String(x.id) === String(announcementId); });
  if (item) {
    if (!Array.isArray(item.my_reactions)) item.my_reactions = [];
    if (!item.reaction_counts || typeof item.reaction_counts !== 'object') item.reaction_counts = {};
    
    var idx = item.my_reactions.indexOf(reactionType);
    var btn = btnElement || ((event && event.target) ? event.target.closest('button.feed-react-btn') : null);
    if (!btn) btn = document.querySelector('button[data-ann-id="' + announcementId + '"][data-react-type="' + reactionType + '"]');
    
    var faIcon = btn ? btn.querySelector('.reaction-fa') : null;
    var regClass = btn ? btn.getAttribute('data-icon-reg') : '';
    var activeClass = btn ? btn.getAttribute('data-icon-active') : '';

    if (idx > -1) {
      item.my_reactions.splice(idx, 1);
      if (item.reaction_counts[reactionType] > 0) item.reaction_counts[reactionType]--;
      
      // Update DOM directly (Optimistic)
      if (btn) {
        btn.classList.remove('active');
        if (faIcon && regClass) faIcon.className = regClass + ' reaction-fa';
        var cntEl = btn.querySelector('.count');
        if (cntEl) {
          var curr = parseInt(cntEl.textContent, 10) || 0;
          var nextVal = Math.max(0, curr - 1);
          cntEl.textContent = nextVal;
        }
      }
    } else {
      var clickX = 0, clickY = 0;
      if (event) {
        if (event.clientX && event.clientY) {
          clickX = event.clientX;
          clickY = event.clientY;
        } else {
          var target = event.currentTarget || event.target;
          if (target && typeof target.getBoundingClientRect === 'function') {
            var rect = target.getBoundingClientRect();
            clickX = rect.left + rect.width / 2;
            clickY = rect.top + rect.height / 2;
          }
        }
      }
      if (clickX && clickY) {
        var emoji = (reactionType === 'heart') ? '❤️' : '👍';
        triggerReactionConfetti(clickX, clickY, emoji);
      }
      
      item.my_reactions.push(reactionType);
      item.reaction_counts[reactionType] = (item.reaction_counts[reactionType] || 0) + 1;
      
      // Update DOM directly (Optimistic)
      if (btn) {
        btn.classList.add('active');
        if (faIcon && activeClass) faIcon.className = activeClass + ' reaction-fa';
        var cntEl = btn.querySelector('.count');
        if (cntEl) {
          var curr = parseInt(cntEl.textContent, 10) || 0;
          cntEl.textContent = curr + 1;
        }
      }
    }
  }

  try {
    var res = await fetch(BACKEND + '/announcements/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        announcement_id: announcementId,
        athlete_id: String(athleteId),
        reaction_type: reactionType
      })
    });
    var d = await res.json();
    
    // Sync local _feedData with database confirmed state
    if (item) {
      if (!item.my_reactions) item.my_reactions = [];
      if (d.success) {
        if (d.action === 'added') {
          if (item.my_reactions.indexOf(reactionType) === -1) item.my_reactions.push(reactionType);
        } else {
          var rIdx = item.my_reactions.indexOf(reactionType);
          if (rIdx > -1) item.my_reactions.splice(rIdx, 1);
        }
        if (!item.reaction_counts) item.reaction_counts = {};
        item.reaction_counts[reactionType] = d.count;
      }
    }

    if (d.success) {
      // Create in-app notification for activity owner
      if (d.action === 'added' && item) {
        var ownerAthleteId = item.tagged_athlete_id || '';
        if (ownerAthleteId && String(ownerAthleteId) !== String(athleteId)) {
          var myName = currentSession ? (currentSession.name || currentSession.firstName || 'A teammate') : 'A teammate';
          var actName = '';
          try { actName = JSON.parse(item.body).activity_name || item.title || ''; } catch(e) { actName = item.title || ''; }
          fetch(BACKEND + '/notifications/create', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ recipient_athlete_id: String(ownerAthleteId), sender_athlete_id: String(athleteId), sender_name: myName, announcement_id: String(announcementId), activity_name: actName, type: reactionType })
          }).catch(function(){});
        }
      }
      var confirmedBtn = document.querySelector('button[data-ann-id="' + announcementId + '"][data-react-type="' + reactionType + '"]');
      if (confirmedBtn) {
        var cntEl = confirmedBtn.querySelector('.count');
        if (cntEl) cntEl.textContent = d.count;
        
        var faIcon = confirmedBtn.querySelector('.reaction-fa');
        var regClass = confirmedBtn.getAttribute('data-icon-reg');
        var activeClass = confirmedBtn.getAttribute('data-icon-active');

        if (d.action === 'added') {
          confirmedBtn.classList.add('active');
          if (faIcon && activeClass) faIcon.className = activeClass + ' reaction-fa';
        } else {
          confirmedBtn.classList.remove('active');
          if (faIcon && regClass) faIcon.className = regClass + ' reaction-fa';
        }
      }
    } else {
      console.warn('React API unsuccessful:', d.error);
      renderFeed();
    }
  } catch(err) {
    console.warn('React API error — reverting:', err);
    if (item) {
      var revertIdx = item.my_reactions ? item.my_reactions.indexOf(reactionType) : -1;
      if (revertIdx > -1) {
        item.my_reactions.splice(revertIdx, 1);
        if (item.reaction_counts) item.reaction_counts[reactionType] = Math.max(0, (item.reaction_counts[reactionType] || 1) - 1);
      }
    }
    renderFeed();
  }
}


function triggerReactionConfetti(x, y, emoji) {
  if (typeof confetti === 'function') {
    try {
      var options = {
        particleCount: 20,
        spread: 40,
        origin: { x: x / window.innerWidth, y: y / window.innerHeight },
        colors: ['#E8622A', '#FC6100', '#FFD000'],
        ticks: 120
      };
      confetti(options);
    } catch (e) {
      console.warn("Reaction confetti error:", e);
    }
  }
}

// ── In-App Notifications Banner Logic ──────────────────────────────
var _activeInsight = null;
var _activeRecovery = null;

function renderInAppNotificationBanner(title, body, onClick, key, onClose, type) {
  var onDismissStr = onClose ? 'onClose()' : 'dismissInAppBanner(event)';
  var cardClass = type ? 'banner-card type-' + type : 'banner-card';
  var iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  if (type === 'broadcast') {
    iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
  }
  return `
    <div class="${cardClass}" onclick="${onClick}" style="cursor: ${onClick ? 'pointer' : 'default'};">
      <button class="banner-dismiss-btn" onclick="${onDismissStr}" title="Dismiss">✕</button>
      <div class="banner-icon">${iconSvg}</div>
      <div class="banner-content">
        <div class="banner-title">${esc(title)}</div>
        <div class="banner-body">${esc(body)}</div>
      </div>
    </div>
  `;
}

function dismissInAppBanner(e) {
  if (e) e.stopPropagation();
  var banner = document.getElementById('inapp-notification-banner');
  if (!banner) return;
  var key = banner.getAttribute('data-banner-key');
  if (key) {
    var dismissed = JSON.parse(safeGetItem('ag_dismissed_banners') || '{}');
    dismissed[key] = true;
    safeSetItem('ag_dismissed_banners', JSON.stringify(dismissed));
  }
  banner.style.display = 'none';
}

function updateInAppNotificationBanner() {
  var banner = document.getElementById('inapp-notification-banner');
  if (!banner) return;

  var dismissed = JSON.parse(safeGetItem('ag_dismissed_banners') || '{}');

  // Priority 1: Strava Connect Prompt
  if (window.isStravaConnected === false) {
    var scKey = 'strava_connect_prompt';
    if (!dismissed[scKey]) {
      var html = '<div class="banner-card type-warning" style="cursor: pointer; border-left: 4px solid #FC6100;" onclick="window.handleStravaConnect(event)">' +
        '<button class="banner-dismiss-btn" onclick="dismissInAppBanner(event)" title="Dismiss">✕</button>' +
        '<div class="banner-icon" style="color:#FC6100;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
        '<div class="banner-content">' +
        '<div class="banner-title" style="color:#fff;">Strava Account Disconnected</div>' +
        '<div class="banner-body" style="font-size:12px; color:rgba(255,255,255,0.75); margin-top:4px; line-height:1.4;">Your account is not connected yet. Click here to link Strava and sync your walks/runs automatically.</div>' +
        '</div>' +
        '</div>';
      banner.setAttribute('data-banner-key', scKey);
      banner.innerHTML = html;
      banner.style.display = 'block';
      return;
    }
  }

  // Priority 2: Broadcast message from admin
  if (typeof _feedData !== 'undefined' && _feedData && _feedData.length > 0) {
    var latestBroadcast = _feedData.find(function(item) { return item.type === 'broadcast'; });
    if (latestBroadcast) {
      var bcKey = 'broadcast_' + latestBroadcast.id;
      if (!dismissed[bcKey]) {
        var html = renderInAppNotificationBanner(
          latestBroadcast.title || 'Walkathon Update',
          latestBroadcast.body,
          'showTab(\'feed\')', bcKey, null, 'broadcast'
        );
        banner.setAttribute('data-banner-key', bcKey);
        banner.innerHTML = html;
        banner.style.display = 'block';
        return;
      }
    }
  }

  // Priority 3: Recovery insights
  if (_activeRecovery) {
    var recKey = _activeRecovery.key;
    if (!dismissed[recKey]) {
      var html = renderInAppNotificationBanner(
        _activeRecovery.title,
        _activeRecovery.sub,
        'showTab(\'you\')', recKey, null, 'recovery'
      );
      banner.setAttribute('data-banner-key', recKey);
      banner.innerHTML = html;
      banner.style.display = 'block';
      return;
    }
  }

  // Priority 4: Daily Milestones or Medal insights
  if (_activeInsight) {
    var iKey = _activeInsight.key;
    if (!dismissed[iKey]) {
      var html = renderInAppNotificationBanner(
        _activeInsight.title,
        _activeInsight.body,
        null, iKey, null, 'insight'
      );
      banner.setAttribute('data-banner-key', iKey);
      banner.innerHTML = html;
      banner.style.display = 'block';
      return;
    }
  }

  banner.style.display = 'none';
  banner.innerHTML = '';
  banner.removeAttribute('data-banner-key');
}

function timeAgo(dateString) {
  try {
    var now = new Date();
    var past = new Date(dateString);
    var diffMs = now - past;
    var diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    var diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    var diffDays = Math.floor(diffHrs / 24);
    if (diffDays === 1) return 'Yesterday';
    return diffDays + 'd ago';
  } catch(e) {
    return '';
  }
}

function openNotificationItem(n) {
  // Mark as read
  if (!n.is_read) {
    fetch(BACKEND + '/notifications/read', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:n.id}) }).catch(function(){});
    // Update local state
    var local = _notificationsList.find(function(x){ return x.id === n.id; });
    if (local) local.is_read = true;
    renderNotifications();
  }
  // Close dropdown
  var dropdown = document.getElementById('notification-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  // Navigate to feed tab + highlight the post
  if (n.url && n.url.startsWith('feed:')) {
    var annId = n.url.split(':')[1];
    showTab('feed');
    setTimeout(function() {
      var btn = document.querySelector('button[data-ann-id="' + annId + '"]');
      var card = btn ? btn.closest('.feed-card') : null;
      if (card) {
        card.scrollIntoView({ behavior:'smooth', block:'center' });
        card.style.transition = 'box-shadow 0.4s ease';
        card.style.boxShadow = '0 0 0 2px var(--brand)';
        setTimeout(function(){ card.style.boxShadow = ''; }, 2200);
      }
    }, 320);
  }
}

function renderNotifications() {
  var badge = document.getElementById('notification-badge');
  var list = document.getElementById('notif-list');
  var empty = document.getElementById('notif-empty');
  
  if (!list || !empty) return;

  var unreadCount = _notificationsList.filter(function(n) { return !n.is_read; }).length;
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!_notificationsList.length) {
    list.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'block';
  list.innerHTML = '';

  _notificationsList.forEach(function(n) {
    var card = document.createElement('div');
    card.className = 'notif-item' + (n.is_read ? ' read' : '');
    
    var icon = '📢';
    if (n.type === 'challenge') icon = '🎯';
    if (n.type === 'medal') icon = '🏆';
    if (n.type === 'kudos') icon = '👏';
    if (n.type === 'comment') icon = '💬';
    if (n.type === 'like') icon = '👍';
    if (n.type === 'heart') icon = '❤️';

    var notifBody = '';
    if (n.body) { try { var bd = JSON.parse(n.body); notifBody = ''; } catch(e) { notifBody = n.body; } }

    var clickHandler = '';
    var isFeedNotif = n.url && n.url.startsWith('feed:');
    if (isFeedNotif) {
      var _nid = n.id; var _nref = n;
      clickHandler = 'openNotificationItem(' + JSON.stringify(n).replace(/"/g, '&quot;') + ')';
    } else if (n.url === 'connect_strava') {
      clickHandler = 'window.handleStravaConnect(event);';
    } else if (n.url) {
      clickHandler = 'if(\'' + n.url + '\' && \'' + n.url + '\' !== \'null\') { window.location.href=\'' + n.url + '\'; }';
    }

    card.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer;" onclick="${clickHandler}">
        <div style="font-size: 20px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.04); border-radius: 50%;">${icon}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13.5px; font-weight: 700; color: #fff; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(n.title)}</div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 3px; line-height: 1.4;">${notifBody ? esc(notifBody) : ''}</div>
          <div style="font-size: 10px; color: var(--brand); font-weight: 700; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.5px;">${timeAgo(n.created_at)}</div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });
}

function switchYouTab(tab) {
  var info = document.getElementById('you-panel-info');
  var chal = document.getElementById('you-panel-challenges');
  var btnInfo = document.getElementById('you-tab-info');
  var btnChal = document.getElementById('you-tab-challenges');
  if (info) info.style.display = (tab === 'info') ? 'block' : 'none';
  if (chal) chal.style.display = (tab === 'challenges') ? 'block' : 'none';
  if (btnInfo) btnInfo.classList.toggle('active', tab === 'info');
  if (btnChal) btnChal.classList.toggle('active', tab === 'challenges');
}

function clearPWACache(btn) {
  if (btn) {
    btn.style.color = '#10b981';
    btn.style.transform = 'scale(1.15)';
    btn.style.transition = 'all 0.2s ease';
  }

  if (currentSession && currentSession.athleteId) {
    cacheClear(currentSession.athleteId);
  }

  var reloadPage = function() {
    window.location.reload();
  };

  if ('serviceWorker' in navigator) {
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) { return caches.delete(name); }));
    }).then(function() {
      setTimeout(reloadPage, 800);
    }).catch(function() {
      setTimeout(reloadPage, 800);
    });
  } else {
    setTimeout(reloadPage, 800);
  }
}

// ── Service Worker & Push Notifications ──────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/agwalk/sw.js')
      .then(function(reg) { 
        console.log('[SW] Registered:', reg.scope); 
        setTimeout(checkPushSubscriptionState, 1000);
      })
      .catch(function(err) { console.log('[SW] Registration failed:', err); });
  });
}

var VAPID_PUBLIC_KEY = 'BCXhOjvYOgNOGoge2s5bxkEj9DVxYnUsjDHbP8GR4PKDmtMKAJ4zkLWK2KvvRIRvMKfSpsC1cDGivtXsMRbNkYI';

function urlBase64ToUint8Array(base64String) {
  var cleanStr = base64String.trim();
  var padding = '='.repeat((4 - cleanStr.length % 4) % 4);
  var base64 = (cleanStr + padding).replace(/\-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function checkPushSubscriptionState() {
  window.checkPushSubscriptionState = checkPushSubscriptionState;
  var card = document.getElementById('push-notifications-card');
  var desc = document.getElementById('push-status-desc');
  var btn = document.getElementById('btn-enable-push');
  
  if (!card || !desc || !btn) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    card.style.display = 'none';
    return;
  }

  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    
    card.style.display = 'flex';
    
    if (Notification.permission === 'denied') {
      desc.innerHTML = '<span style="color:#ef4444;">❌ Notifications blocked.</span> Please enable notifications in your browser settings to receive alerts.';
      btn.textContent = 'Blocked in Settings';
      btn.style.background = 'rgba(255,255,255,0.06)';
      btn.style.color = 'var(--muted)';
      btn.style.pointerEvents = 'none';
      btn.style.boxShadow = 'none';
      return;
    }

    if (sub) {
      desc.innerHTML = '<span style="color:#10b981;">✓ Push notifications active.</span> You will receive real-time updates when peers react, achievements unlock, and challenges start.';
      btn.textContent = 'Active';
      btn.style.background = 'rgba(16, 185, 129, 0.12)';
      btn.style.border = '1px solid rgba(16, 185, 129, 0.25)';
      btn.style.color = '#10B981';
      btn.style.pointerEvents = 'auto';
      btn.style.boxShadow = 'none';
      btn.onclick = disablePushNotifications;
    } else {
      desc.innerHTML = 'Stay updated. Enable push notifications to receive real-time alerts when medals unlock, challenges trigger, and comments/reactions land.';
      btn.textContent = 'Enable';
      btn.style.background = 'var(--brand)';
      btn.style.border = 'none';
      btn.style.color = '#fff';
      btn.style.pointerEvents = 'auto';
      btn.style.boxShadow = '0 4px 12px rgba(232,98,42,0.3)';
      btn.onclick = enablePushNotifications;
    }
  } catch (err) {
    console.warn('Failed checking push subscription state:', err);
  }
}

async function enablePushNotifications() {
  var btn = document.getElementById('btn-enable-push');
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';
    btn.textContent = 'Enabling...';
  }

  try {
    var permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission denied');
    }

    var reg = await navigator.serviceWorker.ready;
    
    // Dynamically fetch VAPID public key from backend
    var vapidKey = VAPID_PUBLIC_KEY;
    try {
      var keyRes = await fetch(BACKEND + '/push/vapid-key');
      var keyJson = await keyRes.json();
      if (keyJson && keyJson.publicKey) {
        vapidKey = keyJson.publicKey;
        console.log('[Push] Fetched dynamic VAPID key:', vapidKey);
      }
    } catch (e) {
      console.warn('[Push] Dynamic VAPID fetch failed, using fallback:', e);
    }
    
    var convertedVapidKey = urlBase64ToUint8Array(vapidKey);
    var sub;
    try {
      console.log('[Push] Attempting subscription with Uint8Array key');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    } catch (subErr) {
      console.warn('[Push] Uint8Array subscribe failed, retrying with ArrayBuffer:', subErr);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey.buffer
      });
    }

    var athleteId = currentSession ? currentSession.athleteId : '';
    if (!athleteId) {
      throw new Error('Active session not found. Please log in again.');
    }

    var res = await fetch(BACKEND + '/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        athlete_id: athleteId,
        subscription: sub,
        device_name: getDeviceName()
      })
    });
    var d = await res.json();
    if (d.success) {
      console.log('Successfully subscribed to Push Notifications.');
    } else {
      throw new Error(d.error || 'Subscription backend sync failed');
    }
  } catch (err) {
    console.warn('Failed to subscribe:', err);
    alert('❌ Push activation failed: ' + err.message);
  } finally {
    if (btn) btn.style.opacity = '1';
    checkPushSubscriptionState();
  }
}

function getDeviceName() {
  var ua = navigator.userAgent || '';
  var device = 'Web Browser';
  if (/android/i.test(ua)) {
    device = 'Android';
    if (/chrome/i.test(ua)) device = 'Android (Chrome)';
    else if (/firefox/i.test(ua)) device = 'Android (Firefox)';
  } else if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
    device = 'iPhone/iPad';
    if (/crios/i.test(ua)) device = 'iOS (Chrome)';
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) device = 'iOS (Safari)';
  } else if (/macintosh|mac os x/i.test(ua)) {
    device = 'Mac';
    if (/safari/i.test(ua) && !/chrome/i.test(ua)) device = 'Mac (Safari)';
    else if (/chrome/i.test(ua)) device = 'Mac (Chrome)';
  } else if (/windows/i.test(ua)) {
    device = 'Windows PC';
    if (/edge/i.test(ua)) device = 'Windows (Edge)';
    else if (/chrome/i.test(ua)) device = 'Windows (Chrome)';
    else if (/firefox/i.test(ua)) device = 'Windows (Firefox)';
  }
  var isPWA = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isPWA) device += ' (PWA)';
  return device;
}

async function disablePushNotifications() {
  var btn = document.getElementById('btn-enable-push');
  if (btn) {
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.7';
    btn.textContent = 'Disabling...';
  }

  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub) {
      var athleteId = currentSession ? currentSession.athleteId : '';
      if (athleteId) {
        await fetch(BACKEND + '/push/subscribers/' + athleteId, {
          method: 'DELETE'
        });
      }
      await sub.unsubscribe();
      console.log('Successfully unsubscribed from Push.');
    }
  } catch (err) {
    console.warn('Failed to unsubscribe:', err);
  } finally {
    if (btn) btn.style.opacity = '1';
    checkPushSubscriptionState();
  }
}

function openStravaProfile(){
  try {
    var s = currentSession || JSON.parse(safeGetItem('wk_user')||'{}');
    var athleteId = s.athleteId;
    var reg = LB_ME || {};
    var url = reg.strava_profile_url || (athleteId ? 'https://www.strava.com/athletes/' + athleteId : 'https://www.strava.com');
    window.open(url, '_blank');
  } catch(e) {
    window.open('https://www.strava.com', '_blank');
  }
}

function toggleNotificationDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('notification-dropdown');
  if (!dd) return;
  var isVisible = dd.style.display === 'block';
  dd.style.display = isVisible ? 'none' : 'block';
}

async function clearNotifications(e) {
  if (e) e.stopPropagation();
  var badge = document.getElementById('notification-badge');
  if (badge) badge.style.display = 'none';
  var list = document.getElementById('notif-list');
  if (list) list.style.display = 'none';
  var empty = document.getElementById('notif-empty');
  if (empty) empty.style.display = 'block';

  _notificationsList = [];

  try {
    var session = JSON.parse(safeGetItem('wk_user') || '{}');
    var athleteId = session.athleteId;
    if (athleteId) {
      await fetch(BACKEND + '/notifications/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId })
      });
    }
  } catch (err) {
    console.warn('Failed to clear notifications:', err);
  }
}

document.addEventListener('click', function(e) {
  var dd = document.getElementById('notification-dropdown');
  var btn = document.getElementById('notification-btn');
  if (dd && dd.style.display === 'block') {
    if (!dd.contains(e.target) && !btn.contains(e.target)) {
      dd.style.display = 'none';
    }
  }
});

// Today's Date in Header
(function(){
  try{
    var d = new Date();
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var monthName = months[d.getMonth()];
    var day = d.getDate();
    var year = d.getFullYear();
    var formattedDate = monthName + ', ' + day + ', ' + year;
    var dateEl = document.getElementById('hdr-today-date');
    if(dateEl) dateEl.textContent = formattedDate;
  }catch(e){}
})();

// Boot Main Application
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', function() {
    load().finally(function(){ hideSplash(); });
  });
} else {
  load().finally(function(){ hideSplash(); });
}
function loadProfileTimeframe() {
  var sel = document.getElementById('prof-timeframe-select');
  var val = sel ? sel.value : 'month';
  var athleteId = _currentProfileAthleteId;
  if (!athleteId) return;
  openProfileDetail(athleteId, null);
}
var _currentProfileAthleteId = '';

function openReactionsDetail(announcementId) {
  var item = _feedData.find(function(x) { return String(x.id) === String(announcementId); });
  if (!item || !Array.isArray(item.reactions_detail) || !item.reactions_detail.length) return;

  var listContainer = document.getElementById('reactions-detail-list');
  if (!listContainer) return;

  var regMap = {};
  if (Array.isArray(LB_REG)) {
    LB_REG.forEach(function(r) {
      regMap[String(r.strava_athlete_id)] = r;
    });
  }

  listContainer.innerHTML = item.reactions_detail.map(function(r) {
    var iconClass = r.type === 'heart' ? 'fa-solid fa-heart' : 'fa-solid fa-thumbs-up';
    var iconColor = r.type === 'heart' ? '#ef4444' : '#3b82f6';
    
    var pName = (r.name && r.name !== 'Participant') ? r.name : (regMap[r.athlete_id] ? regMap[r.athlete_id].full_name : 'Participant');
    var initials = (function(){
      var parts = (pName || '').trim().split(/\s+/);
      if(parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
      return (parts[0] || '?')[0].toUpperCase();
    })();

    var customStyle = getAvatarStyle(pName);

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:12px 14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; border:1px solid; ${customStyle}">${initials}</div>
          <span style="font-size:14px; font-weight:700; color:#fff;">${esc(pName)}</span>
        </div>
        <div style="color:${iconColor}; font-size:16px;">
          <i class="${iconClass}"></i>
        </div>
      </div>
    `;
  }).join('');

  var modal = document.getElementById('reactions-detail-modal');
  if (modal) modal.classList.add('open');
}

function closeReactionsDetail() {
  var modal = document.getElementById('reactions-detail-modal');
  if (modal) modal.classList.remove('open');
}

// Premium Pull-to-Refresh & Infinite Scroll Controller
(function() {
  var startY = 0;
  var pullOffset = 0;
  var isPulling = false;
  var isRefreshing = false;
  var threshold = 75; // px
  
  var indicator = document.getElementById('pull-refresh-indicator');
  var circle = indicator ? indicator.querySelector('.pull-refresh-circle') : null;
  var spinnerCircle = indicator ? indicator.querySelector('.pull-refresh-spinner circle') : null;
  
  function getActiveScrollContainer() {
    return document.getElementById('tab-' + _currentTab);
  }
  
  function isAnyModalOpen() {
    var actModal = document.getElementById('activity-detail-modal');
    var profModal = document.getElementById('profile-detail-modal');
    var highModal = document.getElementById('highlight-detail-modal');
    var rxModal = document.getElementById('reactions-detail-modal');
    return (actModal && actModal.classList.contains('open')) ||
           (profModal && profModal.classList.contains('open')) ||
           (highModal && highModal.style.display === 'flex') ||
           (rxModal && rxModal.classList.contains('open'));
  }

  window.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1 || isRefreshing || isAnyModalOpen()) return;
    
    var container = getActiveScrollContainer();
    if (!container || container.scrollTop > 0) return;
    
    startY = e.touches[0].clientY;
    isPulling = true;
    
    if (indicator) {
      indicator.style.transition = 'none';
      indicator.classList.add('visible');
    }
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (!isPulling || e.touches.length !== 1 || isRefreshing) return;
    
    var currentY = e.touches[0].clientY;
    var deltaY = currentY - startY;
    
    if (deltaY <= 0) {
      pullOffset = 0;
      if (indicator) {
        indicator.style.transform = 'translate(-50%, -100px) scale(0.3)';
        indicator.classList.remove('visible');
      }
      return;
    }
    
    // Logarithmic spring physics
    pullOffset = Math.pow(deltaY, 0.82);
    if (pullOffset > 130) pullOffset = 130;
    
    var progress = Math.min(1, pullOffset / threshold);
    
    if (indicator) {
      var translateY = -100 + (pullOffset * 1.5);
      if (translateY > 40) translateY = 40; 
      
      var scale = 0.3 + (progress * 0.7);
      indicator.style.transform = 'translate(-50%, ' + translateY + 'px) scale(' + scale + ')';
      
      if (spinnerCircle) {
        var circumference = 62.8;
        var offset = circumference - (progress * circumference);
        spinnerCircle.style.strokeDashoffset = offset;
      }
      
      var spinner = indicator.querySelector('.pull-refresh-spinner');
      if (spinner) {
        spinner.style.transform = 'rotate(' + (pullOffset * 2.5) + 'deg)';
      }
      
      if (pullOffset >= threshold && !indicator._hasVibrated) {
        if (navigator.vibrate) navigator.vibrate(10);
        indicator._hasVibrated = true;
      } else if (pullOffset < threshold) {
        indicator._hasVibrated = false;
      }
    }
    
    var container = getActiveScrollContainer();
    if (container && container.scrollTop === 0 && e.cancelable) {
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener('touchend', function() {
    if (!isPulling) return;
    isPulling = false;
    
    if (indicator) {
      indicator._hasVibrated = false;
    }
    
    if (pullOffset >= threshold) {
      isRefreshing = true;
      pullOffset = 0;
      
      if (indicator) {
        indicator.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        indicator.style.transform = 'translate(-50%, 20px) scale(1)';
        indicator.classList.add('refreshing');
        if (spinnerCircle) {
          spinnerCircle.style.strokeDashoffset = 0;
        }
      }
      
      if (typeof load === 'function') {
        load(true).then(resetPullIndicator).catch(resetPullIndicator);
      } else {
        setTimeout(resetPullIndicator, 1500);
      }
    } else {
      resetPullIndicator();
    }
  }, { passive: true });

  function resetPullIndicator() {
    isRefreshing = false;
    pullOffset = 0;
    if (indicator) {
      indicator.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease';
      indicator.style.transform = 'translate(-50%, -100px) scale(0.3)';
      indicator.classList.remove('refreshing');
      setTimeout(function() {
        indicator.classList.remove('visible');
      }, 300);
    }
  }
  
  window.resetPullIndicator = resetPullIndicator;
  
  // --- IntersectionObserver Infinite Scroll ---
  var observer = null;
  var isObserving = false;
  
  function initInfiniteScrollObserver() {
    var sentinel = document.getElementById('feed-sentinel');
    if (!sentinel) return;
    
    if (observer) {
      observer.disconnect();
    }
    
    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting && !isPulling && !isRefreshing) {
          if (_feedData.length > _feedVisibleCount) {
            console.log('[InfiniteScroll] Loading next 30 items...');
            showMoreAnnouncements();
          }
        }
      });
    }, {
      root: document.getElementById('tab-feed'),
      rootMargin: '180px'
    });
    
    observer.observe(sentinel);
    isObserving = true;
  }
  
  var originalShowTab = window.showTab;
  if (typeof originalShowTab === 'function') {
    window.showTab = function(tabId) {
      originalShowTab(tabId);
      if (tabId === 'feed') {
        setTimeout(initInfiniteScrollObserver, 100);
      }
    };
  }
  
  function checkObserverStatus() {
    if (_currentTab === 'feed') {
      setTimeout(initInfiniteScrollObserver, 100);
    }
  }
  
  setTimeout(checkObserverStatus, 1000);
})();
