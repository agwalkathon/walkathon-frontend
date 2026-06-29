// Global Configuration and State Variables
var SUPABASE_URL = 'https://jhdgkncpkrttvemvwukc.supabase.co';
var BACKEND      = 'https://walkathon-backend-hv9j.onrender.com';
var _currentTab  = 'dashboard';
var _feedData    = [];
var LB_REG       = [];
var LB_ACTS      = [];
var LB_SCORES    = {};
var _lbReady     = false;
var LB_ME        = null;

var _storageMock = {};
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch(e) {
    return _storageMock[key] || null;
  }
}
function safeSetItem(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch(e) {
    _storageMock[key] = val;
  }
}
function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch(e) {
    delete _storageMock[key];
  }
}
var CONFIG_LB    = { 
  basePer_km: 1, 
  bonus: [{km:5,points:1},{km:8,points:2},{km:10,points:3},{km:15,points:4},{km:21,points:7}],
  feed_config: {
    rules: {
      allow_standard_activities: true,
      allow_medals: true,
      allow_distance_clubs: true,
      allow_rank_top1: true,
      allow_flagged_activities: false
    },
    filters: {
      minimum_activity_distance_km: 1.0,
      allowed_sports: ["Walk", "Run", "Hike", "Ride"]
    }
  }
};
var CHALLENGES_LB   = [];
var SPECIAL_DAYS_LB = [];
var CURRENT_ACTS = null;
var CURRENT_DAY_BREAKDOWN = null;
var CURRENT_ACT_BREAKDOWN = null;
var CURRENT_GENDER = null;
var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpoZGdrbmNwa3J0dHZlbXZ3dWtjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzgyNjMsImV4cCI6MjA5NzI1NDI2M30.d7mvXOYDq5G4aqs1Mbc6HFNgTBlQk4B6ah0eahE_yZE';
var HDR = { apikey: ANON, Authorization: 'Bearer ' + ANON };
var currentSession = null;

// Splash Screen Controller
var _splashMinMs = 1500;
var _splashReadyAt = Date.now() + _splashMinMs;
var _splashHideQueued = false;

function hideSplash(){
  var now = Date.now();
  var remaining = _splashReadyAt - now;
  if (remaining > 0) {
    if (!_splashHideQueued) {
      _splashHideQueued = true;
      setTimeout(_doHideSplash, remaining);
    }
  } else {
    _doHideSplash();
  }
}
function _doHideSplash(){
  var sp = document.getElementById('splash-screen');
  if (!sp || sp.style.display === 'none') return;
  sp.style.opacity = '0';
  sp.style.pointerEvents = 'none';
  setTimeout(function(){ 
    sp.style.display = 'none'; 
    sp.style.opacity = '1'; 
    if (_currentTab === 'dashboard') {
      triggerRingAnimation();
    }
  }, 420);
}
function showSplash(){
  var sp = document.getElementById('splash-screen');
  if (!sp) return;
  _splashHideQueued = false;
  _splashReadyAt = Date.now() + _splashMinMs;
  sp.style.display = 'flex';
  sp.style.opacity = '0';
  sp.style.pointerEvents = 'auto';
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){ sp.style.opacity = '1'; });
  });
}

// Global Text and HTML Helpers
function safeSetText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}
function safeSetHtml(id, val) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = val;
}
function safeToggleClass(id, className, force) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle(className, force);
}
function safeSetStyle(id, prop, val) {
  var el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function userGuard() {
  try {
    var s = JSON.parse(safeGetItem('wk_user') || '{}');
    if (!s.loggedIn || !s.athleteId) { window.location.href = 'index.html'; return null; }
    return s;
  } catch(e) {
    window.location.href = 'index.html';
    return null;
  }
}
function logout() { safeRemoveItem('wk_user'); try { sessionStorage.removeItem('wk_admin'); } catch(e){} window.location.href = 'index.html'; }
function esc(v) { return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function getAvatarStyle(name) {
  var colors = [
    { bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.2)', text: 'var(--blue)' },
    { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)', text: 'var(--green)' },
    { bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.2)', text: '#c084fc' },
    { bg: 'rgba(232,98,42,0.1)', border: 'rgba(232,98,42,0.2)', text: 'var(--brand)' },
    { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)', text: '#fbbf24' },
    { bg: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.2)', text: '#2dd4bf' },
    { bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.2)', text: '#fb7185' }
  ];
  var hash = 0;
  var str = name || '';
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  var index = Math.abs(hash) % colors.length;
  var c = colors[index];
  return 'background:' + c.bg + '; border-color:' + c.border + '; color:' + c.text + '; box-shadow: 0 0 8px ' + c.bg + ';';
}
function norm(s){return String(s||'').trim().toLowerCase();}

function getISTDate(d) {
  if (!d) return '';
  try {
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    var localTime = dt.getTime() + (5.5 * 60 * 60 * 1000);
    var istDate = new Date(localTime);
    var y = istDate.getUTCFullYear();
    var m = ('0' + (istDate.getUTCMonth() + 1)).slice(-2);
    var dayVal = ('0' + istDate.getUTCDate()).slice(-2);
    return y + '-' + m + '-' + dayVal;
  } catch (e) {
    return d.split('T')[0];
  }
}
function getActDate(a) {
  if (!a) return '';
  if (a.activity_date_time_ist) {
    return a.activity_date_time_ist.split(/[T ]/)[0];
  }
  return getISTDate(a.activity_date);
}
function fmtTime(d, startTime) {
  if (!d) return '';
  if (startTime === null || startTime === undefined || startTime === '') return '';
  try {
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  } catch (e) {
    var naive = d ? d.replace(/[Zz]$/, '').replace(/\+00:00$/, '') : d;
    return new Date(naive).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
}
function fmtDur(s) { var h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?h+'h '+m+'m':m+'m'; }
function fmtPS(ms,t) { if(!ms) return '—'; if(t==='Ride'||t==='VirtualRide'||t==='MountainBikeRide') return (ms*3.6).toFixed(1)+' km/h'; var p=1000/ms,min=Math.floor(p/60),sec=Math.round(p%60); return min+':'+(sec<10?'0':'')+sec+'/km'; }

function tileClass(t) {
  if(t==='Walk') return 'walk';
  if(t==='Run'||t==='VirtualRun') return 'run';
  if(t==='Ride'||t==='VirtualRide'||t==='MountainBikeRide') return 'ride';
  if(t==='Hike') return 'hike';
  return 'other';
}
var icoWalk='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.7-1.1-1-1.8-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.8l1.8-.9z"/></svg>';
var icoRun='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M19 13v-2c-1.54 0-3.09-.49-4.38-1.46l-1.37-1.03c-.71-.53-1.65-.63-2.45-.25L7 10.12V15h2v-3.56l2.1-.82-.6 3.3L8.2 16.5c-.39.29-.6.76-.56 1.25.07.72.7 1.25 1.42 1.18.35-.03.66-.21.86-.48l1.72-2.3L15 18v4h2v-5.12l-2.9-2.9.6-3.1c1.16.91 2.51 1.43 3.92 1.43zM13.5 5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>';
var icoRide='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M12 17h2l2-5H9l1 3h2"/></svg>';
var icoHike='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l4-10 3 6 2-3 4 7"/><circle cx="9" cy="7" r="2"/></svg>';
var icoBolt='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
function renderIcon(t){var m={'Walk':icoWalk,'Run':icoRun,'VirtualRun':icoRun,'Ride':icoRide,'VirtualRide':icoRide,'MountainBikeRide':icoRide,'Hike':icoHike};return m[t]||icoBolt;}

// Points and Challenge Engine
function calcBonus(km) {
  var result = 0;
  var sorted = CONFIG_LB.bonus.slice().sort(function(a,b){ return b.km-a.km; });
  for (var i=0; i<sorted.length; i++) {
    var bracketKm  = Number(sorted[i].km) || 0;
    var bracketPts = (sorted[i].points !== undefined ? Number(sorted[i].points) : Number(sorted[i].pts)) || 0;
    if (km >= bracketKm) { result = bracketPts; break; }
  }
  return result;
}

function checkChallengeSingle(act, c) {
  var actDate = getActDate(act);
  if (!actDate) return false;
  if (actDate < c.start_date || actDate > c.end_date) return false;

  var validSports = (Array.isArray(c.sport_types) && c.sport_types.length)
    ? c.sport_types : ['Walk','Run','Hike','Ride'];
  if (validSports.indexOf(act.sport_type) === -1) return false;
  if (act.is_flagged) return false;

  var km    = parseFloat(act.distance_meters || 0) / 1000;
  var dMin  = parseFloat(c.distance_min) || 0;
  var dMax  = parseFloat(c.distance_max) || 0;
  var dType = c.distance_type || 'fixed';
  if (dType === 'fixed') {
    if (km < dMin - 0.1 || km > dMax + 0.1) return false;
  } else if (dType === 'range') {
    if (km < dMin || km > dMax) return false;
  } else {
    if (km < dMin) return false;
  }

  var elevReq = parseFloat(c.elevation_criteria) || 0;
  if (elevReq > 0) {
    var actElev = parseFloat(act.elevation_gain || 0);
    if (actElev < elevReq) return false;
  }

  if (c.start_time_criteria) {
    var timeStr = act.start_time || (act.activity_date || '').split('T')[1] || '';
    if (!timeStr || timeStr.startsWith('06:30:00') || timeStr.startsWith('17:30:00') || timeStr.startsWith('18:30:00')) {
      return true;
    }
    
    var critStr = c.start_time_criteria.toUpperCase();
    var isPM = critStr.indexOf('PM') > -1;
    var isAM = critStr.indexOf('AM') > -1;
    var cleanCrit = critStr.replace('AM', '').replace('PM', '').trim();
    
    var parts = cleanCrit.split(':');
    var hr = parseInt(parts[0]) || 0;
    if (isPM && hr < 12) hr += 12;
    if (isAM && hr === 12) hr = 0;
    var critMins = hr * 60 + parseInt(parts[1] || 0);
    
    var tParts   = timeStr.split(':');
    var actMins  = parseInt(tParts[0]) * 60 + parseInt(tParts[1] || 0);
    if (actMins > critMins) return false;
  }

  return true;
}

function calcFullPts(myActs, gender, shift) {
  var athleteId = myActs.length ? myActs[0].strava_athlete_id : null;
  var validActs = myActs.filter(function(a) { return !a.is_flagged; });
  validActs.forEach(function(a) {
    a.base_km = parseFloat(a.distance_meters || 0) / 1000;
  });

  var byDay = {};
  validActs.forEach(function(a) {
    var d = getActDate(a);
    if (!d) return;
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(a);
  });

  var _shiftN = (shift || '').toLowerCase();
  var _isNightShift = _shiftN.indexOf('night') > -1;
  var myChallenges = (Array.isArray(CHALLENGES_LB) ? CHALLENGES_LB : []).filter(function(c) {
    if (!c.is_active) return false;
    var elig = (c.eligible || 'all').toLowerCase();
    if (elig === 'all')        return true;
    if (elig === 'male'      && (gender || '').toLowerCase() === 'male')   return true;
    if (elig === 'female'    && (gender || '').toLowerCase() === 'female') return true;
    if (elig === 'dayshift'  && !_isNightShift) return true;
    if (elig === 'nightshift' && _isNightShift) return true;
    return false;
  });

  var suppressBonusDays    = {};
  var perActivityBonusDays = {};
  myChallenges.forEach(function(c) {
    var nbt         = c.normal_bonus_type || 'no-change';
    var suppress    = (nbt === 'exclude-all' || nbt === 'exclude-sum' || c.exclude_normal_bonus || c.award_type === 'per-act-no-bonus');
    var perActivity = (nbt === 'per-activity');
    if (!suppress && !perActivity) return;
    Object.keys(byDay).forEach(function(day) {
      if (day < c.start_date || day > c.end_date) return;
      var qualifies = byDay[day].some(function(a) { return checkChallengeSingle(a, c); });
      if (!qualifies) return;
      if (suppress)    suppressBonusDays[day]    = true;
      if (perActivity) perActivityBonusDays[day] = true;
    });
  });

  myChallenges.forEach(function(c) {
    var atype = c.range_split ? 'range-split'
      : c.exclude_normal_bonus ? 'per-act-no-bonus'
      : (c.award_type === 'two-challenges-same-day') ? 'two-challenges-same-day'
      : (parseFloat(c.per_activity_points) > 0 || c.award_type === 'per-act') ? 'per-act'
      : 'one-time';
    if (atype !== 'per-act-no-bonus') return;
    Object.keys(byDay).forEach(function(day) {
      byDay[day].forEach(function(a) {
        if (checkChallengeSingle(a, c)) suppressBonusDays[day] = true;
      });
    });
  });

  var tcDays   = {};
  var tcActMap = {};
  myChallenges.filter(function(c){ return c.award_type === 'two-challenges-same-day'; })
    .forEach(function(c) {
      Object.keys(byDay).forEach(function(day) {
        if (day < c.start_date || day > c.end_date) return;
        tcDays[day] = true;
        if (!tcActMap[day]) tcActMap[day] = {};
        var sorted = byDay[day].slice().sort(function(a,b){
          return (a.activity_date||'').localeCompare(b.activity_date||'');
        });
        for (var ti = 0; ti < sorted.length; ti++) {
          var a = sorted[ti];
          if (tcActMap[day][a.strava_activity_id]) continue;
          if (a.is_flagged) continue;
          var tcKm     = parseFloat(a.distance_meters || 0) / 1000;
          var tcMin    = parseFloat(c.distance_min) || 0;
          var tcMax    = parseFloat(c.distance_max) || 0;
          var tcType   = c.distance_type || 'fixed';
          var tcSports = (Array.isArray(c.sport_types) && c.sport_types.length) ? c.sport_types : ['Walk','Run','Hike','Ride'];
          if (tcSports.indexOf(a.sport_type) === -1) continue;
          var tcPass = false;
          if (tcType === 'fixed')      tcPass = tcKm >= tcMin - 0.1 && tcKm <= tcMax + 0.1;
          else if (tcType === 'range') tcPass = tcKm >= tcMin && tcKm <= tcMax;
          else                         tcPass = tcKm >= tcMin;
          if (!tcPass) continue;
          tcActMap[day][a.strava_activity_id] = { km: tcKm, challenge: c };
          break;
        }
      });
    });

  var totalDistKm  = 0;
  var totalDistPts = 0;
  var totalBonus   = 0;
  var DAILY_CAP    = 21;
  var dayBreakdown = {};
  var actBreakdown = {};

  Object.keys(byDay).forEach(function(day) {
    var dayActs   = byDay[day];
    var isSpecial = SPECIAL_DAYS_LB.indexOf(day) !== -1;
    var isTcDay = tcDays[day] || false;

    if (isTcDay) {
      var tcMap      = tcActMap[day] || {};
      var tcBonusPts = 0;
      var allDayKm   = 0;
      dayActs.forEach(function(a){ allDayKm += a.base_km; });

      var qualKmTotal = 0;
      Object.keys(tcMap).forEach(function(aid){ qualKmTotal += tcMap[aid].km; });
      var remainKm = Math.max(0, allDayKm - qualKmTotal);

      if (!isSpecial && allDayKm > DAILY_CAP) {
        var excess  = allDayKm - DAILY_CAP;
        var remTrim = Math.min(excess, remainKm);
        remainKm   -= remTrim;
      }
      remainKm = Math.max(0, parseFloat(remainKm.toFixed(4)));

      var base2     = parseFloat(CONFIG_LB.basePer_km) || 1;
      var dayDistKm = qualKmTotal + remainKm;
      if (!isSpecial && dayDistKm > DAILY_CAP) {
        dayDistKm = DAILY_CAP;
      }
      totalDistKm  += dayDistKm;
      totalDistPts += parseFloat((dayDistKm * base2).toFixed(2));

      Object.keys(tcMap).forEach(function(aid){ tcBonusPts += calcBonus(tcMap[aid].km); });
      tcBonusPts += calcBonus(remainKm);
      totalBonus += tcBonusPts;

      byDay[day]._outRangeKm = remainKm;
      byDay[day]._inRangeKm  = 0;
      byDay[day]._tcMap      = tcMap;
      byDay[day]._tcRemainKm = remainKm;
      dayBreakdown[day] = {
        km: dayDistKm, distPts: parseFloat((dayDistKm * base2).toFixed(2)),
        bonusPts: tcBonusPts, challenges: [], inRangeKm: 0, capped: (!isSpecial && allDayKm > DAILY_CAP)
      };
      return;
    }

    var rsChallenge = null;
    for (var ri = 0; ri < myChallenges.length; ri++) {
      var rc = myChallenges[ri];
      if (rc.range_split && day >= rc.start_date && day <= rc.end_date) { rsChallenge = rc; break; }
    }

    var inRangeKm  = 0;
    var outRangeKm = 0;
    dayActs.forEach(function(a) {
      var km = a.base_km;
      if (rsChallenge) {
        var cST  = (Array.isArray(rsChallenge.sport_types) && rsChallenge.sport_types.length)
          ? rsChallenge.sport_types : ['Walk','Run','Hike','Ride'];
        var dMin = parseFloat(rsChallenge.distance_min) || 0;
        var dMax = parseFloat(rsChallenge.distance_max) || 0;
        if (cST.indexOf(a.sport_type) > -1 && km >= dMin - 0.1 && km <= dMax) {
          inRangeKm += km; return;
        }
      }
      outRangeKm += km;
    });

    var combined = inRangeKm + outRangeKm;
    if (!isSpecial && combined > DAILY_CAP) {
      var excess  = combined - DAILY_CAP;
      var outTrim = Math.min(excess, outRangeKm);
      outRangeKm -= outTrim; excess -= outTrim;
      if (excess > 0) inRangeKm -= excess;
    }
    inRangeKm  = Math.max(0, parseFloat(inRangeKm.toFixed(4)));
    outRangeKm = Math.max(0, parseFloat(outRangeKm.toFixed(4)));

    var base      = parseFloat(CONFIG_LB.basePer_km) || 1;
    var dayDistKm = inRangeKm + outRangeKm;
    totalDistKm  += dayDistKm;
    totalDistPts += parseFloat((dayDistKm * base).toFixed(2));

    var bp;
    if (suppressBonusDays[day]) {
      bp = 0;
    } else if (perActivityBonusDays[day]) {
      bp = 0;
      dayActs.forEach(function(a) {
        if (!a.is_flagged) bp += calcBonus(parseFloat(a.distance_meters||0)/1000);
      });
    } else {
      bp = calcBonus(outRangeKm);
    }
    totalBonus += bp;

    byDay[day]._outRangeKm = outRangeKm;
    byDay[day]._inRangeKm  = inRangeKm;
    dayBreakdown[day] = {
      km: dayDistKm, distPts: parseFloat((dayDistKm * base).toFixed(2)),
      bonusPts: bp, challenges: [], inRangeKm: inRangeKm, capped: (!isSpecial && combined > DAILY_CAP)
    };
  });

  totalDistKm  = parseFloat(totalDistKm.toFixed(2));
  totalDistPts = parseFloat(totalDistPts.toFixed(2));

  var totalChallenge = 0;
  var earnedChallenges = {};
  var earnedPts = {};

  function recalcDayBase(day) {
    var dayActs = byDay[day] || [];
    var isSpecial = SPECIAL_DAYS_LB.indexOf(day) !== -1;
    var isTcDay = tcDays[day] || false;
    var baseVal = parseFloat(CONFIG_LB.basePer_km) || 1;

    if (isTcDay) {
      var tcMap = tcActMap[day] || {};
      var allDayKm = 0;
      dayActs.forEach(function(a){ allDayKm += a.base_km; });

      var qualKmTotal = 0;
      Object.keys(tcMap).forEach(function(aid){ 
        var actObj = validActs.find(function(a){ return String(a.strava_activity_id) === String(aid); });
        qualKmTotal += actObj ? actObj.base_km : tcMap[aid].km; 
      });
      var remainKm = Math.max(0, allDayKm - qualKmTotal);

      if (!isSpecial && allDayKm > DAILY_CAP) {
        var excess  = allDayKm - DAILY_CAP;
        var remTrim = Math.min(excess, remainKm);
        remainKm   -= remTrim;
      }
      remainKm = Math.max(0, parseFloat(remainKm.toFixed(4)));
      return qualKmTotal + remainKm;
    }

    var rsChallenge = null;
    for (var ri = 0; ri < myChallenges.length; ri++) {
      var rc = myChallenges[ri];
      if (rc.range_split && day >= rc.start_date && day <= rc.end_date) { rsChallenge = rc; break; }
    }

    var inRangeKm  = 0;
    var outRangeKm = 0;
    dayActs.forEach(function(a) {
      var km = a.base_km;
      if (rsChallenge) {
        var cST  = (Array.isArray(rsChallenge.sport_types) && rsChallenge.sport_types.length)
          ? rsChallenge.sport_types : ['Walk','Run','Hike','Ride'];
        var dMin = parseFloat(rsChallenge.distance_min) || 0;
        var dMax = parseFloat(rsChallenge.distance_max) || 0;
        if (cST.indexOf(a.sport_type) > -1 && km >= dMin - 0.1 && km <= dMax) {
          inRangeKm += km; return;
        }
      }
      outRangeKm += km;
    });

    var combined = inRangeKm + outRangeKm;
    if (!isSpecial && combined > DAILY_CAP) {
      var excess  = combined - DAILY_CAP;
      var outTrim = Math.min(excess, outRangeKm);
      outRangeKm -= outTrim; excess -= outTrim;
      if (excess > 0) inRangeKm -= excess;
    }
    inRangeKm  = Math.max(0, parseFloat(inRangeKm.toFixed(4)));
    outRangeKm = Math.max(0, parseFloat(outRangeKm.toFixed(4)));

    return inRangeKm + outRangeKm;
  }

  function applyMaxBaseCap(challengeObj, dayStr, actIdStr) {
    var maxBase = parseFloat(challengeObj.max_base_points);
    if (isNaN(maxBase) || maxBase === null || maxBase === undefined) return;
    var baseVal = parseFloat(CONFIG_LB.basePer_km) || 1;
    if (!dayBreakdown[dayStr]) return;
    
    var oldDayKm = dayBreakdown[dayStr].km;
    
    if (challengeObj.activity_scope === 'daily') {
      var newDayKm = Math.min(oldDayKm, maxBase / baseVal);
      var diffKm = oldDayKm - newDayKm;
      if (diffKm > 0) {
        dayBreakdown[dayStr].km = newDayKm;
        dayBreakdown[dayStr].distPts = parseFloat((newDayKm * baseVal).toFixed(2));
        totalDistKm -= diffKm;
        totalDistPts -= (diffKm * baseVal);
      }
    } else if (actIdStr) {
      var qualifyingAct = validActs.find(function(a) { return String(a.strava_activity_id) === String(actIdStr); });
      if (qualifyingAct) {
        var cappedKm = maxBase / baseVal;
        if (qualifyingAct.base_km > cappedKm) {
          qualifyingAct.base_km = cappedKm;
          var newDayKm = recalcDayBase(dayStr);
          var diffKm = oldDayKm - newDayKm;
          if (diffKm > 0) {
            dayBreakdown[dayStr].km = newDayKm;
            dayBreakdown[dayStr].distPts = parseFloat((newDayKm * baseVal).toFixed(2));
            totalDistKm -= diffKm;
            totalDistPts -= (diffKm * baseVal);
          }
        }
      }
    }
  }

  var processedManualActIds = new Set();

  myChallenges.forEach(function(c) {
    var bp2   = parseFloat(c.bonus_points) || 0;
    var cName = c.name || 'Challenge';
    var key   = 'ch_' + (c.id || c.name);

    if (c.distance_type === 'manual') {
      var mTotal = 0;
      validActs.forEach(function(a) {
        if (a.description === cName && (parseFloat(a.manual_bonus) > 0)) {
          mTotal += bp2;
          processedManualActIds.add(String(a.strava_activity_id));
          
          var d = getActDate(a);
          if (dayBreakdown[d]) {
            dayBreakdown[d].challenges.push({name: cName, pts: bp2, actId: a.strava_activity_id});
          }
          if (!actBreakdown[a.strava_activity_id]) {
            actBreakdown[a.strava_activity_id] = {challenges:[]};
          }
          actBreakdown[a.strava_activity_id].challenges.push({name: cName, pts: bp2});
          applyMaxBaseCap(c, d, a.strava_activity_id);
        }
      });
      if (mTotal > 0) {
        totalChallenge += mTotal;
        earnedChallenges[key] = true;
        earnedPts[key] = mTotal;
      }
      return;
    }

    var atype = c.range_split ? 'range-split'
      : c.exclude_normal_bonus ? 'per-act-no-bonus'
      : (c.award_type === 'two-challenges-same-day') ? 'two-challenges-same-day'
      : (parseFloat(c.per_activity_points) > 0 || c.award_type === 'per-act') ? 'per-act'
      : 'one-time';

    if (atype === 'two-challenges-same-day') {
      Object.keys(tcActMap).forEach(function(day) {
        Object.keys(tcActMap[day]).forEach(function(aid) {
          if (tcActMap[day][aid].challenge.id === c.id) {
            totalChallenge += bp2; earnedChallenges[key] = true; earnedPts[key] = (earnedPts[key]||0) + bp2;
            if (dayBreakdown[day]) dayBreakdown[day].challenges.push({name:cName, pts:bp2, actId:aid});
            if (!actBreakdown[aid]) actBreakdown[aid] = {challenges:[]};
            actBreakdown[aid].challenges.push({name:cName, pts:bp2});
            applyMaxBaseCap(c, day, aid);
          }
        });
      });
      return;
    }

    if (atype === 'range-split') {
      var rsTotal = 0;
      validActs.forEach(function(a) {
        if (checkChallengeSingle(a, c)) {
          rsTotal += bp2;
          var d = getActDate(a);
          if (dayBreakdown[d]) dayBreakdown[d].challenges.push({name:cName, pts:bp2, actId:a.strava_activity_id});
          if (!actBreakdown[a.strava_activity_id]) actBreakdown[a.strava_activity_id] = {challenges:[]};
          actBreakdown[a.strava_activity_id].challenges.push({name:cName, pts:bp2});
          applyMaxBaseCap(c, d, a.strava_activity_id);
        }
      });
      if (rsTotal > 0) { totalChallenge += rsTotal; earnedChallenges[key] = true; earnedPts[key] = rsTotal; }
      return;
    }

    if (atype === 'per-act' || atype === 'per-act-no-bonus') {
      var paTotal = 0;
      validActs.forEach(function(a) {
        if (checkChallengeSingle(a, c)) {
          paTotal += bp2;
          var d = getActDate(a);
          if (dayBreakdown[d]) dayBreakdown[d].challenges.push({name:cName, pts:bp2, actId:a.strava_activity_id});
          if (!actBreakdown[a.strava_activity_id]) actBreakdown[a.strava_activity_id] = {challenges:[]};
          actBreakdown[a.strava_activity_id].challenges.push({name:cName, pts:bp2});
        }
      });
      if (paTotal > 0) { totalChallenge += paTotal; earnedChallenges[key] = true; earnedPts[key] = paTotal; }
      return;
    }

    var awarded = false; var awardedDay = null; var awardedActId = null;
    if (c.activity_scope === 'daily') {
      Object.keys(byDay).forEach(function(day) {
        if (awarded) return;
        if (day < c.start_date || day > c.end_date) return;
        var sports = (Array.isArray(c.sport_types) && c.sport_types.length)
          ? c.sport_types : ['Walk','Run','Hike','Ride'];
        var dMin  = parseFloat(c.distance_min) || 0;
        var dMax  = parseFloat(c.distance_max) || 0;
        var dType = c.distance_type || 'fixed';
        var dKm   = 0;
        byDay[day].forEach(function(a) {
          if (sports.indexOf(a.sport_type) > -1) dKm += parseFloat(a.distance_meters || 0) / 1000;
        });
        var q = false;
        if (dType === 'fixed')      q = dKm >= dMin - 0.1 && dKm <= dMax + 0.1;
        else if (dType === 'range') q = dKm >= dMin && dKm <= dMax;
        else                        q = dKm >= dMin;
        if (q) { awarded = true; awardedDay = day; }
      });
    } else {
      for (var ai = 0; ai < validActs.length; ai++) {
        if (checkChallengeSingle(validActs[ai], c)) {
          awarded = true;
          awardedActId = validActs[ai].strava_activity_id;
          awardedDay   = getActDate(validActs[ai]);
          break;
        }
      }
    }

    if (awarded) {
      totalChallenge += bp2; earnedChallenges[key] = true; earnedPts[key] = bp2;
      if (awardedDay && dayBreakdown[awardedDay])
        dayBreakdown[awardedDay].challenges.push({name:cName, pts:bp2, actId:awardedActId});
      if (awardedActId) {
        if (!actBreakdown[awardedActId]) actBreakdown[awardedActId] = {challenges:[]};
        actBreakdown[awardedActId].challenges.push({name:cName, pts:bp2});
      }
      applyMaxBaseCap(c, awardedDay, awardedActId);
    }
  });

  validActs.forEach(function(a) {
    if (processedManualActIds.has(String(a.strava_activity_id))) return;
    var mb = parseFloat(a.manual_bonus) || 0;
    if (!mb) return;
    totalChallenge += mb;
    var d = getActDate(a);
    var mbName = a.description || 'Manual bonus';
    if (dayBreakdown[d]) dayBreakdown[d].challenges.push({name:mbName, pts:mb, actId:a.strava_activity_id});
    if (!actBreakdown[a.strava_activity_id]) actBreakdown[a.strava_activity_id] = {challenges:[]};
    actBreakdown[a.strava_activity_id].challenges.push({name:mbName, pts:mb});
  });

  totalChallenge = parseFloat(totalChallenge.toFixed(2));
  return {
    km: totalDistKm, distPts: totalDistPts, bonusPts: totalBonus,
    challengePts: totalChallenge,
    total: parseFloat((totalDistPts + totalBonus + totalChallenge).toFixed(2)),
    dayBreakdown: dayBreakdown, actBreakdown: actBreakdown,
    earnedPts: earnedPts, earnedChallenges: earnedChallenges
  };
}
