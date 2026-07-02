// API Fetchers and Offline Caching Engine

async function fetchAll(url) {
  var all=[],from=0,ps=1000;
  while(true){
    var sep=url.indexOf('?')>-1?'&':'?';
    var r=await fetch(url+sep+'limit='+ps+'&offset='+from,{headers:Object.assign({},HDR,{'Range-Unit':'items','Range':from+'-'+(from+ps-1)})});
    if(!r.ok)break;
    var page=await r.json();
    if(!Array.isArray(page)||!page.length)break;
    all=all.concat(page);
    if(page.length<ps)break;
    from+=ps;
  }
  return all;
}

async function fetchAllParallel(url) {
  var sep = url.indexOf('?') > -1 ? '&' : '?';
  var countHeaders = Object.assign({}, HDR, { 'Prefer': 'count=exact' });
  try {
    var countRes = await fetch(url + sep + 'limit=1', { headers: countHeaders });
    if (!countRes.ok) {
      return fetchAll(url);
    }
    var contentRange = countRes.headers.get('content-range');
    var total = 0;
    if (contentRange) {
      var parts = contentRange.split('/');
      if (parts.length > 1) total = parseInt(parts[1]) || 0;
    }
    if (total === 0) return [];
    
    var ps = 1000;
    var promises = [];
    for (var from = 0; from < total; from += ps) {
      var pageUrl = url + sep + 'limit=' + ps + '&offset=' + from;
      var pageHeaders = Object.assign({}, HDR, { 'Range-Unit': 'items', 'Range': from + '-' + (from + ps - 1) });
      promises.push(
        fetch(pageUrl, { headers: pageHeaders }).then(function(r) {
          if (!r.ok) throw new Error("Page fetch failed: " + r.status);
          return r.json();
        })
      );
    }
    var results = await Promise.all(promises);
    var all = [];
    results.forEach(function(page) {
      if (Array.isArray(page)) all = all.concat(page);
    });
    return all;
  } catch(e) {
    console.warn('[Cache] fetchAllParallel error, falling back to sequential:', e);
    return fetchAll(url);
  }
}

// Caching Layer
var CACHE_TTL = { personal: 5*60*1000, config: 10*60*1000, ranking: 5*60*1000, reg: 30*60*1000 };
function cacheSet(key, data) {
  safeSetItem('agwalk_' + key, JSON.stringify({ ts: Date.now(), data: data }));
}
function cacheGet(key, ttl) {
  var raw = safeGetItem('agwalk_' + key);
  if (!raw) return null;
  try {
    var obj = JSON.parse(raw);
    if (Date.now() - obj.ts > ttl) return null;
    return obj.data;
  } catch(e) { return null; }
}
function cacheClear(athleteId) {
  var keys = ['reg_'+athleteId,'acts_v3_'+athleteId,'config','challenges','special_days','medals','ranking_acts_v3','ranking_reg'];
  keys.forEach(function(k){ safeRemoveItem('agwalk_'+k); });
  console.log('[Cache] Cleared for athlete', athleteId);
}

// Cache migrations
safeRemoveItem('agwalk_ranking_acts');

function getRegistrationFetchUrl(s) {
  var athleteId = s.athleteId;
  if (!athleteId || athleteId === 'null' || athleteId === 'undefined') {
    if (s.empCode) {
      return SUPABASE_URL + '/rest/v1/registration?emp_code=eq.' + encodeURIComponent(s.empCode) + '&select=*';
    }
    if (s.email) {
      return SUPABASE_URL + '/rest/v1/registration?email=eq.' + encodeURIComponent(s.email) + '&select=*';
    }
  }
  return SUPABASE_URL + '/rest/v1/registration?strava_athlete_id=eq.' + athleteId + '&select=*';
}

// Main Application Loader
async function load(isBackgroundRefresh) {
  // Handle Strava OAuth callback
  var oauthCode = new URLSearchParams(window.location.search).get('code');
  if (oauthCode) {
    window.history.replaceState({}, '', window.location.pathname);
    var splashText = document.getElementById('splash-text');
    if (splashText) {
      splashText.textContent = 'Connecting your Strava account...';
      splashText.style.display = 'block';
    }
    
    var session = {};
    try {
      session = JSON.parse(safeGetItem('wk_user') || '{}');
    } catch(e) {}
    var sessionEmpCode = session.empCode || '';
    var sessionEmail = session.email || '';

    try {
      var res = await fetch(BACKEND + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: oauthCode, 
          event_code: 'walkathon2026',
          emp_code: sessionEmpCode,
          email: sessionEmail
        })
      });
      var d = await res.json();
      if (d.success) {
        safeSetItem('wk_user', JSON.stringify({
          loggedIn: true,
          role: d.role || 'user',
          athleteId: d.athlete_id,
          name: d.name,
          profilePhoto: d.profile_photo || '',
          empCode: sessionEmpCode || d.emp_code || '',
          email: sessionEmail || d.email || '',
          expires: Date.now() + (8 * 60 * 60 * 1000)
        }));
        if (splashText) {
          splashText.textContent = 'Connection successful! Loading dashboard...';
        }
        await new Promise(function(resolve) { setTimeout(resolve, 800); });
      } else {
        var errMsg = d.error === 'not_registered'
          ? '⛔ Not registered. Your Strava account is not in the participant list.'
          : '❌ Strava connection failed. Please try again.';
        alert(errMsg);
      }
    } catch (err) {
      console.error('Strava registration failed:', err);
      alert('❌ Connection error. Please try again.');
    }
  }

  var s;
  var urlParams = new URLSearchParams(window.location.search);
  var urlActivityId = urlParams.get('activityId');
  if (urlActivityId) {
    try {
      s = JSON.parse(safeGetItem('wk_user') || '{}');
    } catch(e) {
      s = {};
    }
    if (!s || !s.loggedIn || !s.athleteId) {
      s = { loggedIn: true, athleteId: '12345', name: 'Tester', role: 'user' };
    }
  } else {
    s = userGuard();
    if (!s) return;
  }
  currentSession = s;
  var athleteId = s.athleteId;

  // ── Maintenance mode gate — block immediately if enabled ────────────────
  var _maintBlocked = await checkMaintenanceGate(athleteId);
  if (_maintBlocked) return;

  loadNotifications();
  try {
    // ── Phase 1: Load personal data with cache ────────────────────────────────
    var _cachedReg   = cacheGet('reg_'+athleteId, CACHE_TTL.reg);
    var _cachedActs  = cacheGet('acts_v3_'+athleteId, CACHE_TTL.personal);
    var _cachedCfg   = cacheGet('config', CACHE_TTL.config);
    var _cachedCh    = cacheGet('challenges', CACHE_TTL.config);
    var _cachedSd    = cacheGet('special_days', CACHE_TTL.config);
    var _cachedMedal = cacheGet('medals', CACHE_TTL.config);
    var _allFromCache = _cachedReg && _cachedActs && _cachedCfg && _cachedCh && _cachedSd && _cachedMedal;

    if (_allFromCache && !isBackgroundRefresh) {
      setTimeout(function(){
        Promise.all([
          fetch(getRegistrationFetchUrl(s),{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('reg_'+athleteId,d);}),
          fetchAll(SUPABASE_URL+'/rest/v1/activities?strava_athlete_id=eq.'+athleteId+'&is_deleted=is.false&activity_date=gte.2026-05-31T18:30:00Z&activity_date=lte.2026-06-30T18:30:00Z&order=activity_date.desc').then(function(d){cacheSet('acts_v3_'+athleteId,d);}),
          fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?select=config_key,config_value',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('config',d);}),
          fetch(SUPABASE_URL+'/rest/v1/challenges?is_active=is.true&select=*',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('challenges',d);}),
          fetch(SUPABASE_URL+'/rest/v1/special_scoring_days?select=special_date',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('special_days',d);}),
          fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?config_key=eq.medals&select=config_value',{headers:HDR}).then(function(r){return r.json();}).then(function(d){cacheSet('medals',d);})
        ]).then(function(){
          function doReload() {
            if (_touchInteracting) {
              console.log('[Cache] User is interacting, deferring dashboard background reload...');
              setTimeout(doReload, 300);
            } else {
              console.log('[Cache] Phase 1 background refresh complete. Re-rendering dashboard UI...');
              load(true);
            }
          }
          doReload();
        }).catch(function(e){console.warn('[Cache] Background refresh failed:', e);});
      }, 200);
    }
    var regJsonData, myActs, cfgRows, chRows, sdRows, medalData;
    if (_allFromCache) {
      console.log('[Cache] Serving Phase 1 from cache ✓');
      regJsonData  = _cachedReg;
      myActs       = _cachedActs;
      cfgRows      = _cachedCfg;
      chRows       = _cachedCh;
      sdRows       = _cachedSd;
      medalData    = _cachedMedal;
    } else {
      console.log('[Cache] Cache miss — fetching Phase 1 from Supabase...');
      var [regRes,myActsFetched,cfgRes,chRes,sdRes,medalRes]=await Promise.all([
        fetch(getRegistrationFetchUrl(s),{headers:HDR}),
        fetchAll(SUPABASE_URL+'/rest/v1/activities?strava_athlete_id=eq.'+athleteId+'&is_deleted=is.false&activity_date=gte.2026-05-31T18:30:00Z&activity_date=lte.2026-06-30T18:30:00Z&order=activity_date.desc'),
        fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?select=config_key,config_value',{headers:HDR}),
        fetch(SUPABASE_URL+'/rest/v1/challenges?is_active=is.true&select=*',{headers:HDR}),
        fetch(SUPABASE_URL+'/rest/v1/special_scoring_days?select=special_date',{headers:HDR}),
        fetch(SUPABASE_URL+'/rest/v1/leaderboard_config?config_key=eq.medals&select=config_value',{headers:HDR})
      ]);
      regJsonData = await regRes.json(); cacheSet('reg_'+athleteId, regJsonData);
      myActs      = myActsFetched;       cacheSet('acts_v3_'+athleteId, myActs);
      cfgRows     = await cfgRes.json(); cacheSet('config', cfgRows);
      chRows      = await chRes.json();  cacheSet('challenges', chRows);
      sdRows      = await sdRes.json();  cacheSet('special_days', sdRows);
      medalData   = await medalRes.json(); cacheSet('medals', medalData);
    }
    var allActs=[],allRegRes=[];
    if(Array.isArray(cfgRows)) {
      cfgRows.forEach(function(row){
        if(row.config_key==='bonus_points') CONFIG_LB.bonus=row.config_value.map(function(b){return{km:Number(b.km),points:Number(b.points||b.pts||0)};});
        if(row.config_key==='base_points') CONFIG_LB.basePer_km=parseFloat(row.config_value.per_km||1);
        if(row.config_key==='base_points_per_km') CONFIG_LB.basePer_km=parseFloat(row.config_value)||1;
        if(row.config_key==='announcements_enabled') CONFIG_LB.announcements_enabled=(row.config_value===true||row.config_value==='true');
        if(row.config_key==='maintenance_mode') CONFIG_LB.maintenance_mode=(row.config_value===true||row.config_value==='true');
        if(row.config_key==='maintenance_message') CONFIG_LB.maintenance_message=(typeof row.config_value==='string'?row.config_value:'')||'';
        if(row.config_key==='feed_config') {
          try {
            CONFIG_LB.feed_config = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
          } catch(e) { console.error("Failed to parse feed_config:", e); }
        }
      });
    }

    if (window.enforceForceInstallPWA) {
      window.enforceForceInstallPWA();
    }
    if (window.checkPushSubscriptionState) {
      window.checkPushSubscriptionState();
    }
    initializeFeedTab(CONFIG_LB.announcements_enabled);
    if (CONFIG_LB.announcements_enabled) {
      loadFeed().catch(function(e) { console.warn('Failed initial loadFeed:', e); });
    }
    CHALLENGES_LB=Array.isArray(chRows)?chRows:[];
    SPECIAL_DAYS_LB=Array.isArray(sdRows)?sdRows.map(function(x){return x.special_date;}):[];
    var regs=regJsonData; var reg=Array.isArray(regs)&&regs.length?regs[0]:{};
    LB_ME=reg;
    var name=reg.full_name||s.name||'Participant';

    var initials=(function(){var parts=(name||'').trim().split(/\s+/);if(parts.length>=2)return(parts[0][0]+(parts[parts.length-1][0])).toUpperCase();return(parts[0]||'?')[0].toUpperCase();})();
    var avatarEl=document.getElementById('hdr-avatar');if(avatarEl)avatarEl.textContent=initials;
    var youAvatarEl=document.getElementById('you-avatar');if(youAvatarEl)youAvatarEl.textContent=initials;
    var youNameEl=document.getElementById('you-name');if(youNameEl)youNameEl.textContent=name.toUpperCase();
    if(document.getElementById('you-emp-code'))document.getElementById('you-emp-code').textContent=reg.emp_code||'—';
    if(document.getElementById('you-email'))document.getElementById('you-email').textContent=reg.email||'—';
    if(document.getElementById('you-gender'))document.getElementById('you-gender').textContent=reg.gender||'—';
    if(document.getElementById('you-shift'))document.getElementById('you-shift').textContent=reg.shift||'—';
    if(document.getElementById('you-team'))document.getElementById('you-team').textContent=reg.leaderboard_team||'—';
    if(document.getElementById('you-tshirt'))document.getElementById('you-tshirt').textContent=reg.tshirt_size||'—';
    if(document.getElementById('you-project-lead'))document.getElementById('you-project-lead').textContent=reg.project_lead||'—';
    var allowPrivate = (typeof CONFIG_LB !== 'undefined' && CONFIG_LB.feed_config && CONFIG_LB.feed_config.rules && CONFIG_LB.feed_config.rules.allow_private_profiles !== undefined) ? CONFIG_LB.feed_config.rules.allow_private_profiles : true;
    var privateRow = document.getElementById('you-private-row');
    if (privateRow) {
      privateRow.style.display = allowPrivate ? 'flex' : 'none';
    }
    var privateToggle = document.getElementById('you-private-toggle');
    if (privateToggle) {
      privateToggle.checked = (reg.is_private === true || reg.is_private === 'true') && allowPrivate;
    }
    var stravaLink=document.getElementById('you-strava-link');
    if(stravaLink){var surl=reg.strava_profile_url||('https://www.strava.com/athletes/'+s.athleteId);stravaLink.href=surl;}

    window.setStravaConnectedState = function() {
      var btn = document.getElementById('btn-strava-connect');
      var msg = document.getElementById('strava-connect-msg');
      if (!btn) return;
      btn.style.background = 'rgba(16, 185, 129, 0.12)';
      btn.style.backdropFilter = 'blur(16px)';
      btn.style.webkitBackdropFilter = 'blur(16px)';
      btn.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      btn.style.color = '#10b981';
      btn.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.15)';
      btn.style.pointerEvents = 'none';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; color:#10b981;">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Strava Connected
      `;
      btn.removeAttribute('onclick');
      if (msg) msg.style.display = 'none';
    };

    (async function() {
      var athleteId = reg.strava_athlete_id || (currentSession && currentSession.athleteId);
      if (!athleteId) return;
      try {
        var res = await fetch(BACKEND + '/check-authorized', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ athlete_id: athleteId })
        });
        var d = await res.json();
        if (d.success && d.authorized) {
          window.setStravaConnectedState();
          window.isStravaConnected = true;
        } else {
          window.isStravaConnected = false;
        }
        updateInAppNotificationBanner();
        renderNotifications();
      } catch (err) {
        console.warn('Silent connection check failed:', err);
      }
    })();

    window.handleStravaConnect = async function(e) {
      if (e) e.preventDefault();
      var btn = document.getElementById('btn-strava-connect');
      var msg = document.getElementById('strava-connect-msg');
      if (!btn) return;
      
      var athleteId = reg.strava_athlete_id || (currentSession && currentSession.athleteId);
      if (!athleteId) {
        alert('Employee data not loaded. Please log in again.');
        return;
      }
      
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.7';
      btn.innerHTML = 'Verifying connection status...';
      if (msg) msg.style.display = 'none';
      
      try {
        var res = await fetch(BACKEND + '/check-authorized', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ athlete_id: athleteId })
        });
        var d = await res.json();
        
        if (d.success && d.authorized) {
          window.setStravaConnectedState();
        } else {
          var CLIENT_ID = '29159';
          var REDIRECT = window.location.origin + window.location.pathname;
          window.location.href = 'https://www.strava.com/oauth/authorize?client_id=' + CLIENT_ID + 
            '&redirect_uri=' + encodeURIComponent(REDIRECT) + 
            '&response_type=code&scope=read,activity:read&state=walkathon2026';
        }
      } catch (err) {
        console.warn('Connection check failed:', err);
        if (msg) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(245, 158, 11, 0.08)';
          msg.style.borderColor = 'rgba(245, 158, 11, 0.2)';
          msg.style.color = '#f59e0b';
          msg.innerHTML = '⚠️ Connection check failed. Redirecting to Strava...';
        }
        setTimeout(function() {
          var CLIENT_ID = '29159';
          var REDIRECT = window.location.origin + window.location.pathname;
          window.location.href = 'https://www.strava.com/oauth/authorize?client_id=' + CLIENT_ID + 
            '&redirect_uri=' + encodeURIComponent(REDIRECT) + 
            '&response_type=code&scope=read,activity:read&state=walkathon2026';
        }, 1500);
      }
    };

    var icoMale='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="6"/><line x1="14.5" y1="9.5" x2="21" y2="3"/><polyline points="16 3 21 3 21 8"/></svg>';
    var icoFemale='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="6"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/></svg>';
    var icoClock='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    var icoTeam='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    var tags=[];
    if(reg.gender)tags.push(reg.gender==='Female'?icoFemale+' Female':icoMale+' Male');
    if(reg.shift)tags.push(icoClock+' '+reg.shift);
    if(reg.leaderboard_team)tags.push(icoTeam+' '+reg.leaderboard_team);
    var tagHtml=tags.map(function(t){var sp=t.indexOf('</svg>');return sp>=0?'<span class="hero-tag">'+t.substring(0,sp+6)+' '+esc(t.substring(sp+6).trim())+'</span>':'<span class="hero-tag">'+esc(t)+'</span>';}).join('');
    var youTagsEl=document.getElementById('you-tags');if(youTagsEl)youTagsEl.innerHTML=tagHtml;

    (function(){
      var validA=myActs.filter(function(a){return !a.is_flagged;});
      var EVENT_START=new Date('2026-06-01T00:00:00+05:30');
      var EVENT_END=new Date('2026-06-30T23:59:59+05:30');
      var nowD=new Date();
      var totalEventDays=Math.round((Math.min(nowD,EVENT_END)-EVENT_START)/86400000)+1;
      var activeDaysSet={};
      validA.forEach(function(a){var d=getActDate(a);if(d)activeDaysSet[d]=true;});
      var activeDayCount=Object.keys(activeDaysSet).length;
      var consistPct=totalEventDays>0?Math.round((activeDayCount/totalEventDays)*100):0;
      var ade=document.getElementById('you-active-days');if(ade)ade.textContent=activeDayCount;
      var ede=document.getElementById('you-event-days');if(ede)ede.textContent='of '+totalEventDays+' event days';
      var cpe=document.getElementById('you-consistency');if(cpe)cpe.textContent=consistPct+'%';
      var cfe=document.getElementById('you-consist-fill');if(cfe)setTimeout(function(){cfe.style.width=consistPct+'%';},100);

      setTimeout(function(){
        var curS=document.getElementById('streak-num');
        var bestS=document.getElementById('streak-best-val');
        var ycs=document.getElementById('you-cur-streak');
        var ybs=document.getElementById('you-best-streak');
        if(ycs&&curS) {
          var val = (curS.textContent||'0').replace('🔥','').trim();
          ycs.textContent = val + ' Days';
        }
        if(ybs&&bestS) {
          var val = (bestS.textContent||'0').trim();
          ybs.textContent = val + ' Days';
        }
      },500);

      var fullP=calcFullPts(validA,reg.gender,reg.shift);
      var myPtsNow=fullP.total;
      var daysElapsed=Math.max(1,(nowD-EVENT_START)/86400000);
      var daysLeft=Math.max(0,Math.ceil((EVENT_END-nowD)/86400000));
      var avgPtDay=myPtsNow/daysElapsed;
      var projPts=myPtsNow+(avgPtDay*daysLeft);
      var predIco,predTitle,predSub;
      var bT=bronzeThresh||100,sT=silverThresh||150,gT=goldThresh||200;
      var topMotivation=[
        'You\'re a legend — can you crack Top 3? 🏆',
        'Elite level achieved! Eyes on the podium 👀',
        'Gold secured — now chase the #1 spot! 🥇',
        'You\'re unstoppable — keep pushing for glory! 💪',
        'Champion energy! The Top 3 is within reach 🚀',
        'All medals unlocked — now go for the win! 🔥'
      ];
      if(myPtsNow>=gT){predIco='🏆';predTitle='All Medals Achieved!';predSub=topMotivation[Math.floor(Math.random()*topMotivation.length)];}
      else if(projPts>=gT){predIco='🥇';predTitle='On track for Gold';predSub='Projected ~'+Math.round(projPts)+' pts at current pace';}
      else if(projPts>=sT){predIco='🥈';predTitle='On track for Silver';predSub='Need '+(Math.round(gT-projPts))+' more pts to reach Gold';}
      else if(projPts>=bT){predIco='🥉';predTitle='On track for Bronze';predSub='Walk '+(daysLeft>0?((sT-myPtsNow)/daysLeft).toFixed(1):0)+' km/day to reach Silver';}
      else{predIco='🏃';predTitle='Keep going!';predSub='Walk '+(daysLeft>0?((bT-myPtsNow)/daysLeft).toFixed(1):0)+' km/day to reach Bronze';}
      var pico=document.getElementById('you-medal-pred-ico');if(pico)pico.textContent=predIco;
      var ptit=document.getElementById('you-medal-pred-title');if(ptit)ptit.textContent=predTitle;
      var psub=document.getElementById('you-medal-pred-sub');if(psub)psub.textContent=predSub;

      (function(){
        var grid=document.getElementById('heatmap-grid');
        if(!grid)return;
        var dayKmMap={};
        validA.forEach(function(a){
          var d=getActDate(a);
          if(d)dayKmMap[d]=(dayKmMap[d]||0)+parseFloat(a.distance_meters||0)/1000;
        });
        var todayStr=new Date().toISOString().split('T')[0];
        grid.innerHTML='';
        for(var d=1;d<=30;d++){
          var ds='2026-06-'+(d<10?'0':'')+d;
          var cell=document.createElement('div');
          cell.className='hm-day';
          var km=dayKmMap[ds]||0;
          cell.title=ds+(km>0?' · '+km.toFixed(1)+' km':'');
          cell.textContent=d;
          if(ds>todayStr){cell.classList.add('future');}
          else if(km>=21){cell.classList.add('km-21');}
          else if(km>=15){cell.classList.add('km-15');}
          else if(km>=10){cell.classList.add('km-10');}
          else if(km>=8){cell.classList.add('km-8');}
          else if(km>=5){cell.classList.add('km-5');}
          else{cell.classList.add('rest');}
          if(ds===todayStr)cell.classList.add('today');
          grid.appendChild(cell);
        }
      })();

      var synced=document.getElementById('you-synced-acts');if(synced)synced.textContent=myActs.length;
      var sortedActs=validA.slice().sort(function(a,b){return (b.activity_date||'').localeCompare(a.activity_date||'');});
      var lastAct=sortedActs.length?sortedActs[0]:null;
      var ylse=document.getElementById('you-last-sync');
      var ylsd=document.getElementById('you-last-sync-date');
      if(lastAct){
        var ld=new Date(lastAct.activity_date);
        var diffD=Math.floor((nowD-ld)/86400000);
        var diffLabel=diffD===0?'Today':diffD===1?'Yesterday':diffD+' days ago';
        if(ylse)ylse.textContent=diffLabel;
        if(ylsd)ylsd.textContent=ld.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
      } else {
        if(ylse)ylse.textContent='—';
      }
    })();

    var fullPts=calcFullPts(myActs,reg.gender,reg.shift);
    var validCount=myActs.filter(function(a){return !a.is_flagged;}).length;
    safeSetText('s-dist', Math.round(fullPts.km));
    safeSetText('s-acts', validCount);
    safeSetText('s-pts-dist', fullPts.distPts.toFixed(1)+' pts');
    safeSetText('s-pts-milestone', fullPts.bonusPts.toFixed(1)+' pts');
    safeSetText('s-pts-challenge', fullPts.challengePts.toFixed(1)+' pts');
    safeSetText('s-pts-total', fullPts.total.toFixed(1)+' pts');

    var validActs=myActs.filter(function(a){return !a.is_flagged;});
    var totalMovingSec=validActs.reduce(function(s,a){return s+(a.moving_time_seconds||0);},0);
    var totalDistM=validActs.reduce(function(s,a){return s+(a.distance_meters||0);},0);
    var avgPaceStr='—';
    if(totalDistM>0){var psk=totalMovingSec/(totalDistM/1000),pmin=Math.floor(psk/60),psec=Math.round(psk%60);avgPaceStr=pmin+':'+(psec<10?'0':'')+psec;}
    safeSetText('s-pace', avgPaceStr);
    var mts='—';if(totalMovingSec>0){var mh=Math.floor(totalMovingSec/3600),mm=Math.floor((totalMovingSec%3600)/60);mts=mh>0?mh+'h '+mm+'m':mm+'m';}
    safeSetText('s-movetime', mts);
    safeSetText('s-movetime-dash', mts);

    // Personal Bests
    (function(){
      var maxDistM = 0;
      var maxTimeSec = 0;
      var maxSpeed = 0;
      var bestPaceSport = 'Walk';
      var dayKm = {};

      validActs.forEach(function(a){
        var km = (a.distance_meters || 0) / 1000;
        if (a.distance_meters > maxDistM) maxDistM = a.distance_meters;
        if (a.moving_time_seconds > maxTimeSec) maxTimeSec = a.moving_time_seconds;
        
        var t = a.sport_type;
        var isWalkRun = t === 'Walk' || t === 'Run' || t === 'VirtualRun' || t === 'Hike';
        if (isWalkRun && a.avg_speed > maxSpeed && a.avg_speed < 12) {
          maxSpeed = a.avg_speed;
          bestPaceSport = t;
        }

        var d = getActDate(a);
        if (d) dayKm[d] = (dayKm[d] || 0) + km;
      });

      var maxDayKm = 0;
      var bestDayDate = '';
      Object.keys(dayKm).forEach(function(d){
        if (dayKm[d] > maxDayKm) {
          maxDayKm = dayKm[d];
          bestDayDate = d;
        }
      });

      var pbLongest = document.getElementById('pb-longest');
      if (pbLongest) pbLongest.textContent = maxDistM > 0 ? (maxDistM / 1000).toFixed(2) + ' km' : '—';

      var pbPace = document.getElementById('pb-pace');
      if (pbPace) pbPace.textContent = maxSpeed > 0 ? fmtPS(maxSpeed, bestPaceSport) : '—';

      var pbTime = document.getElementById('pb-time');
      if (pbTime) pbTime.textContent = maxTimeSec > 0 ? fmtDur(maxTimeSec) : '—';

      var pbBestDay = document.getElementById('pb-bestday');
      var pbBestDayDate = document.getElementById('pb-bestday-date');
      if (pbBestDay) pbBestDay.textContent = maxDayKm > 0 ? maxDayKm.toFixed(2) + ' km' : '—';
      if (pbBestDayDate) {
        if (maxDayKm > 0) {
          var dObj = new Date(bestDayDate + 'T00:00:00');
          pbBestDayDate.textContent = dObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        } else {
          pbBestDayDate.textContent = '';
        }
      }

      var typeCounts = {};
      validActs.forEach(function(a){
        var t = a.sport_type || 'Other';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });
      var bdEl = document.getElementById('act-type-breakdown');
      if (bdEl) {
        if (Object.keys(typeCounts).length === 0) {
          bdEl.style.display = 'none';
        } else {
          var bgColors = { Walk: 'rgba(34,197,94,0.12)', Run: 'rgba(96,165,250,0.12)', VirtualRun: 'rgba(96,165,250,0.12)', Hike: 'rgba(168,85,247,0.12)', Ride: 'rgba(244,63,94,0.12)' };
          var textColors = { Walk: 'var(--green)', Run: 'var(--blue)', VirtualRun: 'var(--blue)', Hike: '#c084fc', Ride: '#f43f5e' };
          bdEl.style.display = 'flex';
          bdEl.innerHTML = Object.keys(typeCounts).map(function(type){
            var count = typeCounts[type];
            var bg = bgColors[type] || 'rgba(255,255,255,0.08)';
            var fg = textColors[type] || 'var(--muted)';
            return '<span style="font-size:11px;font-weight:700;color:' + fg + ';background:' + bg + ';padding:5px 10px;border-radius:12px;text-transform:uppercase;letter-spacing:0.5px;margin-right:8px;margin-bottom:8px;">' + type + ' · ' + count + '</span>';
          }).join('');
        }
      }
    })();

    // India City Facts
    (function(){
      var totalKm=totalDistM/1000;
      var routes=[
        {km:6,label:'Connaught Place → India Gate'},
        {km:13,label:'Delhi Airport → Connaught Place'},
        {km:25,label:'Delhi → Gurgaon'},
        {km:65,label:'Delhi → Alwar'},
        {km:120,label:'Delhi → Agra (halfway)'},
        {km:233,label:'Delhi → Jaipur'},
        {km:500,label:'Delhi → Lucknow'},
        {km:820,label:'Delhi → Mumbai (quarter)'},
        {km:1400,label:'Delhi → Chennai'}
      ];
      var eq=routes[0];
      for(var ri=0;ri<routes.length;ri++){if(totalKm>=routes[ri].km)eq=routes[ri];}
      var eqEl=document.getElementById('fact-dist-eq');
      if(eqEl)eqEl.textContent=eq.label;
      var cal=Math.round(totalKm*60);
      var calEl=document.getElementById('fact-cal');
      if(calEl)calEl.textContent=cal>=1000?(cal/1000).toFixed(1)+'k kcal':cal+' kcal';
      var steps=Math.round(totalKm*1350);
      var stEl=document.getElementById('fact-steps');
      if(stEl)stEl.textContent=steps>=1000?Math.round(steps/1000)+'k steps':steps+' steps';
      var co2=(totalKm*0.21).toFixed(1);
      var coEl=document.getElementById('fact-carbon');
      if(coEl)coEl.textContent=co2+' kg';
    })();

    // Milestones
    (function(){
      var validA=myActs.filter(function(a){return !a.is_flagged;});
      var totalKm=totalDistM/1000;
      var hasAny=validA.length>0;
      var longestKm=validA.reduce(function(mx,a){return Math.max(mx,(a.distance_meters||0)/1000);},0);
      var earlyBird=validA.some(function(a){var h=new Date(a.activity_date).getHours();return h<6;});
      var streakEl=document.getElementById('streak-num');
      var bestStreakEl=document.getElementById('streak-best-val');
      var bestStreak=bestStreakEl?parseInt(bestStreakEl.textContent)||0:0;
      var ms=[
        {id:'ms-first', earned:hasAny},
        {id:'ms-50km',  earned:totalKm>=50},
        {id:'ms-100km', earned:totalKm>=100},
        {id:'ms-200km', earned:totalKm>=200},
        {id:'ms-streak7',earned:bestStreak>=7},
        {id:'ms-longact',earned:longestKm>=20},
        {id:'ms-earlybird',earned:earlyBird}
      ];
      ms.forEach(function(m){
        var el=document.getElementById(m.id);
        if(el&&m.earned)el.classList.add('earned');
      });
    })();

    var medals={gold:{male:300,female:250},silver:{male:200,female:150},bronze:{male:125,female:100}};
    if(Array.isArray(medalData)&&medalData.length&&medalData[0].config_value)medals=medalData[0].config_value;
    var gKey=(reg.gender||'').toLowerCase()==='female'?'female':'male';
    var bronzeThresh=Number(medals.bronze[gKey])||100,silverThresh=Number(medals.silver[gKey])||150,goldThresh=Number(medals.gold[gKey])||200;
    var myPts=fullPts.total;
    var sptEl=document.getElementById('s-pts-display');if(sptEl)sptEl.textContent=myPts.toFixed(2);

    // Medal Progress Rings
    var CIRC=270.2;
    _ringAnimationData = [];
    [{id:'br',thresh:bronzeThresh},{id:'si',thresh:silverThresh},{id:'go',thresh:goldThresh}].forEach(function(m){
      var done=myPts>=m.thresh;
      var rawPct=(myPts/m.thresh)*100;
      var needed=Math.max(0,m.thresh-myPts);
      var displayPct=done?100:Math.min(99,Math.floor(rawPct));
      var arcPct=done?100:Math.min(96,rawPct);
      var offset=CIRC-(CIRC*arcPct/100);
      
      var fillEl=document.getElementById('ring-fill-'+m.id);
      var pctEl=document.getElementById('ring-pct-'+m.id);
      var needEl=document.getElementById('ring-need-'+m.id);
      
      if (fillEl && pctEl) {
        _ringAnimationData.push({
          fillEl: fillEl,
          pctEl: pctEl,
          offset: done ? 0 : offset,
          displayPct: displayPct
        });
      }
      
      if(needEl){
        if(done){needEl.textContent='✓ Achieved';needEl.style.color='var(--green)';}
        else{needEl.textContent='Need '+needed.toFixed(0)+' pts';}
      }
    });
    triggerRingAnimation();

    (function() {
      var todayStr = new Date().toISOString().split('T')[0];
      var iKey = 'insight_' + todayStr;
      var emoji, title, body;
      if (myPts >= goldThresh) {
        emoji = '🥇'; title = 'Gold Medal Achieved!';
        body = 'Outstanding! You\'ve crossed the Gold threshold with ' + myPts.toFixed(0) + ' pts. Keep it up!';
      } else if (myPts >= silverThresh) {
        var need = (goldThresh - myPts).toFixed(0);
        emoji = '🥈'; title = 'Silver Medal — Gold is close!';
        body = 'You need just ' + need + ' more pts to unlock Gold. Push a little harder!';
      } else if (myPts >= bronzeThresh) {
        var need = (silverThresh - myPts).toFixed(0);
        emoji = '🥉'; title = 'Bronze Medal Achieved!';
        body = 'Great start! ' + need + ' pts more gets you Silver. Keep walking!';
      } else {
        var need = (bronzeThresh - myPts).toFixed(0);
        emoji = '🏃'; title = 'On your way to Bronze!';
        body = 'Walk ' + need + ' more pts to earn your first medal. You can do it!';
      }
      _activeInsight = { key: iKey, emoji: emoji, title: title, body: body };
      updateInAppNotificationBanner();
    })();

    // ── Phase 2: Load ranking data in background ────────────────────
    (async function loadRanking(){
      try{
        var _cachedRankActs = cacheGet('ranking_acts_v3', CACHE_TTL.ranking);
        var _cachedRankReg  = cacheGet('ranking_reg',  CACHE_TTL.ranking);
        if (_cachedRankActs && _cachedRankReg) {
          console.log('[Cache] Serving Phase 2 (ranking) from cache ✓');
          allActsRaw = _cachedRankActs;
          allRegRaw  = _cachedRankReg;
          if (!isBackgroundRefresh) {
            setTimeout(function(){
              Promise.all([
                fetchAllParallel(SUPABASE_URL+'/rest/v1/activities?is_deleted=is.false&created_at=lt.2026-07-01T11:00:00Z&activity_date=gte.2026-05-31T18:30:00Z&activity_date=lte.2026-06-30T18:30:00Z&order=id.asc&select=strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist'),
                fetchAllParallel(SUPABASE_URL+'/rest/v1/registration?order=strava_athlete_id.asc&select=strava_athlete_id,full_name,gender,shift,leaderboard_team')
              ]).then(function(results){
                function doReload() {
                  if (_touchInteracting) {
                    console.log('[Cache] User is interacting, deferring background reload...');
                    setTimeout(doReload, 300);
                  } else {
                    console.log('[Cache] Phase 2 background refresh complete. Re-rendering...');
                    cacheSet('ranking_acts_v3', results[0]);
                    cacheSet('ranking_reg', results[1]);
                    load(true);
                  }
                }
                doReload();
              }).catch(function(e){console.warn('[Cache] Ranking background refresh failed:', e);});
            }, 500);
          }
        } else {
          console.log('[Cache] Cache miss — fetching Phase 2 from Supabase...');
          var fetched = await Promise.all([
            fetchAllParallel(SUPABASE_URL+'/rest/v1/activities?is_deleted=is.false&created_at=lt.2026-07-01T11:00:00Z&activity_date=gte.2026-05-31T18:30:00Z&activity_date=lte.2026-06-30T18:30:00Z&order=id.asc&select=strava_activity_id,strava_athlete_id,distance_meters,activity_date,is_flagged,sport_type,manual_bonus,activity_date_time_ist'),
            fetchAllParallel(SUPABASE_URL+'/rest/v1/registration?order=strava_athlete_id.asc&select=strava_athlete_id,full_name,gender,shift,leaderboard_team')
          ]);
          allActsRaw = fetched[0]; cacheSet('ranking_acts_v3', allActsRaw);
          allRegRaw  = fetched[1]; cacheSet('ranking_reg',  allRegRaw);
        }
        allActs=allActsRaw; allRegRes=allRegRaw;
        LB_REG=allRegRaw;
        LB_ACTS=allActsRaw;
        precomputeLBScores();
        if(LB_ME){_lbReady=true; if(typeof lbRender === 'function') lbRender();}
        if (typeof renderFeedHighlights === 'function') renderFeedHighlights();
        if (typeof renderCommunityPulse === 'function') renderCommunityPulse();
      }catch(e2){console.warn('Ranking load failed:',e2);return;}
      if (typeof renderStanding === 'function') renderStanding();
    })();

    // Pace Goals Card
    var now=new Date();
    var EVENT_END=new Date('2026-06-30T23:59:59+05:30');
    var daysLeft=Math.max(0,Math.ceil((EVENT_END-now)/(1000*60*60*24)));
    var todayStr=getISTDate(now.toISOString());
    var todayKm=myActs.filter(function(a){return !a.is_flagged;}).reduce(function(s,a){return getActDate(a)===todayStr?s+(a.distance_meters||0)/1000:s;},0);
    var bonusTiers=[[5,1],[8,2],[10,3],[15,4],[21,7]],nextTier=null;
    for(var ti=0;ti<bonusTiers.length;ti++){if(todayKm<bonusTiers[ti][0]){nextTier=bonusTiers[ti];break;}}

    var QUOTES={
      t5:['Unstoppable. Keep the hammer down.','Built different. Prove it every day.','Relentless. That\'s your identity now.'],
      t10:['You\'re in a different league. Stay there.','Elite pace. Own it.','Almost untouchable. Stay consistent.'],
      t25:['The top is within reach. Attack it.','You\'re dangerous. Don\'t slow down.','Strong pace. One push to the podium.'],
      t50:['Stay hungry. The podium isn\'t far.','You\'re ahead of half the field. Finish strong.','Momentum is everything. Don\'t break it.'],
      b50:['The gap is closeable. Every km counts.','Every step forward counts. Keep moving.','The comeback starts today. Go.']
    };
    function pickQuote(tier){var arr=QUOTES[tier];return arr[Math.floor(Math.random()*arr.length)];}

    function paceRow(iconBg,icon,mainText,subText,valText,valColor){
      var d=document.createElement('div');d.className='pace-row';
      d.innerHTML='<div class="pace-icon" style="background:'+iconBg+'">'+icon+'</div>'+
        '<div class="pace-text"><div class="pace-main">'+mainText+'</div><div class="pace-sub">'+subText+'</div></div>'+
        '<div class="pace-val" style="color:'+valColor+'">'+valText+'</div>';
      return d;
    }

    var paceCard=document.getElementById('pace-card');
    if(paceCard){
      paceCard.innerHTML='';

      if(myPts>=goldThresh){
        var daysElapsed=Math.max(1,(now-new Date('2026-06-01T00:00:00+05:30'))/86400000);
        var avgKmDay=fullPts.km/daysElapsed;
        var goldActsMap={};
        allActs.forEach(function(a){if(!goldActsMap[a.strava_athlete_id])goldActsMap[a.strava_athlete_id]=[];goldActsMap[a.strava_athlete_id].push(a);});
        var myShiftN = (reg.shift || '').toLowerCase();
        var isNight = myShiftN.indexOf('night') > -1;
        var myGenderN = (reg.gender || '').toLowerCase();
        var isFemale = myGenderN === 'female' || myGenderN === 'f';
        var shiftPeersG=allRegRes.filter(function(p){var pg=(p.gender||'').toLowerCase(),ps=(p.shift||'').toLowerCase();return(ps.indexOf('night')>-1)===isNight&&(pg==='female')===isFemale;});
        var shiftScoredG=shiftPeersG.map(function(p){var km=0;(goldActsMap[p.strava_athlete_id]||[]).forEach(function(a){km+=(a.distance_meters||0)/1000;});return{id:p.strava_athlete_id,name:p.full_name,km:km};}).sort(function(a,b){return b.km-a.km;});
        var myRankG=shiftScoredG.findIndex(function(x){return String(x.id)===String(athleteId);})+1;
        var totalG=shiftScoredG.length;
        var pctRank=totalG>0?myRankG/totalG:0.5;
        var quoteTier=pctRank<=0.05?'t5':pctRank<=0.10?'t10':pctRank<=0.25?'t25':pctRank<=0.50?'t50':'b50';
        var quote=pickQuote(quoteTier);
        var personAbove=myRankG>1?shiftScoredG[myRankG-2]:null;
        var projectedPts=(myPts+(avgKmDay*daysLeft)).toFixed(0);

        var div=document.createElement('div');div.className='gold-card';
        div.innerHTML=
          '<div class="gold-top">'+
            '<div class="gold-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg></div>'+
            '<div><div class="gold-title">Gold Achieved!</div>'+
            '<div class="gold-sub">Rank #'+myRankG+' of '+totalG+' in your category</div></div>'+
          '</div>'+
          '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+quote+'&rdquo;</div></div>'+
          '<div class="gold-stats">'+
            '<div class="gold-stat"><div class="gold-stat-val">'+avgKmDay.toFixed(1)+' km</div><div class="gold-stat-lbl">Daily avg</div></div>'+
            '<div class="gold-stat"><div class="gold-stat-val" style="color:var(--gold)">~'+projectedPts+' pts</div><div class="gold-stat-lbl">Projected finish</div></div>'+
          '</div>'+
          (personAbove?
            '<div class="gold-rival">'+
              '<div class="gold-rival-left">'+
                '<div class="gold-rival-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg> Overtake #'+(myRankG-1)+': '+esc(personAbove.name)+'</div>'+
                '<div class="gold-rival-sub">'+daysLeft+' days left · keep pushing</div>'+
              '</div>'+
            '</div>'
          :
            '<div class="gold-rival">'+
              '<div class="gold-rival-left">'+
                '<div class="gold-rival-label">🏆 You\'re #1 — lead to the finish!</div>'+
                '<div class="gold-rival-sub">Defend your spot for '+daysLeft+' more days</div>'+
              '</div>'+
            '</div>'
          );
        paceCard.appendChild(div);
      } else {
        var daysElapsed2=Math.max(1,(now-new Date('2026-06-01T00:00:00+05:30'))/86400000);
        var avgKmDay2=fullPts.km/daysElapsed2;
        var projectedPts2=(myPts+(avgKmDay2*daysLeft)).toFixed(0);
        var icoCalPace='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        var icoBronze='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4A84A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg>';
        var icoSilver='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C8D8E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg>';
        var icoGold='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFD000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg>';
        var icoPaceBolt='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(96,165,250,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
        var icoPaceChk='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(34,197,94,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

        if(myPts>=silverThresh){
          var SQUOTES=['Silver secured! Gold is the last frontier — you can do this.','Silver is yours! One final push to Gold. You\'re so close.','Amazing effort! Silver achieved. Gold is within your reach.'];
          var sq=SQUOTES[Math.floor(Math.random()*SQUOTES.length)];
          var sdiv=document.createElement('div');sdiv.className='gold-card';
          sdiv.style.borderLeft='3px solid #C8D8E8';
          sdiv.innerHTML=
            '<div class="gold-top">'+
              '<div class="gold-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C8D8E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg></div>'+
              '<div><div class="gold-title" style="color:#C8D8E8">Silver Achieved!</div>'+
              '<div class="gold-sub">'+myPts.toFixed(2)+' pts · ~'+projectedPts2+' pts projected</div></div>'+
            '</div>'+
            '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+sq+'&rdquo;</div></div>';
          paceCard.appendChild(sdiv);
        } else if(myPts>=bronzeThresh){
          var BQUOTES=['You earned Bronze! Silver is within reach — keep going.','Bronze locked in. Now aim higher. Silver is closer than you think.','Great start! Bronze is yours. Push for Silver next.'];
          var bq=BQUOTES[Math.floor(Math.random()*BQUOTES.length)];
          var bdiv=document.createElement('div');bdiv.className='gold-card';
          bdiv.style.borderLeft='3px solid #F4A84A';
          bdiv.innerHTML=
            '<div class="gold-top">'+
              '<div class="gold-emoji"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F4A84A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="15" r="6"/><path d="M8.5 8.5 6 6l3-3h6l3 3-2.5 2.5"/></svg></div>'+
              '<div><div class="gold-title" style="color:#F4A84A">Bronze Achieved!</div>'+
              '<div class="gold-sub">'+myPts.toFixed(2)+' pts · ~'+projectedPts2+' pts projected</div></div>'+
            '</div>'+
            '<div class="gold-quote"><div class="gold-quote-text">&ldquo;'+bq+'&rdquo;</div></div>';
          paceCard.appendChild(bdiv);
        }

        paceCard.appendChild(paceRow('rgba(96,165,250,0.12)',icoCalPace,daysLeft+' days remaining','Event ends July 1','Jul 1','var(--muted)'));

        if(myPts<bronzeThresh){
          var brN=Math.max(0,bronzeThresh-myPts),brK=daysLeft>0?(brN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(244,168,74,0.12)',icoBronze,'Walk '+brK.toFixed(1)+' km/day for Bronze','Need '+brN.toFixed(1)+' pts in '+daysLeft+' days',brK.toFixed(1)+' km','#F4A84A'));
          var siN=Math.max(0,silverThresh-myPts),siK=daysLeft>0?(siN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(200,216,232,0.12)',icoSilver,'Walk '+siK.toFixed(1)+' km/day for Silver','Need '+siN.toFixed(1)+' pts in '+daysLeft+' days',siK.toFixed(1)+' km','var(--silver)'));
          var goN=Math.max(0,goldThresh-myPts),goK=daysLeft>0?(goN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(255,208,0,0.12)',icoGold,'Walk '+goK.toFixed(1)+' km/day for Gold','Need '+goN.toFixed(1)+' pts in '+daysLeft+' days',goK.toFixed(1)+' km','var(--gold)'));
        } else if(myPts<silverThresh){
          var siN=Math.max(0,silverThresh-myPts),siK=daysLeft>0?(siN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(200,216,232,0.12)',icoSilver,'Walk '+siK.toFixed(1)+' km/day for Silver','Need '+siN.toFixed(1)+' pts in '+daysLeft+' days',siK.toFixed(1)+' km','var(--silver)'));
          var goN=Math.max(0,goldThresh-myPts),goK=daysLeft>0?(goN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(255,208,0,0.12)',icoGold,'Walk '+goK.toFixed(1)+' km/day for Gold','Need '+goN.toFixed(1)+' pts in '+daysLeft+' days',goK.toFixed(1)+' km','var(--gold)'));
        } else {
          var goN=Math.max(0,goldThresh-myPts),goK=daysLeft>0?(goN/daysLeft):0;
          paceCard.appendChild(paceRow('rgba(255,208,0,0.12)',icoGold,'Walk '+goK.toFixed(1)+' km/day for Gold','Need '+goN.toFixed(1)+' pts in '+daysLeft+' days',goK.toFixed(1)+' km','var(--gold)'));
        }

        if(nextTier){
          paceCard.appendChild(paceRow('rgba(96,165,250,0.12)',icoPaceBolt,'Walk '+(nextTier[0]-todayKm).toFixed(1)+' km more today for bonus','Today: '+todayKm.toFixed(1)+' km so far','+'+nextTier[1]+' pt','var(--blue)'));
        } else {
          paceCard.appendChild(paceRow('rgba(34,197,94,0.12)',icoPaceChk,'Max daily bonus earned!',todayKm.toFixed(1)+' km today','+7 pts','var(--green)'));
        }
      }
    }

    // Recovery Suggestions
    (function(){
      var validActs=myActs.filter(function(a){return !a.is_flagged;});
      if(!validActs.length)return;
      var sortedDates=validActs.map(function(a){return getActDate(a);}).filter(Boolean).sort();
      var lastDate=sortedDates[sortedDates.length-1];
      if(!lastDate)return;
      var nowD=new Date(); nowD.setHours(12,0,0,0);
      var lastD=new Date(lastDate+'T12:00:00');
      var daysDiff=Math.floor((nowD-lastD)/86400000);
      if(daysDiff>1)return;
      var lastKm=validActs.reduce(function(s,a){return getActDate(a)===lastDate?s+(a.distance_meters||0)/1000:s;},0);
      if(lastKm<8)return;
      var wrap=document.getElementById('recovery-card-wrap');
      var titleEl=document.getElementById('recovery-title');
      var subEl=document.getElementById('recovery-sub');
      var chipsEl=document.getElementById('recovery-chips');
      if(!wrap)return;
      var whenLabel=daysDiff===0?'today':'yesterday';
      var chips,intensity;
      if(lastKm>=21){
        intensity='Peak Effort';
        chips=[
          {e:'💧',t:'Hydrate now','c':'Drink 500ml water immediately'},
          {e:'⚡',t:'Electrolytes','c':'Replenish salts lost in sweat'},
          {e:'🥩',t:'Protein meal','c':'Aim for 25–30g protein'},
          {e:'🧊',t:'Cold compress','c':'Ice calves & feet for 10 min'},
          {e:'😴',t:'Sleep 8h+','c':'Your body repairs while you sleep'},
          {e:'🛑',t:'Rest tomorrow','c':'Let muscles recover fully'}
        ];
      } else if(lastKm>=15){
        intensity='Strong Effort';
        chips=[
          {e:'💧',t:'Stay hydrated','c':'Keep sipping water all day'},
          {e:'⚡',t:'Electrolytes','c':'Sports drink or coconut water'},
          {e:'🥩',t:'Protein snack','c':'Eggs, paneer or nuts within 1h'},
          {e:'🦵',t:'Stretch legs','c':'5 min calf & hamstring stretch'},
          {e:'😴',t:'Sleep well','c':'Aim for 7–8 hours tonight'}
        ];
      } else {
        intensity='Moderate Effort';
        chips=[
          {e:'💧',t:'Hydrate well','c':'2–3 litres water today'},
          {e:'⚡',t:'Electrolytes','c':'Add a pinch of salt to water'},
          {e:'🥩',t:'Protein','c':'Include protein in your next meal'},
          {e:'🧘',t:'Light stretch','c':'5 min of light stretching helps'}
        ];
      }
      titleEl.textContent='Recovery Tips · '+lastKm.toFixed(1)+' km '+whenLabel;
      subEl.textContent=intensity+' — take care of your body today';
      chipsEl.innerHTML=chips.map(function(c){
        return '<div class="recovery-chip" title="'+c.c+'">'+c.e+' '+c.t+'</div>';
      }).join('');
      _activeRecovery = {
        key: 'recovery_' + lastDate,
        title: 'Recovery Tips · ' + lastKm.toFixed(1) + ' km ' + whenLabel,
        sub: intensity + ' — take care of your body today',
        chips: chips
      };
      updateInAppNotificationBanner();
    })();

    // Streak and chart bars
    var activeDays={};
    myActs.filter(function(a){return !a.is_flagged;}).forEach(function(a){
      var d=getActDate(a);
      if(d)activeDays[d]=true;
    });

    function localDateStr(d){
      var yr=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,'0'),dy=String(d.getDate()).padStart(2,'0');
      return yr+'-'+mo+'-'+dy;
    }
    function addDays(dateStr,n){
      var d=new Date(dateStr+'T12:00:00');d.setDate(d.getDate()+n);return localDateStr(d);
    }

    var todayLocal=localDateStr(now);
    var yesterdayLocal=addDays(todayLocal,-1);
    var sortedActiveDays=Object.keys(activeDays).sort();

    var streak=0;
    var lastActiveDay=sortedActiveDays.length>0?sortedActiveDays[sortedActiveDays.length-1]:null;
    if(lastActiveDay){
      var walkDay=lastActiveDay;
      while(activeDays[walkDay]){streak++;walkDay=addDays(walkDay,-1);}
    }

    var streakIsLive=lastActiveDay===todayLocal||lastActiveDay===yesterdayLocal;

    var best=0,cur=0,prevD=null;
    sortedActiveDays.forEach(function(d){
      if(prevD){var diff=Math.round((new Date(d+'T12:00:00')-new Date(prevD+'T12:00:00'))/86400000);cur=diff===1?cur+1:1;}
      else cur=1;
      best=Math.max(best,cur);
      prevD=d;
    });

    safeSetText('streak-num', (streakIsLive&&streak>0?'🔥':'')+streak);
    safeSetText('streak-best-val', best);
    safeSetText('streak-msg', streakIsLive?(streak>=7?'Amazing streak!':streak>=3?'Keep it going!':'Good start!'):(lastActiveDay?'Last active '+lastActiveDay:'Start today!'));

    var days7=[],labels7=[];
    for(var di=6;di>=0;di--){
      var dd=new Date(now);dd.setDate(dd.getDate()-di);dd.setHours(12,0,0,0);
      var dstr=localDateStr(dd);
      var dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      days7.push({str:dstr,active:!!activeDays[dstr],isToday:di===0});
      labels7.push(di===0?'Today':dayNames[dd.getDay()]);
    }
    safeSetHtml('streak-bars', days7.map(function(d){return'<div class="sbar '+(d.isToday?'dim':d.active?'on':'off')+'"></div>';}).join(''));
    safeSetHtml('streak-labels', labels7.map(function(l){return'<span class="sdlbl">'+l+'</span>';}).join(''));

    // Challenges list tab
    (function renderChallenges(){
      var chList=document.getElementById('challenges-list');
      if(!chList)return;

      var combined = CHALLENGES_LB.map(function(ch) {
        return {
          id: ch.id,
          name: ch.name,
          start_date: ch.start_date,
          end_date: ch.end_date,
          bonus_points: parseFloat(ch.bonus_points) || 0,
          is_manual: false
        };
      });

      myActs.forEach(function(a) {
        var mb = parseFloat(a.manual_bonus) || 0;
        if (mb > 0) {
          var matchedCh = CHALLENGES_LB.find(function(ch) {
            return ch.name === a.description;
          });
          if (matchedCh) return;

          var date = getActDate(a);
          combined.push({
            id: 'manual_' + a.strava_activity_id,
            name: a.description || 'Manual bonus',
            start_date: date,
            end_date: date,
            bonus_points: mb,
            is_manual: true
          });
        }
      });

      if(!combined.length){
        chList.innerHTML='<div class="card" style="margin-bottom:0;"><p style="font-size:var(--fs-base);color:var(--muted);padding:14px;text-align:center;">No challenges configured.</p></div>';
        return;
      }
      chList.innerHTML='';
      
      function toTitleCase(str) {
        if (!str) return '';
        return str.toLowerCase().split(' ').map(function(word) {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
      }

      function getChallengeEmoji(name) {
        var n = (name || '').toLowerCase();
        if (n.indexOf('strava') > -1) return '🧡';
        if (n.indexOf('walk') > -1) return '🚶';
        if (n.indexOf('run') > -1) return '🏃';
        if (n.indexOf('ride') > -1 || n.indexOf('cycle') > -1 || n.indexOf('bike') > -1) return '🚴';
        if (n.indexOf('hike') > -1 || n.indexOf('climb') > -1) return '🥾';
        if (n.indexOf('sunchaser') > -1 || n.indexOf('sun') > -1 || n.indexOf('morning') > -1) return '🌅';
        if (n.indexOf('night') > -1 || n.indexOf('evening') > -1) return '🌙';
        if (n.indexOf('environment') > -1 || n.indexOf('nature') > -1 || n.indexOf('green') > -1) return '🌱';
        if (n.indexOf('wednesday') > -1 || n.indexOf('friday') > -1 || n.indexOf('day') > -1) return '📅';
        if (n.indexOf('weekend') > -1 || n.indexOf('saturday') > -1 || n.indexOf('sunday') > -1) return '🏖️';
        if (n.indexOf('gold') > -1) return '🥇';
        if (n.indexOf('silver') > -1) return '🥈';
        if (n.indexOf('bronze') > -1) return '🥉';
        if (n.indexOf('title') > -1 || n.indexOf('champion') > -1) return '🏆';
        return '🎯';
      }

      var sortedCh = combined.sort(function(a,b){return (b.start_date||'').localeCompare(a.start_date||'');});
      sortedCh.forEach(function(ch,ci2){
        var key = ch.is_manual ? ch.id : 'ch_'+(ch.id||ci2);
        var ep=fullPts.earnedPts||{};
        var ec=fullPts.earnedChallenges||{};
        var earned = ch.is_manual ? true : !!ec[key];
        if(!earned){var allDB=fullPts.dayBreakdown||{};for(var day in allDB){if(allDB[day].challenges&&allDB[day].challenges.some(function(x){return x.name===ch.name;})){earned=true;break;}}}
        if(!earned){var ab=fullPts.actBreakdown||{};for(var actId in ab){if(ab[actId].challenges&&ab[actId].challenges.some(function(x){return x.name===ch.name;})){earned=true;break;}}}
        var displayPts = ch.is_manual ? ch.bonus_points : (earned&&ep[key]?ep[key]:Number(ch.bonus_points)||0);
        var today2=new Date().toISOString().split('T')[0];
        var missed=!earned&&ch.end_date&&ch.end_date<today2;
        var statusCls=earned?'won':missed?'missed':'avail';
        var statusIcon=earned?'\u2713':missed?'\u2715':'!';
        
        var cardDiv=document.createElement('div');
        cardDiv.className='ch-card ' + statusCls;
        
        var displayName = getChallengeEmoji(ch.name) + ' ' + toTitleCase(ch.name);
        var statusBarHtml = earned
          ? '<span>&#10003; Achieved</span><span>+' + Math.round(displayPts) + ' pts earned</span>'
          : missed
            ? '<span>&#10007; Not completed</span><span>Deadline passed</span>'
            : '<span>! Available</span><span>+' + Math.round(ch.bonus_points) + ' pts possible</span>';
        cardDiv.innerHTML = `
          <div class="ch-card-header">
            <div class="ch-dot ${statusCls}">${statusIcon}</div>
            <div class="ch-card-title-wrap">
              <div class="ch-title">${esc(displayName)}</div>
              <div class="ch-sub">${ch.start_date === ch.end_date ? ch.start_date : ch.start_date + ' \u2013 ' + ch.end_date} &middot; <span class="ch-pts ${statusCls}">+${Math.round(earned ? displayPts : ch.bonus_points)} pts</span></div>
            </div>
          </div>
          <div class="ch-status-bar ${statusCls}">${statusBarHtml}</div>
        `;
        chList.appendChild(cardDiv);
      });
    })();

    var flaggedCount=myActs.filter(function(a){return a.is_flagged;}).length;
    var uniqueDays=new Set(myActs.filter(function(a){return !a.is_flagged;}).map(function(a){return getActDate(a);})).size;
    safeSetText('act-section-title', uniqueDays+' Days \u00b7 '+myActs.length+' Activities'+(flaggedCount?' \u00b7 '+flaggedCount+' Flagged':''));
    renderActivities(myActs, fullPts.dayBreakdown, fullPts.actBreakdown, reg.gender);

    hideSplash();

    // Auto-open activity detail modal if activityId is present in the URL query string
    var urlParams = new URLSearchParams(window.location.search);
    var urlActivityId = urlParams.get('activityId');
    if (urlActivityId) {
      setTimeout(function() {
        console.log('Auto-opening activity from query parameter:', urlActivityId);
        openActivityDetail(urlActivityId, null, true);
      }, 500);
    }

  } catch(e) {
    hideSplash();
    console.error('Load error:',e.message||e);
    var err='<div class="empty-state"><div class="icon">⚠️</div><p>Could not load data.<br>'+(e.message||'Unknown error')+'</p></div>';
    safeSetHtml('act-list', err);
    safeSetHtml('tab-dashboard', '<div style="padding:40px 20px;text-align:center;color:var(--muted)">⚠️ '+(e.message||'Load error')+'</div>');
  }
}

// Notification Fetcher
async function loadNotifications() {
  try {
    var session = JSON.parse(safeGetItem('wk_user') || '{}');
    var athleteId = session.athleteId;
    if (!athleteId) return;

    var res = await fetch(BACKEND + '/notifications?athlete_id=' + encodeURIComponent(athleteId));
    var data = await res.json();
    if (data.success && Array.isArray(data.notifications)) {
      _notificationsList = data.notifications;
      _notificationsLoaded = true;
      if (typeof renderNotifications === 'function') renderNotifications();
      if (typeof renderStanding === 'function' && typeof myActs !== 'undefined' && myActs && myActs.length > 0) {
        renderStanding();
      }
    }
  } catch (e) {
    console.warn('Failed to load notifications:', e);
  }
}
