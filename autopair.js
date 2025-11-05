/* autopair.js (defensive + auto-sanitize + reset button + singles=2 matches)
 * Requires your page to define: state, save(), renderAll()
 * Optional globals: TEAM_FORMATS (Set), desiredGroupSize(fmt)
 */

(function () {
  'use strict';

  if (!window.state) {
    console.warn("[autopair] 'state' not found; load this AFTER your main inline script.");
    return;
  }

  // ---------- Safe config fallbacks ----------
  const TEAM_FORMATS =
    (window.TEAM_FORMATS instanceof Set && window.TEAM_FORMATS.size)
      ? window.TEAM_FORMATS
      : new Set(['Best Ball','Scramble','Alt Shot','Shamble']);

  // Fallback: if the page didn't define desiredGroupSize, default to 4 for team,
  // 2 for singles. (Your page should override to 4 for singles to show 2 matches.)
  const desiredGroupSize =
    typeof window.desiredGroupSize === 'function'
      ? window.desiredGroupSize
      : (fmt => TEAM_FORMATS.has(fmt) ? 4 : 2);

  // ---------- State sanitizer ----------
  function sanitizeGroupsState() {
    if (!state.groups || typeof state.groups !== 'object') {
      state.groups = { day1:{front:[],back:[]}, day2:{front:[],back:[]} };
    }
    if (!state.groups.day1 || typeof state.groups.day1 !== 'object') state.groups.day1 = { front:[], back:[] };
    if (!state.groups.day2 || typeof state.groups.day2 !== 'object') state.groups.day2 = { front:[], back:[] };
    ['day1','day2'].forEach(day=>{
      ['front','back'].forEach(side=>{
        if (!Array.isArray(state.groups[day][side])) state.groups[day][side] = [];
      });
    });
    return state.groups;
  }

  // Wrap renderAll so it always sanitizes first
  if (typeof window.renderAll === 'function' && !window.__renderAllWrapped) {
    const _renderAll = window.renderAll;
    window.renderAll = function wrappedRenderAll() {
      try { sanitizeGroupsState(); } catch (e) { console.warn('[autopair] sanitize before renderAll failed', e); }
      return _renderAll.apply(this, arguments);
    };
    window.__renderAllWrapped = true;
  }

  // ---------- Utilities ----------
  function findPlayer(id){ return (state.players||[]).find(p=>p.id===id); }

  function mulberry32(a){
    return function(){
      let t=a+=0x6D2B79F5;
      t=Math.imul(t^t>>>15, t|1);
      t^=t+Math.imul(t^t>>>7, t|61);
      return ((t^t>>>14)>>>0)/4294967296;
    };
  }
  function shuffle(arr, seed=null){
    const a = arr.slice();
    const rnd = seed==null ? Math.random : mulberry32(Number(seed) || 1);
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(rnd()* (i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function labelRound(day, side){
    return `${day==='day1'?'Day 1':'Day 2'} ${side==='front'?'Front 9':'Back 9'}`;
  }

  // ---------- Safe group ensure ----------
  function ensureSide(day, side, fmt){
    sanitizeGroupsState();
    const gs = desiredGroupSize(fmt);
    const count = Math.max(1, Number(state.numGroups)||1);
    let arr = state.groups[day][side];
    if (!Array.isArray(arr) || arr.length !== count) {
      arr = Array.from({length: count}, ()=> Array(gs).fill(null));
    } else {
      arr = arr.map(g=>{
        const x = Array.isArray(g) ? g.slice(0, gs) : [];
        while (x.length < gs) x.push(null);
        return x;
      });
    }
    state.groups[day][side] = arr;
  }

  // ---------- Availability ----------
  function availableByTeam(day, side){
    const placed = new Set((state.groups?.[day]?.[side]||[]).flat().filter(Boolean));
    const oz = [], va = [];
    for(const p of state.players||[]){
      if (placed.has(p.id)) continue;
      (p.team === 'valley' ? va : oz).push(p.id);
    }
    return { oz, va };
  }

  // ---------- Builders ----------
  function buildAssignmentsTeam(ozIds, vaIds, groupsCount, options){
    const seed = options.seed ?? null;
    const A = shuffle(ozIds, seed);
    const B = shuffle(vaIds, seed!=null ? Number(seed)+1 : null);
    const mkPairs = arr => { const out=[]; for(let i=0;i<arr.length;i+=2) out.push(arr.slice(i,i+2)); return out; };
    const pairsA = mkPairs(A), pairsB = mkPairs(B);

    const assignments = Array.from({length: groupsCount}, ()=> [null,null,null,null]);
    let pa = 0, pb = 0, shortA = 0, shortB = 0;

    for(let g=0; g<groupsCount; g++){
      const pairA = pairsA[pa] || [];
      const pairB = pairsB[pb] || [];

      if (pairA.length === 2){ assignments[g][0]=pairA[0]; assignments[g][1]=pairA[1]; pa++; }
      else { if (pairA.length===1){ assignments[g][0]=pairA[0]; } shortA += (2 - pairA.length); }

      if (pairB.length === 2){ assignments[g][2]=pairB[0]; assignments[g][3]=pairB[1]; pb++; }
      else { if (pairB.length===1){ assignments[g][2]=pairB[0]; } shortB += (2 - pairB.length); }
    }
    return { assignments, shortA, shortB };
  }

  // Singles = two 1v1 matches per group -> 4 slots per group:
  // positions (0 vs 1) and (2 vs 3)
  function buildAssignmentsSingles(ozIds, vaIds, groupsCount, options){
    const seed = options.seed ?? null;
    const A = shuffle(ozIds, seed);
    const B = shuffle(vaIds, seed!=null ? Number(seed)+1 : null);

    const assignments = Array.from({length: groupsCount}, ()=> [null,null,null,null]);

    let i=0, j=0;
    for(let g=0; g<groupsCount; g++){
      // Match 1
      assignments[g][0] = A[i] ?? null; if (A[i] != null) i++;
      assignments[g][1] = B[j] ?? null; if (B[j] != null) j++;
      // Match 2
      assignments[g][2] = A[i] ?? null; if (A[i] != null) i++;
      assignments[g][3] = B[j] ?? null; if (B[j] != null) j++;
    }

    const needPerSide = groupsCount * 2; // two OZ + two VA per group across two matches
    const shortOz = Math.max(0, needPerSide - i);
    const shortVa = Math.max(0, needPerSide - j);
    return { assignments, shortOz, shortVa };
  }

  // ---------- Apply ----------
  function applyAssignments(day, side, assignments, options){
    const fillUnassigned = options.fillMode === 'unassigned';
    const gs = assignments[0]?.length || 0;
    const groups = state.groups[day][side];

    for(let g=0; g<groups.length; g++){
      if (!groups[g]) groups[g] = Array(gs).fill(null);
      const row = groups[g];
      while (row.length < gs) row.push(null);
      if (row.length > gs) row.length = gs;

      for(let i=0;i<gs;i++){
        const target = assignments[g][i] ?? null;
        if (fillUnassigned){
          if (row[i] == null) row[i] = target;
        } else {
          row[i] = target;
        }
      }
    }
  }

  // ---------- Public API ----------
  function autoPairRound(day, side, options={}){
    try {
      sanitizeGroupsState();
      const fmt = (state.format?.[day]?.[side]) || 'Best Ball';
      ensureSide(day, side, fmt);

      const gs  = desiredGroupSize(fmt);
      const isTeam = TEAM_FORMATS.has(fmt);

      const fillMode =
        options.fillMode ||
        (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite');

      if (fillMode === 'overwrite') {
        state.groups[day][side] = Array.from({length: Math.max(1, Number(state.numGroups)||1)}, ()=> Array(gs).fill(null));
      }

      const { oz, va } = availableByTeam(day, side);

      console.log('[autopair] run', { day, side, fmt, isTeam, gs, fillMode, numGroups: state.numGroups, availOz: oz.length, availVa: va.length });

      if (isTeam && gs===4){
        const res = buildAssignmentsTeam(oz, va, Math.max(1, Number(state.numGroups)||1), options);
        applyAssignments(day, side, res.assignments, { fillMode });
        const msgs = [];
        if (res.shortA) msgs.push(`Ozark short by ${res.shortA} slot(s) on ${labelRound(day,side)}.`);
        if (res.shortB) msgs.push(`Valley short by ${res.shortB} slot(s) on ${labelRound(day,side)}.`);
        if (msgs.length) alert(msgs.join("\n"));
      } else {
        // Singles: need 2 OZ and 2 VA per group to make two 1v1 matches
        const groupsCount = Math.max(1, Number(state.numGroups)||1);
        const res = buildAssignmentsSingles(oz, va, groupsCount, options);
        applyAssignments(day, side, res.assignments, { fillMode });
        const needPerSide = groupsCount * 2;
        const msgs = [];
        if (oz.length < needPerSide) msgs.push(`Ozark has only ${oz.length} available for singles on ${labelRound(day,side)} (need ${needPerSide}).`);
        if (va.length < needPerSide) msgs.push(`Valley has only ${va.length} available for singles on ${labelRound(day,side)} (need ${needPerSide}).`);
        if (msgs.length) alert(msgs.join("\n"));
      }

      if (typeof save === 'function') save();
      if (typeof renderAll === 'function') renderAll();
    } catch (err) {
      console.error('[autopair] ERROR in autoPairRound:', err);
      alert('Auto-pair hit an error. Check console for details.');
    }
  }

  function autoPairDay(day, options={}){ autoPairRound(day, 'front', options); autoPairRound(day, 'back', options); }
  function autoPairAll(options={}){ autoPairDay('day1', options); autoPairDay('day2', options); }

  // ---------- Reset helper (all rounds, both days) ----------
  function resetAllGroups() {
    sanitizeGroupsState();
    const days  = ['day1','day2'];
    const sides = ['front','back'];
    const count = Math.max(1, Number(state.numGroups) || 1);
    days.forEach(day => {
      sides.forEach(side => {
        const fmt = (state.format?.[day]?.[side]) || 'Best Ball';
        const gs  = typeof desiredGroupSize === 'function' ? desiredGroupSize(fmt) : 4;
        state.groups[day][side] = Array.from({ length: count }, () => Array(gs).fill(null));
      });
    });
  }

  // ---------- Wire buttons ----------
  function wireButtons(){
    const btnRound = document.getElementById('btnAutoPairRound');
    const btnDay   = document.getElementById('btnAutoPairDay');
    const btnAll   = document.getElementById('btnAutoPairAll');

    if (btnRound) btnRound.addEventListener('click', ()=>{
      console.log('[autopair] Click: This round', { day: state.currentDay, side: state.side });
      autoPairRound(state.currentDay, state.side, {
        fillMode: (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite')
      });
    });
    if (btnDay) btnDay.addEventListener('click', ()=>{
      console.log('[autopair] Click: Both rounds (day)', { day: state.currentDay });
      autoPairDay(state.currentDay, {
        fillMode: (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite')
      });
    });
    if (btnAll) btnAll.addEventListener('click', ()=>{
      console.log('[autopair] Click: All rounds');
      autoPairAll({
        fillMode: (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite')
      });
    });

    // Inject "Reset all groups" next to Clear side
    const btnClearSide = document.getElementById('btnClearSide');
    if (btnClearSide && !document.getElementById('btnResetGroups')) {
      const btnReset = document.createElement('button');
      btnReset.id = 'btnResetGroups';
      btnReset.className = 'btn warn';
      btnReset.style.marginLeft = '6px';
      btnReset.textContent = 'Reset all groups';
      btnClearSide.insertAdjacentElement('afterend', btnReset);

      btnReset.addEventListener('click', ()=>{
        if (!confirm('Reset ALL groups (Day 1 & Day 2, Front & Back) to empty slots?')) return;
        resetAllGroups();
        if (typeof save === 'function') save();
        if (typeof renderAll === 'function') renderAll();
        alert('All groups reset.');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }

  // expose for debugging
  window.__autoPair = { autoPairRound, autoPairDay, autoPairAll, __sanitize: sanitizeGroupsState, resetAllGroups };

  // startup ping + first sanitize
  try {
    sanitizeGroupsState();
    console.log('[autopair] ready', { hasState: !!window.state, TEAM_FORMATS: TEAM_FORMATS ? [...TEAM_FORMATS] : null });
  } catch {}
})();
