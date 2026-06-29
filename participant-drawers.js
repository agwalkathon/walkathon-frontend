// Profile and Activity Details Modal Drawers

var _activeProfileStats = null;
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
    if (event && event.target && (event.target.closest('button') || event.target.closest('.feed-react-btn'))) {
      return;
    }
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();

    // Reset fields to loading placeholders
    document.getElementById('detail-top-date').innerText = 'Loading...';
    document.getElementById('detail-title').innerText = 'Loading...';
    document.getElementById('detail-started-info').innerText = '';
    document.getElementById('det-dist').innerText = '—';
    document.getElementById('det-movetime').innerText = '—';
    document.getElementById('det-elapsed').innerText = '—';
    document.getElementById('det-pace').innerText = '—';
    document.getElementById('det-calcsteps').innerText = '—';
    document.getElementById('det-stravasteps').innerText = '—';
    document.getElementById('det-elevation').innerText = '—';
    document.getElementById('det-device').innerText = '—';
    document.getElementById('det-avghr').innerText = '—';
    document.getElementById('det-maxhr').innerText = '—';
    document.getElementById('det-cadence').innerText = '—';
    document.getElementById('det-calories').innerText = '—';
    document.getElementById('detail-desc-box').style.display = 'none';
    document.getElementById('detail-appreciation-box').innerHTML = '';

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
      document.getElementById('detail-title').innerText = esc(athleteName) + ' \u00b7 ' + esc(actName);

      var startedStr = '';
      try {
        var localDt = new Date(act.activity_date);
        if (!isNaN(localDt.getTime())) {
          var timeStr = localDt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
          var dateStr = localDt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
          startedStr = 'Started at ' + timeStr + ' on ' + dateStr;
        }
      } catch (e) {}
      document.getElementById('detail-started-info').innerText = startedStr;

      var distanceKmVal = (act.distance_meters || 0) / 1000;
      document.getElementById('det-dist').innerText = distanceKmVal.toFixed(2) + ' km';

      var movingSec = act.moving_time_seconds || 0;
      var elapsedSec = act.elapsed_time_seconds || 0;
      document.getElementById('det-movetime').innerText = fmtDur(movingSec);
      document.getElementById('det-elapsed').innerText = fmtDur(elapsedSec);

      var paceValStr = '—';
      if (distanceKmVal > 0 && movingSec > 0) {
        paceValStr = fmtPS((distanceKmVal * 1000) / movingSec, sportType);
      }
      document.getElementById('det-pace').innerText = paceValStr;

      var calculatedSteps = Math.round(distanceKmVal * 1350);
      document.getElementById('det-calcsteps').innerText = calculatedSteps.toLocaleString('en-IN');

      var stravaStepsVal = act.steps || null;
      var stepsWrap = document.getElementById('det-stravasteps-wrap');
      if (stravaStepsVal !== null && stravaStepsVal !== undefined && stravaStepsVal > 0) {
        document.getElementById('det-stravasteps').innerText = stravaStepsVal.toLocaleString('en-IN');
        if (stepsWrap) stepsWrap.style.display = 'block';
      } else {
        if (stepsWrap) stepsWrap.style.display = 'none';
      }

      document.getElementById('det-elevation').innerText = Math.round(act.elevation_gain || 0) + ' m';
      document.getElementById('det-device').innerText = esc(act.device_name || 'Strava App');

      var avgHrVal = act.average_heartrate || null;
      var maxHrVal = act.max_heartrate || null;
      var hrWrap = document.getElementById('det-hr-wrap');
      if (avgHrVal) {
        document.getElementById('det-avghr').innerText = Math.round(avgHrVal) + ' bpm';
        document.getElementById('det-maxhr').innerText = maxHrVal ? Math.round(maxHrVal) + ' bpm' : '—';
        if (hrWrap) hrWrap.style.display = 'block';
      } else {
        if (hrWrap) hrWrap.style.display = 'none';
      }

      var cadenceVal = act.average_cadence || null;
      var cadenceWrap = document.getElementById('det-cadence-wrap');
      if (cadenceVal) {
        document.getElementById('det-cadence').innerText = Math.round(cadenceVal * 2) + ' spm'; // convert to steps per min
        if (cadenceWrap) cadenceWrap.style.display = 'block';
      } else {
        if (cadenceWrap) cadenceWrap.style.display = 'none';
      }

      var caloriesVal = act.calories || null;
      var caloriesWrap = document.getElementById('det-calories-wrap');
      if (caloriesVal) {
        document.getElementById('det-calories').innerText = Math.round(caloriesVal) + ' kcal';
        if (caloriesWrap) caloriesWrap.style.display = 'block';
      } else {
        if (caloriesWrap) caloriesWrap.style.display = 'none';
      }

      var descBox = document.getElementById('detail-desc-box');
      if (act.description) {
        document.getElementById('detail-desc-text').innerText = act.description;
        descBox.style.display = 'block';
      } else {
        descBox.style.display = 'none';
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
              L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(_activeDetailMap);
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

      fetch(SUPABASE_URL + '/rest/v1/activities?strava_activity_id=eq.' + stravaActId, { headers: HDR })
        .then(function(res) { return res.json(); })
        .then(function(rows) {
          if (rows && rows.length > 0) {
            var fullAct = rows[0];
            populateFromActivity(fullAct, null);
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

    document.getElementById('prof-name').innerText = 'Loading...';
    document.getElementById('prof-team-shift').innerText = '—';
    document.getElementById('prof-total-dist').innerText = '—';
    document.getElementById('prof-total-steps').innerText = '—';
    document.getElementById('prof-total-activities').innerText = '—';
    document.getElementById('prof-pb-longest').innerText = '—';
    document.getElementById('prof-pb-pace').innerText = '—';
    document.getElementById('prof-pb-duration').innerText = '—';
    document.getElementById('prof-pb-streak').innerText = '—';
    document.getElementById('prof-heatmap-grid').innerHTML = '';
    document.getElementById('prof-recent-activities').innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">Loading recent activities...</div>';

    var modal = document.getElementById('profile-detail-modal');
    modal.style.display = 'block';
    setTimeout(function() {
      modal.classList.add('open');
    }, 10);

    fetch(SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=*', { headers: HDR })
      .then(function(res) { return res.json(); })
      .then(function(regRows) {
        if (regRows && regRows.length > 0) {
          var p = regRows[0];
          document.getElementById('prof-name').innerText = esc(p.full_name || '—');
          
          var parts = [];
          if (p.leaderboard_team) parts.push(p.leaderboard_team);
          if (p.shift) parts.push(p.shift);
          document.getElementById('prof-team-shift').innerText = parts.join(' \u00b7 ');
          
          var pName = p.full_name || 'Participant';
          var pInitials = (function(){var parts=(pName||'').trim().split(/\s+/);if(parts.length>=2)return(parts[0][0]+(parts[parts.length-1][0])).toUpperCase();return(parts[0]||'?')[0].toUpperCase();})();
          var pStyle = getAvatarStyle(pName);
          var avEl = document.getElementById('prof-avatar');
          if (avEl) {
            avEl.textContent = pInitials;
            avEl.setAttribute('style', pStyle + '; width:70px; height:70px; border-radius:50%; font-size:24px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 8px 20px rgba(0,0,0,0.4); border:2.5px solid rgba(255,255,255,0.06);');
          }
        }
      })
      .catch(function(err) {
        console.warn('Profile details load error:', err);
      });

    var url = SUPABASE_URL + '/rest/v1/activities?strava_athlete_id=eq.' + athleteId + '&is_deleted=is.false&activity_date=gte.2026-06-01&activity_date=lte.2026-06-30&order=activity_date.desc';
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

          var onclickAttr = 'openActivityDetail(\'' + a.strava_activity_id + '\', event, true)';
          card.setAttribute('onclick', onclickAttr);
          
          card.innerHTML = 
            '<div>' +
              '<div style="font-size:14px; font-weight:800; color:#fff;">' + esc(a.activity_name || 'Activity') + '</div>' +
              '<div style="font-size:11.5px; color:var(--muted); margin-top:2px;">' + dateLabel + ' &middot; ' + distVal + ' km &middot; ' + movingMins + ' mins</div>' +
            '</div>' +
            '<div style="font-size:13px; font-weight:700; color:var(--brand); display:flex; align-items:center; gap:2px;">' +
              '<span>' + stepsVal.toLocaleString('en-IN') + '</span> <span style="font-size:10px; color:var(--muted);">steps</span>' +
            '</div>';
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
