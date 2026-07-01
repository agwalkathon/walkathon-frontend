// Profile and Activity Details Modal Drawers

var _activeProfileStats = null;

function fmtEffortTime(s) {
  var min = Math.floor(s / 60);
  var sec = Math.round(s % 60);
  if (min > 0) {
    return min + ':' + (sec < 10 ? '0' : '') + sec;
  }
  return sec + 's';
}

var _activeStatsTimeframe = 'recent';
var _activeDetailMap = null;
var _detailMapTimeout = null;

function decodePolyline(str, precision) {
  var index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, precision || 5);
  while (index < str.length) {
    byte = null; shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change;
    shift = 0; result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

function openActivityDetail(id, event, isStravaId) {
  console.log('openActivityDetail called with id:', id, 'isStravaId:', isStravaId);
  if (!id || String(id) === 'undefined' || String(id) === 'null' || String(id).trim() === '') {
    console.warn('Invalid id passed to openActivityDetail:', id);
    return;
  }
  try {
    window._currentStravaActivityId = id;
    if (event && event.target && (event.target.closest('button') || event.target.closest('.feed-react-btn'))) {
      return;
    }
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();

    // Reset fields to loading placeholders
    document.getElementById('detail-top-date').innerText = 'Loading...';
    document.getElementById('detail-title').innerText = 'Loading...';
    document.getElementById('detail-started-info').innerText = '';
    // Show all wrap divs first so they appear during load, then hide if no data
    ['det-dist-wrap','det-pace-wrap','det-movetime-wrap','det-elapsed-wrap',
     'det-hr-wrap','det-maxhr-wrap','det-cadence-wrap','det-stravasteps-wrap',
     'det-calcsteps-wrap','det-elevation-wrap','det-calories-wrap','det-device-wrap'
    ].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = ''; }
    });
    ['det-dist','det-pace','det-movetime','det-elapsed','det-avghr','det-maxhr',
     'det-cadence','det-stravasteps','det-calcsteps','det-elevation','det-device','det-calories'
    ].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.innerText = '—';
    });
    document.getElementById('detail-desc-box').style.display = 'none';
    document.getElementById('detail-appreciation-box').innerHTML = '';
    
    // Hide best efforts and photos on load
    document.getElementById('detail-best-efforts-section').style.display = 'none';
    document.getElementById('detail-best-efforts-container').innerHTML = '';
    document.getElementById('detail-photos-section').style.display = 'none';
    document.getElementById('detail-photos-container').innerHTML = '';

    var modal = document.getElementById('activity-detail-modal');
    modal.style.display = 'block';
    setTimeout(function() {
      modal.classList.add('open');
    }, 10);

    function populateFromActivity(act, createdAtStr) {
      var athleteName = act.athlete_name || 'Participant';
      var sportType = act.sport_type || 'Walk';

      var topDateStr = 'Activity';
      try {
        var dt = new Date(createdAtStr || act.activity_date);
        if (!isNaN(dt.getTime())) {
          topDateStr = dt.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });
        }
      } catch (e) {}
      document.getElementById('detail-top-date').innerText = topDateStr;

      var actName = act.activity_name || (sportType + ' Activity');
      var sportIcon = renderIcon(sportType);
      document.getElementById('detail-title').innerHTML = `
        <div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span style="display:inline-flex; align-items:center; color:var(--brand);">${sportIcon}</span>
          <span style="font-weight:900; color:#fff;">${esc(actName)}</span>
        </div>
      `;

      var startedStr = '';
      try {
        var localDt = new Date(act.activity_date);
        if (!isNaN(localDt.getTime())) {
          var timeStr = localDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          var dateStr = localDt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          startedStr = esc(athleteName) + ' - Started at ' + timeStr + ' on ' + dateStr;
        }
      } catch (e) {}
      document.getElementById('detail-started-info').innerText = startedStr;

      // Helper: show/hide a field wrapper
      function setField(wrapId, valId, value) {
        var wrap = document.getElementById(wrapId);
        var el = document.getElementById(valId);
        var hasValue = value !== null && value !== undefined && value !== '' && value !== '—';
        if (wrap) wrap.style.display = hasValue ? '' : 'none';
        if (el && hasValue) el.innerText = value;
      }

      window._shareActivityData = act;
      var distanceKmVal = (act.distance_meters || 0) / 1000;
      // Distance — always show if > 0
      setField('det-dist-wrap', 'det-dist', distanceKmVal > 0 ? distanceKmVal.toFixed(2) + ' km' : null);

      var movingSec = act.moving_time_seconds || 0;
      var elapsedSec = act.elapsed_time_seconds || 0;

      // Moving time — show if > 0
      setField('det-movetime-wrap', 'det-movetime', movingSec > 0 ? fmtDur(movingSec) : null);

      // Elapsed time — always show if elapsedSec > 0
      setField('det-elapsed-wrap', 'det-elapsed', elapsedSec > 0 ? fmtDur(elapsedSec) : null);

      // Pace — show if calculable
      var paceValStr = null;
      if (distanceKmVal > 0 && movingSec > 0) {
        paceValStr = fmtPS((distanceKmVal * 1000) / movingSec, sportType);
      }
      setField('det-pace-wrap', 'det-pace', paceValStr);

      // Calculated steps — always show if distance > 0
      var calculatedSteps = Math.round(distanceKmVal * 1350);
      setField('det-calcsteps-wrap', 'det-calcsteps', distanceKmVal > 0 ? calculatedSteps.toLocaleString('en-IN') + ' steps' : null);

      // Strava steps — only if > 0
      var stravaStepsVal = act.steps || null;
      setField('det-stravasteps-wrap', 'det-stravasteps', (stravaStepsVal && stravaStepsVal > 0) ? stravaStepsVal.toLocaleString('en-IN') + ' steps' : null);

      // Elevation — show as 0 m if not set or 0
      var elevVal = act.elevation_gain || 0;
      setField('det-elevation-wrap', 'det-elevation', (elevVal !== null && elevVal !== undefined) ? Math.round(elevVal) + ' m' : '0 m');

      // Device — only if explicitly set in DB (not fallback)
      setField('det-device-wrap', 'det-device', act.device_name || null);

      // Heart rate — only if avg HR exists
      var avgHrVal = act.average_heartrate || null;
      var maxHrVal = act.max_heartrate || null;
      setField('det-hr-wrap', 'det-avghr', avgHrVal ? Math.round(avgHrVal) + ' bpm' : null);
      setField('det-maxhr-wrap', 'det-maxhr', maxHrVal ? Math.round(maxHrVal) + ' bpm' : null);

      // Cadence — only if exists
      var cadenceVal = act.average_cadence || null;
      setField('det-cadence-wrap', 'det-cadence', cadenceVal ? Math.round(cadenceVal * 2) + ' spm' : null);

      // Calories — only if exists
      var caloriesVal = act.calories || null;
      setField('det-calories-wrap', 'det-calories', caloriesVal ? Math.round(caloriesVal) + ' kcal' : null);

      var descBox = document.getElementById('detail-desc-box');
      if (act.description) {
        document.getElementById('detail-desc-text').innerText = act.description;
        descBox.style.display = 'block';
      } else {
        descBox.style.display = 'none';
      }

      // Best Efforts Grid rendering
      var bestEffSection = document.getElementById('detail-best-efforts-section');
      var bestEffContainer = document.getElementById('detail-best-efforts-container');
      bestEffSection.style.display = 'none';
      bestEffContainer.innerHTML = '';
      var bestEfforts = [];
      if (act.best_efforts) {
        try {
          bestEfforts = typeof act.best_efforts === 'string' ? JSON.parse(act.best_efforts) : act.best_efforts;
        } catch(e) {
          console.warn('Failed to parse best_efforts:', e);
        }
      }
      if (Array.isArray(bestEfforts) && bestEfforts.length > 0) {
        bestEffSection.style.display = 'block';
        var bestEffHtml = '';
        bestEfforts.forEach(function(effort) {
          var effortTime = effort.moving_time || 0;
          var formattedTime = fmtEffortTime(effortTime);
          bestEffHtml += `
            <div class="detail-field-item" style="text-align: center;">
              <div class="detail-field-label" style="font-size: 10px;">${esc(effort.name)}</div>
              <div class="detail-field-val" style="font-size: 15px; margin-top: 4px; color: var(--brand); font-weight: 800;">${formattedTime}</div>
            </div>
          `;
        });
        bestEffContainer.innerHTML = bestEffHtml;
      }

      // Photos Grid rendering
      var photosSection = document.getElementById('detail-photos-section');
      var photosContainer = document.getElementById('detail-photos-container');
      photosSection.style.display = 'none';
      photosContainer.innerHTML = '';
      var photosData = null;
      if (act.photos) {
        try {
          photosData = typeof act.photos === 'string' ? JSON.parse(act.photos) : act.photos;
        } catch(e) {
          console.warn('Failed to parse photos:', e);
        }
      }
      if (photosData && photosData.count > 0 && photosData.primary && photosData.primary.urls) {
        var urls = photosData.primary.urls;
        if (typeof urls === 'string') {
          try { urls = JSON.parse(urls); } catch(e) {}
        }
        var imgUrl = urls["600"] || urls["100"] || (typeof urls === 'object' ? Object.values(urls)[0] : null);
        if (imgUrl) {
          photosSection.style.display = 'block';
          photosContainer.innerHTML = `
            <div style="flex: 0 0 auto; width: 100%; max-width: 320px; scroll-snap-align: start; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); backdrop-filter: blur(10px);">
              <img src="${imgUrl}" style="width: 100%; height: 200px; object-fit: cover; display: block; cursor: pointer;" alt="Activity Photo" onclick="window.open('${imgUrl}', '_blank')" />
            </div>
          `;
        }
      }

      var appBox = document.getElementById('detail-appreciation-box');
      appBox.innerHTML = '';
      var isSpecialAppreciation = false;
      if (sportType === 'Walk' || sportType === 'Run' || sportType === 'VirtualRun' || sportType === 'Hike') {
        var durationMins = movingSec / 60;
        var pacePaceVal = distanceKmVal > 0 ? (durationMins / distanceKmVal) : 999;
        
        var customAppreciations = [
          { cond: function() { return sportType === 'Run' && pacePaceVal < 5.0; }, emoji: '⚡', text: 'Lightning speed! Incredible run pace!' },
          { cond: function() { return distanceKmVal >= 21.1; }, emoji: '🏅', text: 'Half marathon distance! Pure legend status!' },
          { cond: function() { return distanceKmVal >= 15.0; }, emoji: '🔥', text: 'Super distance! You\'re absolutely crushing it!' },
          { cond: function() { return distanceKmVal >= 10.0; }, emoji: '🌟', text: 'Double digits! Outstanding distance effort!' },
          { cond: function() { return sportType === 'Walk' && pacePaceVal < 8.5; }, emoji: '🚶‍♂️💨', text: 'Power walking champion! Very brisk pace!' }
        ];

        for (var cIdx = 0; cIdx < customAppreciations.length; cIdx++) {
          if (customAppreciations[cIdx].cond()) {
            var badgeHtml = `<div class="activity-appreciation-badge special"><span class="appreciation-icon">${customAppreciations[cIdx].emoji}</span><span class="appreciation-text">${customAppreciations[cIdx].text}</span></div>`;
            appBox.innerHTML = badgeHtml;
            isSpecialAppreciation = true;
            break;
          }
        }
      }

      if (!isSpecialAppreciation && distanceKmVal > 0) {
        var durationMins = movingSec / 60;
        var paceMinFloat = distanceKmVal > 0 ? (durationMins / distanceKmVal) : 999;
        var actId = String(act.strava_activity_id || act.activity_id || act.activity_date_time_ist || 'act');
        var seed = athleteName + '_' + distanceKmVal.toFixed(2) + '_' + actId;
        var icon = '🌱';
        var pool = ["Wonderful active minutes! Keep this beautiful rhythm going.", "Every single step counts! Great job staying active today."];
        
        var hash = 0;
        for (var i = 0; i < seed.length; i++) {
          hash = seed.charCodeAt(i) + ((hash << 5) - hash);
        }
        var index = Math.abs(hash) % pool.length;
        var msg = pool[index];
        appBox.innerHTML = `<div class="activity-appreciation-badge"><span class="appreciation-icon">${icon}</span><span class="appreciation-text">"${msg}"</span></div>`;
      }

      var mapWrap = document.getElementById('detail-map-container');
      if (act.summary_polyline) {
        mapWrap.style.display = 'block';
        mapWrap.innerHTML = '<div id="detail-map" style="width: 100%; height: 100%;"></div>';
        if (_activeDetailMap) {
          try { _activeDetailMap.remove(); } catch(e) {}
          _activeDetailMap = null;
        }
        if (_detailMapTimeout) {
          try { clearTimeout(_detailMapTimeout); } catch(e) {}
        }
        _detailMapTimeout = setTimeout(function() {
          try {
            var coordinates = decodePolyline(act.summary_polyline);
            if (coordinates && coordinates.length > 0) {
              _activeDetailMap = L.map('detail-map', {
                zoomControl: true,
                attributionControl: false
              }).setView(coordinates[0], 14);
              L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, className: 'app-map-tile' }).addTo(_activeDetailMap);
              var poly = L.polyline(coordinates, { color: 'var(--brand)', weight: 4, opacity: 0.9, lineJoin: 'round' }).addTo(_activeDetailMap);
              _activeDetailMap.fitBounds(poly.getBounds(), { padding: [20, 20] });
            }
          } catch (mapErr) {
            console.warn('Failed to draw detail map:', mapErr);
          }
        }, 400);
      } else {
        mapWrap.style.display = 'none';
      }

      var loggedInUser = null;
      try { loggedInUser = JSON.parse(localStorage.getItem('wk_user') || '{}'); } catch(e) {}
      var loggedInAthleteId = loggedInUser ? String(loggedInUser.athleteId) : '';
      var ownerAthleteId = String(act.strava_athlete_id || act.athlete_id || '');
      
      window._currentReportActivityId = act.id;
      window._currentReportOwnerId = ownerAthleteId;
      
      var reportSec = document.getElementById('detail-report-section');
      if (reportSec) {
        if (!loggedInAthleteId || loggedInAthleteId === ownerAthleteId) {
          reportSec.style.display = 'none';
        } else {
          reportSec.style.display = 'block';
          document.getElementById('report-form-container').style.display = 'none';
          document.getElementById('btn-report-activity').style.display = 'flex';
          document.getElementById('report-reason-select').value = '';
          document.getElementById('report-comments').value = '';
        }
      }
    }

    var stravaActId = id;
    if (!isStravaId) {
      var item = _feedData.find(function(x) { 
        if (String(x.id) === String(id)) return true;
        var act = {};
        try { act = JSON.parse(x.body); } catch(e) {}
        var actId = act.activity_id || act.strava_activity_id;
        return actId && String(actId) === String(id);
      });
      if (item) {
        var act = {};
        try { act = JSON.parse(item.body); } catch(e) {}
        stravaActId = act.activity_id || act.strava_activity_id;
        populateFromActivity(act, item.created_at);
      }
    }


    if (stravaActId) {
      var splitsSection = document.getElementById('detail-splits-section');
      var splitsTableContainer = document.getElementById('detail-splits-table-container');
      splitsSection.style.display = 'none';

      fetch(SUPABASE_URL + '/rest/v1/activity_splits?activity_id=eq.' + stravaActId + '&order=split_number.asc', { headers: HDR })
        .then(function(res) { return res.json(); })
        .then(function(splits) {
          if (splits && splits.length > 0) {
            splitsSection.style.display = 'block';
            var hasHR = splits.some(function(s) { return s.average_heartrate !== null && s.average_heartrate !== undefined && s.average_heartrate > 0; });
            var html = '<table class="splits-table"><thead><tr><th style="text-align:left;">Split #</th><th style="text-align:left;">Distance</th><th style="text-align:left;">Pace</th>' + (hasHR ? '<th style="text-align:left;">Avg HR</th>' : '') + '</tr></thead><tbody>';
            splits.forEach(function(s) {
              var sDist = ((s.distance_meters || 0) / 1000).toFixed(2) + ' km';
              var sPace = '--';
              var sDistKm = (s.distance_meters || 0) / 1000;
              var sMoving = s.moving_time_seconds || 0;
              if (sDistKm > 0 && sMoving > 0) {
                var sPaceSec = sMoving / sDistKm;
                var sPaceMin = Math.floor(sPaceSec / 60);
                var sPaceRemainder = Math.round(sPaceSec % 60);
                if (sPaceRemainder < 10) sPaceRemainder = '0' + sPaceRemainder;
                sPace = sPaceMin + ':' + sPaceRemainder + ' /km';
              }
              var sHR = s.average_heartrate ? Math.round(s.average_heartrate) + ' bpm' : '—';
              html += '<tr><td style="color:var(--muted); font-weight:600;">#' + s.split_number + '</td><td style="color:#fff; font-weight:600;">' + sDist + '</td><td style="color:#E8622A; font-weight:700;">' + sPace + '</td>' + (hasHR ? '<td style="color:rgba(255,255,255,0.7);">' + sHR + '</td>' : '') + '</tr>';
            });
            html += '</tbody></table>';
            splitsTableContainer.innerHTML = html;
          }
        })
        .catch(function(err) { console.warn('Failed to load splits:', err); });

      function handleLoadedActivity(fullAct) {
        var athleteId = fullAct.strava_athlete_id || fullAct.athlete_id;
        if (athleteId) {
          fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=full_name', { headers: HDR })
            .then(function(r) { return r.json(); })
            .then(function(regRows) {
              if (regRows && regRows.length > 0) {
                fullAct.athlete_name = regRows[0].full_name;
              }
              populateFromActivity(fullAct, null);
            })
            .catch(function() {
              populateFromActivity(fullAct, null);
            });
        } else {
          populateFromActivity(fullAct, null);
        }
      }

      fetch(SUPABASE_URL + '/rest/v1/activities?strava_activity_id=eq.' + stravaActId, { headers: HDR })
        .then(function(res) { return res.json(); })
        .then(function(rows) {
          if (rows && rows.length > 0) {
            handleLoadedActivity(rows[0]);
          } else {
            // Try fallback query by internal database ID
            fetch(SUPABASE_URL + '/rest/v1/activities?id=eq.' + stravaActId, { headers: HDR })
              .then(function(res) { return res.json(); })
              .then(function(rows2) {
                if (rows2 && rows2.length > 0) {
                  handleLoadedActivity(rows2[0]);
                } else {
                  console.warn('Activity not found by strava_activity_id or id:', stravaActId);
                }
              })
              .catch(function(err) { console.warn('Fallback fetch failed:', err); });
          }
        })
        .catch(function(err) { console.warn('Failed to load full activity details:', err); });
    }
  } catch (errGlobal) {
    console.error('Error executing openActivityDetail:', errGlobal);
  }
}

function closeActivityDetail() {
  var modal = document.getElementById('activity-detail-modal');
  modal.classList.remove('open');
  setTimeout(function() {
    modal.style.display = 'none';
  }, 350);
}

function renderSportsStats() {
  var container = document.getElementById('prof-sports-stats-container');
  if (!container) return;
  if (!_activeProfileStats) {
    container.innerHTML = '<div style="font-size:12px; color:var(--muted); text-align:center; padding:12px 0;">No Strava stats breakdown available.</div>';
    return;
  }
  
  var prefix = _activeStatsTimeframe;
  var run = _activeProfileStats[prefix + '_run_totals'] || { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };
  var ride = _activeProfileStats[prefix + '_ride_totals'] || { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };
  var swim = _activeProfileStats[prefix + '_swim_totals'] || { count: 0, distance: 0, moving_time: 0, elevation_gain: 0 };
  
  var sports = [
    { name: 'Run/Walk', icon: '🏃', data: run },
    { name: 'Ride', icon: '🚴', data: ride },
    { name: 'Swim', icon: '🏊', data: swim }
  ];
  
  var html = '';
  sports.forEach(function(sport) {
    var count = sport.data.count || 0;
    var dist = ((sport.data.distance || 0) / 1000).toFixed(1) + ' km';
    if (sport.name === 'Swim') {
      dist = (sport.data.distance || 0).toLocaleString('en-IN') + ' m';
    }
    
    var timeSec = sport.data.moving_time || 0;
    var timeStr = '0m';
    if (timeSec >= 3600) {
      timeStr = Math.floor(timeSec / 3600) + 'h ' + Math.floor((timeSec % 3600) / 60) + 'm';
    } else if (timeSec > 0) {
      timeStr = Math.floor(timeSec / 60) + 'm';
    }
    var elev = Math.round(sport.data.elevation_gain || 0) + ' m';
    
    html += `
      <div class="prof-pb-card" style="padding:14px; background:rgba(255,255,255,0.01);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.04); padding-bottom:6px; margin-bottom:10px;">
          <span style="font-size:12.5px; font-weight:800; color:#fff;">${sport.icon} ${sport.name}</span>
        </div>
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); text-align:center; gap:6px;">
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Activities</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${count}</div>
          </div>
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Distance</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${dist}</div>
          </div>
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Time</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${timeStr}</div>
          </div>
          <div>
            <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Elev Gain</div>
            <div style="font-size:12.5px; font-weight:800; color:#fff; margin-top:2px;">${elev}</div>
          </div>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function toggleStatsTimeframe(timeframe) {
  _activeStatsTimeframe = timeframe;
  var btnRecent = document.getElementById('btn-stats-recent');
  var btnAll = document.getElementById('btn-stats-alltime');
  if (btnRecent && btnAll) {
    if (timeframe === 'recent') {
      btnRecent.style.background = 'rgba(255, 255, 255, 0.08)';
      btnRecent.style.color = '#fff';
      btnAll.style.background = 'none';
      btnAll.style.color = 'var(--muted)';
    } else {
      btnAll.style.background = 'rgba(255, 255, 255, 0.08)';
      btnAll.style.color = '#fff';
      btnRecent.style.background = 'none';
      btnRecent.style.color = 'var(--muted)';
    }
  }
  renderSportsStats();
}

function openProfileDetail(athleteId, event) {
  console.log('openProfileDetail called with athleteId:', athleteId);
  if (!athleteId || String(athleteId) === 'undefined' || String(athleteId) === 'null' || String(athleteId).trim() === '') {
    console.warn('Invalid athleteId passed to openProfileDetail:', athleteId);
    return;
  }
  try {
    if (event && event.target && (event.target.closest('button') || event.target.closest('.feed-react-btn'))) {
      return;
    }
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();

    _activeProfileStats = null;
    _activeStatsTimeframe = 'recent';
    
    var statsContainer = document.getElementById('prof-sports-stats-container');
    if (statsContainer) statsContainer.innerHTML = '<div style="font-size:12px; color:var(--muted); text-align:center; padding:12px 0;">Loading Strava stats breakdown...</div>';

    var btnRecent = document.getElementById('btn-stats-recent');
    var btnAll = document.getElementById('btn-stats-alltime');
    if (btnRecent && btnAll) {
      btnRecent.style.background = 'rgba(255, 255, 255, 0.08)';
      btnRecent.style.color = '#fff';
      btnAll.style.background = 'none';
      btnAll.style.color = 'var(--muted)';
    }

    document.getElementById('prof-name').innerHTML = 'Loading...';
    document.getElementById('prof-team-shift').innerText = '';
    document.getElementById('prof-total-dist').innerText = '—';
    document.getElementById('prof-total-steps').innerText = '—';
    document.getElementById('prof-total-activities').innerText = '—';
    document.getElementById('prof-total-hours').innerText = '—';
    document.getElementById('prof-pb-longest').innerText = '—';
    document.getElementById('prof-pb-pace').innerText = '—';
    document.getElementById('prof-pb-duration').innerText = '—';
    document.getElementById('prof-pb-streak').innerText = '—';
    document.getElementById('prof-heatmap-grid').innerHTML = '';
    document.getElementById('prof-recent-activities').innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">Loading recent activities...</div>';

    if (typeof _currentProfileAthleteId !== 'undefined') _currentProfileAthleteId = athleteId;

    var modal = document.getElementById('profile-detail-modal');
    modal.style.display = 'block';
    setTimeout(function() {
      modal.classList.add('open');
    }, 10);

    Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=*', { headers: HDR }).then(function(r){ return r.json(); }),
      fetch(SUPABASE_URL + '/rest/v1/participants?strava_athlete_id=eq.' + athleteId + '&select=city,state,profile_photo', { headers: HDR }).then(function(r){ return r.json(); })
    ]).then(function(results) {
      var regRows = results[0];
      var partRows = results[1];
      var city = (partRows && partRows[0] && partRows[0].city) || '';
      var state = (partRows && partRows[0] && partRows[0].state) || '';
      var profilePhoto = (partRows && partRows[0] && partRows[0].profile_photo) || '';
      
      var locationParts = [];
      if (city) locationParts.push(city);
      if (state) locationParts.push(state);
      locationParts.push('India');
      var locationStr = locationParts.join(', ');

      if (regRows && regRows.length > 0) {
        var p = regRows[0];
        document.getElementById('prof-name').innerHTML = `<a href="https://www.strava.com/athletes/${athleteId}" target="_blank" style="color: #fff; text-decoration: none; border-bottom: 1.5px dashed rgba(255,255,255,0.3); transition: color 0.2s ease, border-color 0.2s ease;">${esc(p.full_name || '—')} 🇮🇳</a>`;

        // Location
        var locEl = document.getElementById('prof-location');
        if (locEl) {
          locEl.innerText = '📍 ' + locationStr;
          locEl.style.display = 'block';
        }

        var pName = p.full_name || 'Participant';
        var pInitials = (function(){var pts=(pName||'').trim().split(/\s+/);if(pts.length>=2)return(pts[0][0]+(pts[pts.length-1][0])).toUpperCase();return(pts[0]||'?')[0].toUpperCase();})();
        var pStyle = getAvatarStyle(pName);
        var avEl = document.getElementById('prof-avatar');
        if (avEl) {
          var hasPhoto = profilePhoto && profilePhoto !== 'null' && profilePhoto !== 'undefined' && !profilePhoto.includes('large.png') && !profilePhoto.includes('avatar/athlete');
          if (hasPhoto) {
            avEl.textContent = '';
            avEl.setAttribute('style', `background: url('${profilePhoto}') no-repeat center center; background-size: cover; width:90px; height:90px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); border:2.5px solid rgba(255,255,255,0.08);`);
          } else {
            avEl.textContent = pInitials;
            avEl.setAttribute('style', pStyle + '; width:90px; height:90px; border-radius:50%; font-size:32px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 24px rgba(0,0,0,0.4); border:2.5px solid rgba(255,255,255,0.08);');
          }
        }
      }
    }).catch(function(err) {
      console.warn('Profile details load error:', err);
    });

    var _profileAthleteId = athleteId;
    var _profileTimeframe = document.getElementById('prof-timeframe-select') ? (document.getElementById('prof-timeframe-select').value || 'month') : 'month';
    var url = SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + athleteId + '&is_deleted=is.false&activity_date=gte.2026-06-01&activity_date=lte.2026-07-01T15:00:00&order=activity_date.desc';
    fetch(url, { headers: HDR })
      .then(function(res) { return res.json(); })
      .then(function(acts) {
        var validActs = acts.filter(function(a) { return !a.is_flagged; });

        // Calculate stats breakdown locally from synchronized activities
        var runActs = validActs.filter(function(a) { var t = a.sport_type; return t === 'Walk' || t === 'Run' || t === 'VirtualRun' || t === 'Hike'; });
        var rideActs = validActs.filter(function(a) { var t = a.sport_type; return t === 'Ride' || t === 'VirtualRide' || t === 'MountainBikeRide'; });
        var swimActs = validActs.filter(function(a) { return a.sport_type === 'Swim'; });
        
        function sumTotals(actsList) {
          return {
            count: actsList.length,
            distance: actsList.reduce(function(s, a) { return s + (a.distance_meters || 0); }, 0),
            moving_time: actsList.reduce(function(s, a) { return s + (a.moving_time_seconds || 0); }, 0),
            elevation_gain: actsList.reduce(function(s, a) { return s + (a.elevation_gain || 0); }, 0)
          };
        }
        
        _activeProfileStats = {
          recent_run_totals: sumTotals(runActs),
          recent_ride_totals: sumTotals(rideActs),
          recent_swim_totals: sumTotals(swimActs),
          all_run_totals: sumTotals(runActs),
          all_ride_totals: sumTotals(rideActs),
          all_swim_totals: sumTotals(swimActs)
        };
        renderSportsStats();

        var pGender = 'Male';
        var pShift = 'Dayshift';
        if (LB_REG && LB_REG.length) {
          var matchingReg = LB_REG.find(function(x) { return String(x.strava_athlete_id) === String(athleteId); });
          if (matchingReg) {
            pGender = matchingReg.gender || 'Male';
            pShift = matchingReg.shift || 'Dayshift';
          }
        }
        var pPts = calcFullPts(acts, pGender, pShift);

        document.getElementById('prof-total-dist').innerText = Math.round(pPts.km) + ' km';
        
        var validCount = validActs.length;
        document.getElementById('prof-total-activities').innerText = validCount;

        var totalDistM = validActs.reduce(function(s,a) { return s + (a.distance_meters || 0); }, 0);
        var totalSteps = Math.round((totalDistM / 1000) * 1350);
        document.getElementById('prof-total-steps').innerText = totalSteps.toLocaleString('en-IN');

        // Total Hours calculation
        var totalMovingSeconds = validActs.reduce(function(s,a) { return s + (a.moving_time_seconds || 0); }, 0);
        var totalHours = (totalMovingSeconds / 3600).toFixed(1);
        document.getElementById('prof-total-hours').innerText = totalHours + 'h';

        // Split distance of Run, Walk/Hike and Ride
        var runDistM = 0;
        var walkHikeDistM = 0;
        var rideDistM = 0;
        validActs.forEach(function(a) {
          var t = a.sport_type;
          var dist = a.distance_meters || 0;
          if (t === 'Run' || t === 'VirtualRun') {
            runDistM += dist;
          } else if (t === 'Walk' || t === 'Hike') {
            walkHikeDistM += dist;
          } else if (t === 'Ride' || t === 'VirtualRide' || t === 'MountainBikeRide') {
            rideDistM += dist;
          }
        });
        document.getElementById('prof-split-run').innerText = (runDistM / 1000).toFixed(1) + ' km';
        document.getElementById('prof-split-walk').innerText = (walkHikeDistM / 1000).toFixed(1) + ' km';
        document.getElementById('prof-split-ride').innerText = (rideDistM / 1000).toFixed(1) + ' km';

        var maxDist = 0;
        var maxTime = 0;
        var maxSpeed = 0;
        var bestPaceSport = 'Walk';
        var dayKm = {};
        
        validActs.forEach(function(a) {
          var km = (a.distance_meters || 0) / 1000;
          if (a.distance_meters > maxDist) maxDist = a.distance_meters;
          if (a.moving_time_seconds > maxTime) maxTime = a.moving_time_seconds;
          
          var t = a.sport_type;
          var isWalkRun = t === 'Walk' || t === 'Run' || t === 'VirtualRun' || t === 'Hike';
          if (isWalkRun && a.avg_speed > maxSpeed && a.avg_speed < 12) {
            maxSpeed = a.avg_speed;
            bestPaceSport = t;
          }

          var d = getActDate(a);
          if (d) dayKm[d] = (dayKm[d] || 0) + km;
        });

        document.getElementById('prof-pb-longest').innerText = maxDist > 0 ? (maxDist / 1000).toFixed(2) + ' km' : '—';
        document.getElementById('prof-pb-pace').innerText = maxSpeed > 0 ? fmtPS(maxSpeed, bestPaceSport) : '—';
        document.getElementById('prof-pb-duration').innerText = maxTime > 0 ? fmtDur(maxTime) : '—';

        var streak = 0;
        var activeDays = {};
        validActs.forEach(function(a) {
          var d = getActDate(a);
          if (d) activeDays[d] = true;
        });
        var sortedActive = Object.keys(activeDays).sort();
        var best = 0, cur = 0, prevD = null;
        sortedActive.forEach(function(d) {
          if (prevD) {
            var diff = Math.round((new Date(d + 'T12:00:00') - new Date(prevD + 'T12:00:00')) / 86400000);
            cur = diff === 1 ? cur + 1 : 1;
          } else cur = 1;
          best = Math.max(best, cur);
          prevD = d;
        });
        document.getElementById('prof-pb-streak').innerText = best + ' days';

        var grid = document.getElementById('prof-heatmap-grid');
        if (grid) {
          grid.innerHTML = '';
          var todayStr = new Date().toISOString().split('T')[0];
          for (var d = 1; d <= 30; d++) {
            var ds = '2026-06-' + (d < 10 ? '0' : '') + d;
            var cell = document.createElement('div');
            cell.className = 'hm-day';
            var km = dayKm[ds] || 0;
            cell.title = ds + (km > 0 ? ' \u00b7 ' + km.toFixed(1) + ' km' : '');
            cell.textContent = d;
            if (ds > todayStr) { cell.classList.add('future'); }
            else if (km >= 21) { cell.classList.add('km-21'); }
            else if (km >= 15) { cell.classList.add('km-15'); }
            else if (km >= 10) { cell.classList.add('km-10'); }
            else if (km >= 8)  { cell.classList.add('km-8'); }
            else if (km >= 5)  { cell.classList.add('km-5'); }
            else { cell.classList.add('rest'); }
            if (ds === todayStr) cell.classList.add('today');
            grid.appendChild(cell);
          }
        }

        var listContainer = document.getElementById('prof-recent-activities');
        if (!listContainer) return;
        if (!validActs.length) {
          listContainer.innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">No recent activities logged this month.</div>';
          return;
        }
        listContainer.innerHTML = '';
        validActs.slice(0, 10).forEach(function(a) {
          var card = document.createElement('div');
          card.className = 'prof-recent-act-card';
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'stretch';
          card.style.cursor = 'pointer';
          
          var dateLabel = '';
          try {
            var adt = new Date(a.activity_date);
            if (!isNaN(adt.getTime())) {
              dateLabel = adt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' at ' + adt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
            }
          } catch (e) {}

          var distVal = ((a.distance_meters || 0) / 1000).toFixed(2);
          var movingMins = Math.round((a.moving_time_seconds || 0) / 60);
          var stepsVal = Math.round(((a.distance_meters || 0) / 1000) * 1350);
          var paceValStr = (a.distance_meters > 0 && a.moving_time_seconds > 0) ? fmtPS(a.distance_meters / a.moving_time_seconds, a.sport_type) : '—';
          var elevVal = a.elevation_gain || 0;
          var deviceVal = a.device_name || 'Strava';

          card.addEventListener('click', function(e) {
            if (e.target.closest('.view-full-btn')) {
              return;
            }
            e.preventDefault();
            var coll = card.querySelector('.act-card-collapse');
            if (coll) {
              var isCollapsed = coll.style.display === 'none';
              coll.style.display = isCollapsed ? 'block' : 'none';
              card.style.borderColor = isCollapsed ? 'rgba(232, 98, 42, 0.4)' : 'rgba(255,255,255,0.06)';
            }
          });
          
          card.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
              <div>
                <div style="font-size:14px; font-weight:800; color:#fff;">${esc(a.activity_name || 'Activity')}</div>
                <div style="font-size:11.5px; color:var(--muted); margin-top:2px;">${dateLabel} &middot; ${movingMins} mins &middot; ${stepsVal.toLocaleString('en-IN')} steps</div>
              </div>
              <div style="font-size:14px; font-weight:800; color:var(--brand); display:flex; align-items:center; gap:2px; flex-shrink:0;">
                <span>${distVal}</span> <span style="font-size:10px; color:var(--muted); font-weight:700;">KM</span>
              </div>
            </div>
            <div class="act-card-collapse" style="display: none; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,0.08); margin-top: 10px; width: 100%;">
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 12px; color: rgba(255,255,255,0.7);">
                <div><span style="color: var(--muted); font-weight: 700;">Pace:</span> ${paceValStr}</div>
                <div><span style="color: var(--muted); font-weight: 700;">Elapsed:</span> ${fmtDur(a.elapsed_time_seconds || 0)}</div>
                <div><span style="color: var(--muted); font-weight: 700;">Elevation:</span> ${Math.round(elevVal)} m</div>
                <div><span style="color: var(--muted); font-weight: 700;">Device:</span> ${esc(deviceVal)}</div>
              </div>
              <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                <button class="view-full-btn" onclick="openActivityDetail('${a.strava_activity_id}', event, true)" style="background: rgba(232, 98, 42, 0.1); border: 1px solid rgba(232, 98, 42, 0.25); color: var(--brand); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                  Full Stats &amp; Map ↗
                </button>
              </div>
            </div>
          `;
          listContainer.appendChild(card);
        });
      })
      .catch(function(err) {
        console.warn('Profile activities load error:', err);
      });
  } catch (errGlobal) {
    console.error('Error executing openProfileDetail:', errGlobal);
  }
}


function closeProfileDetail() {
  var modal = document.getElementById('profile-detail-modal');
  modal.classList.remove('open');
  setTimeout(function() {
    modal.style.display = 'none';
  }, 350);
}

// Suspicious Activity Reporting Logic
function toggleReportForm() {
  var container = document.getElementById('report-form-container');
  var btn = document.getElementById('btn-report-activity');
  if (container.style.display === 'none') {
    container.style.display = 'block';
    btn.style.display = 'none';
  } else {
    container.style.display = 'none';
    btn.style.display = 'flex';
  }
}

function onReportReasonChange() {
  var select = document.getElementById('report-reason-select');
  var comments = document.getElementById('report-comments');
  if (select.value === 'custom') {
    comments.focus();
  }
}

async function submitActivityReport() {
  var activityId = window._currentReportActivityId;
  var ownerId = window._currentReportOwnerId;
  
  if ((!activityId || !ownerId) && window._currentStravaActivityId) {
    try {
      // 1. Try resolving by strava_activity_id
      var r = await fetch(SUPABASE_URL + '/rest/v1/activities?strava_activity_id=eq.' + window._currentStravaActivityId, {
        headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
      });
      var data = await r.json();
      if (data && data.length > 0) {
        activityId = data[0].id;
        ownerId = data[0].strava_athlete_id || data[0].athlete_id;
      } else {
        // 2. Try resolving by database primary key id
        var r2 = await fetch(SUPABASE_URL + '/rest/v1/activities?id=eq.' + window._currentStravaActivityId, {
          headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
        });
        var data2 = await r2.json();
        if (data2 && data2.length > 0) {
          activityId = data2[0].id;
          ownerId = data2[0].strava_athlete_id || data2[0].athlete_id;
        }
      }
      
      if (activityId) {
        window._currentReportActivityId = activityId;
        window._currentReportOwnerId = ownerId;
      }
    } catch(e) {
      console.warn('Failed to resolve activity details dynamically:', e);
    }
  }
  
  if (!activityId || !ownerId) {
    alert('Failed to report activity: Activity details not loaded.\n'
        + 'Diagnostic Log:\n'
        + '- currentReportActivityId: ' + window._currentReportActivityId + '\n'
        + '- currentReportOwnerId: ' + window._currentReportOwnerId + '\n'
        + '- currentStravaActivityId: ' + window._currentStravaActivityId);
    return;
  }
  
  var select = document.getElementById('report-reason-select');
  var reason = select.value;
  var comments = document.getElementById('report-comments').value.trim();
  
  if (reason === 'custom') {
    reason = comments;
  }
  
  if (!reason) {
    alert('Please select or specify a reason for reporting.');
    return;
  }
  
  var session = null;
  try { session = JSON.parse(localStorage.getItem('wk_user') || '{}'); } catch(e) {}
  var reporterId = session ? String(session.athleteId) : '';
  
  if (!reporterId) {
    alert('You must be logged in to report activities.');
    return;
  }
  
  var btnSubmit = document.getElementById('btn-submit-report');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Checking limits...';
  
  try {
    var now = new Date();
    var todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    
    var limitResp = await fetch(SUPABASE_URL + '/rest/v1/activity_reports?select=id&reported_by=eq.' + reporterId + '&created_at=gte.' + todayStart, {
      headers: { apikey: ANON, Authorization: 'Bearer ' + ANON }
    });
    if (limitResp.ok) {
      var userTodayReports = await limitResp.json();
      if (userTodayReports && userTodayReports.length >= 5) {
        alert('You have reached the daily limit of 5 reports. You are abusing this feature.');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Report';
        return;
      }
    }
  } catch(e) {
    console.warn('Failed to verify user reporting limits:', e);
  }
  
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Submitting...';
  
  var payload = {
    activity_id: parseInt(activityId),
    reported_by: reporterId,
    athlete_id: ownerId,
    reason: reason,
    custom_comments: comments || null
  };
  
  try {
    var resp = await fetch(SUPABASE_URL + '/rest/v1/activity_reports', {
      method: 'POST',
      headers: {
        apikey: ANON,
        Authorization: 'Bearer ' + ANON,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    
    if (resp.status === 404) {
      alert('Report failed: Database table activity_reports not found. Please verify the SQL migration has been run in the Supabase Dashboard.');
      return;
    }
    
    if (!resp.ok) {
      throw new Error('Database insert failed with status ' + resp.status);
    }
    
    alert('Thank you. The activity has been reported to the administrator for review.');
    toggleReportForm();
    closeActivityDetail();
    
  } catch (e) {
    alert('Error submitting report: ' + e.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Submit Report';
  }
}


// ── Share Activity Card ──────────────────────────────────────────────────────
window._shareActivityData = null;

function showShareSheet() {
  var sh = document.getElementById('share-sheet');
  if (sh) sh.style.display = 'flex';
}
function hideShareSheet() {
  var sh = document.getElementById('share-sheet');
  if (sh) sh.style.display = 'none';
}

async function shareActivityCard(type) {
  hideShareSheet();
  var act = window._shareActivityData;
  if (!act) return;
  var km = parseFloat(((act.distance_meters||0)/1000).toFixed(2));
  var movingSec = act.moving_time_seconds||0;
  var paceSecPerKm = km>0 ? movingSec/km : 0;
  var paceMin = Math.floor(paceSecPerKm/60);
  var paceSec = Math.round(paceSecPerKm%60);
  var paceStr = km>0 ? paceMin+':'+(paceSec<10?'0':'')+paceSec+'/km' : '--';
  var totalMins = Math.floor(movingSec/60);
  var timeHrs = Math.floor(totalMins/60);
  var timeMinsRem = totalMins%60;
  var timeStr = timeHrs>0 ? timeHrs+'h '+timeMinsRem+'m' : timeMinsRem+'m';
  var steps = act.steps || Math.round(km*1350);
  var stepsStr = steps.toLocaleString('en-IN');
  var actName = act.activity_name||'Activity';
  var dateStr='';
  try { dateStr=act.activity_date ? new Date(act.activity_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : ''; } catch(e){}
  var pName='Participant';
  if(typeof currentSession!=='undefined'&&currentSession&&currentSession.name) pName=currentSession.name;
  else if(typeof LB_ME!=='undefined'&&LB_ME&&LB_ME.full_name) pName=LB_ME.full_name;
  var teamStr=(typeof LB_ME!=='undefined'&&LB_ME)?(LB_ME.team_name||LB_ME.shift||''):'';
  var brPct=parseInt((document.getElementById('ring-pct-br')||{}).textContent)||0;
  var siPct=parseInt((document.getElementById('ring-pct-si')||{}).textContent)||0;
  var goPct=parseInt((document.getElementById('ring-pct-go')||{}).textContent)||0;
  var data={km:km.toFixed(2),pace:paceStr,time:timeStr,steps:stepsStr,actName:actName,date:dateStr,name:pName,team:teamStr,brPct:brPct,siPct:siPct,goPct:goPct};
  var canvas=document.createElement('canvas');
  var ctx=canvas.getContext('2d');
  if(type==='whatsapp'){canvas.width=900;canvas.height=675;_drawWACard(ctx,900,675,data);}
  else{canvas.width=540;canvas.height=960;_drawStoryCard(ctx,540,960,data);}
  canvas.toBlob(async function(blob){
    var fname=type==='whatsapp'?'walkathon-activity.png':'walkathon-story.png';
    if(navigator.canShare){
      try{var file=new File([blob],fname,{type:'image/png'});
        if(navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'My Walkathon Activity'});return;}
      }catch(e){if(e.name==='AbortError')return;}
    }
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=url;a.download=fname;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  },'image/png');
}

function _crr(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}

function _drawWACard(ctx,W,H,d){
  var BR='#E8622A',SFC='#1e2330',TXT='#ffffff',MUT='rgba(255,255,255,0.48)';
  ctx.fillStyle='#14181f';ctx.fillRect(0,0,W,H);
  ctx.fillStyle=SFC;_crr(ctx,32,24,W-64,80,12);ctx.fill();
  ctx.font='bold 15px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='left';
  ctx.fillText('WALKATHON',52,60);
  ctx.font='600 11px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.fillText('Arcgate 2026',52,80);
  ctx.font='bold 13px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.textAlign='right';
  ctx.fillText(d.date,W-52,60);
  [[d.brPct,'#C8843A'],[d.siPct,'#A8BCC8'],[d.goPct,'#D4A030']].forEach(function(m,i){
    ctx.beginPath();ctx.arc(W-52-(2-i)*22,80,7,0,Math.PI*2);
    ctx.fillStyle=m[0]>=100?m[1]:'rgba(255,255,255,0.1)';ctx.fill();
  });
  ctx.font='bold 14px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.textAlign='center';
  ctx.fillText(d.actName.toUpperCase().substring(0,28),W/2,155);
  var pts=d.km.split('.');
  ctx.font='bold 96px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;
  var iw=ctx.measureText(pts[0]).width;
  ctx.font='bold 56px system-ui,Arial,sans-serif';
  var dw=ctx.measureText('.'+(pts[1]||'00')).width;
  var sx=(W-(iw+dw))/2;
  ctx.font='bold 96px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='left';
  ctx.fillText(pts[0],sx,285);
  ctx.font='bold 56px system-ui,Arial,sans-serif';ctx.fillStyle=BR;
  ctx.fillText('.'+(pts[1]||'00'),sx+iw,285);
  ctx.font='800 16px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.textAlign='center';
  ctx.fillText('KILOMETRES',W/2,325);
  ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(64,355);ctx.lineTo(W-64,355);ctx.stroke();
  var stats=[{v:d.pace,l:'PACE'},{v:d.time,l:'TIME'},{v:d.steps,l:'STEPS'},{v:d.name.split(' ')[0],l:'ATHLETE'}];
  var cw=(W-96)/4;
  stats.forEach(function(s,i){
    var cx=48+i*cw+cw/2;
    ctx.fillStyle=SFC;ctx.fillRect(48+i*cw+4,375,cw-8,100);
    ctx.font='bold 18px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='center';
    ctx.fillText(s.v,cx,432);
    ctx.font='700 10px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.fillText(s.l,cx,454);
  });
  ctx.font='bold 15px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='center';
  ctx.fillText(d.name,W/2,525);
  ctx.font='600 12px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.fillText(d.team,W/2,548);
  ctx.fillStyle=BR;ctx.fillRect(0,H-5,W,5);
  ctx.font='600 11px system-ui,Arial,sans-serif';ctx.fillStyle='rgba(255,255,255,0.2)';ctx.textAlign='center';
  ctx.fillText('arcgate.walkathon.in',W/2,H-18);
}

function _drawStoryCard(ctx,W,H,d){
  var BR='#E8622A',TXT='#ffffff',MUT='rgba(255,255,255,0.48)';
  var grad=ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#1a2030');grad.addColorStop(1,'#0e1115');
  ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
  ctx.fillStyle=BR;ctx.fillRect(0,0,W,4);
  ctx.font='bold 22px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='center';
  ctx.fillText('WALKATHON',W/2,72);
  ctx.font='600 13px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;
  ctx.fillText('Arcgate 2026  \u00b7  '+d.date,W/2,96);
  var rings=[[d.brPct,'#C8843A','BRONZE'],[d.siPct,'#A8BCC8','SILVER'],[d.goPct,'#D4A030','GOLD']];
  rings.forEach(function(r,i){
    var cx=W/4*(i+1),cy=225,rr=58;
    ctx.beginPath();ctx.arc(cx,cy,rr,-Math.PI/2,Math.PI*1.5);
    ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=5;ctx.stroke();
    ctx.beginPath();ctx.arc(cx,cy,rr,-Math.PI/2,-Math.PI/2+(Math.min(r[0],100)/100)*Math.PI*2);
    ctx.strokeStyle=r[1];ctx.lineWidth=5;ctx.lineCap='round';ctx.stroke();
    ctx.font='bold 18px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='center';
    ctx.fillText(Math.min(r[0],100)+'%',cx,cy+7);
    ctx.font='700 10px system-ui,Arial,sans-serif';ctx.fillStyle=r[1];ctx.fillText(r[2],cx,cy+rr+18);
    if(r[0]>=100){ctx.font='600 10px system-ui,Arial,sans-serif';ctx.fillStyle='#22C55E';ctx.fillText('\u2713 Done',cx,cy+rr+34);}
  });
  ctx.font='bold 26px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='center';
  ctx.fillText(d.name,W/2,345);
  ctx.fillStyle=BR;ctx.fillRect(W/2-22,354,44,3);
  ctx.font='600 13px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.fillText(d.team,W/2,378);
  var pts2=d.km.split('.');
  ctx.font='bold 76px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;
  var iw2=ctx.measureText(pts2[0]).width;
  ctx.font='bold 46px system-ui,Arial,sans-serif';
  var dw2=ctx.measureText('.'+(pts2[1]||'00')).width;
  var sx2=(W-(iw2+dw2))/2;
  ctx.font='bold 76px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='left';
  ctx.fillText(pts2[0],sx2,470);
  ctx.font='bold 46px system-ui,Arial,sans-serif';ctx.fillStyle=BR;
  ctx.fillText('.'+(pts2[1]||'00'),sx2+iw2,470);
  ctx.font='800 13px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.textAlign='center';
  ctx.fillText('KILOMETRES',W/2,498);
  var st2=[{v:d.pace,l:'PACE'},{v:d.time,l:'TIME'},{v:d.steps,l:'STEPS'},{v:d.name.split(' ')[0],l:'ATHLETE'}];
  var tw=(W-56)/2,th=82,ty0=528;
  [0,1].forEach(function(row){[0,1].forEach(function(col){
    var si2=row*2+col,tx=24+col*(tw+8),ty=ty0+row*(th+8);
    ctx.fillStyle='rgba(255,255,255,0.06)';ctx.fillRect(tx,ty,tw,th);
    ctx.font='bold 20px system-ui,Arial,sans-serif';ctx.fillStyle=TXT;ctx.textAlign='center';
    ctx.fillText(st2[si2].v,tx+tw/2,ty+44);
    ctx.font='700 10px system-ui,Arial,sans-serif';ctx.fillStyle=MUT;ctx.fillText(st2[si2].l,tx+tw/2,ty+62);
  });});
  ctx.font='700 16px system-ui,Arial,sans-serif';ctx.fillStyle='rgba(232,98,42,0.7)';ctx.textAlign='center';
  ctx.fillText('#ArcgateWalkathon',W/2,H-46);
  ctx.font='600 12px system-ui,Arial,sans-serif';ctx.fillStyle='rgba(255,255,255,0.2)';
  ctx.fillText('arcgate.walkathon.in',W/2,H-24);
}
