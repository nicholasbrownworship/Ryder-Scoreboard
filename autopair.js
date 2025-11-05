/* autopair.js
 * Depends on globals from your main page:
 * - state, TEAM_FORMATS, save(), renderAll()
 * - state.format[day][side], state.groups[day][side], state.players, state.numGroups
 *
 * Optional globals used if present (fallbacks provided):
 * - desiredGroupSize(fmt)
 */

// ---------- Utilities ----------
(function () {
  if (!window.state) {
    console.warn("[autopair] state not found; load this after your main script.");
    return;
  }

  // Fallback if desiredGroupSize isn't global
  const TEAM_FORMATS = window.TEAM_FORMATS || new Set(['Best Ball','Scramble','Alt Shot','Shamble']);
  const desiredGroupSize =
    window.desiredGroupSize ||
    function(fmt){ return TEAM_FORMATS.has(fmt) ? 4 : 2; };

  function findPlayer(id){ return (state.players||[]).find(p=>p.id===id); }

  // Seeded RNG & shuffle (deterministic when seed provided)
  function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15, t|1); t^=t+Math.imul(t^t>>>7, t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
  function shuffle(arr, seed=null){
    const a = arr.slice();
    const rnd = seed==null ? Math.random : mulberry32(Number(seed) || 1);
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(rnd()* (i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Build availability for a given round (day+side)
  function availableByTeam(day, side, fillMode){
    const placed = new Set((state.groups[day][side]||[]).flat().filter(Boolean));
    const oz = [], va = [];
    for(const p of state.players||[]){
      // If fillMode = 'unassigned' we keep already-placed players available for OTHER groups only if we’re not overwriting.
      // But constraint is “once per side per day”, so skip anyone already placed in THIS round:
      if (placed.has(p.id)) continue;
      (p.team === 'valley' ? va : oz).push(p.id);
    }
    return { oz, va };
  }

  // Clear a round if overwrite
  function clearRoundIfNeeded(day, side, fillMode){
    if (fillMode !== 'overwrite') return;
    const fmt = state.format[day][side];
    const gs = desiredGroupSize(fmt);
    state.groups[day][side] = Array.from({length: state.numGroups}, ()=> Array(gs).fill(null));
  }

  // Fill for TEAM formats (2v2)
  function buildAssignmentsTeam(ozIds, vaIds, groupsCount, options){
    const seed = options.seed ?? null;
    const A = shuffle(ozIds, seed);
    const B = shuffle(vaIds, seed!=null ? Number(seed)+1 : null);

    const pairsA = [];
    for(let i=0;i<A.length;i+=2) pairsA.push(A.slice(i,i+2));
    const pairsB = [];
    for(let i=0;i<B.length;i+=2) pairsB.push(B.slice(i,i+2));

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

  // Fill for Singles (1v1)
  function buildAssignmentsSingles(ozIds, vaIds, groupsCount, options){
    const seed = options.seed ?? null;
    const A = shuffle(ozIds, seed);
    const B = shuffle(vaIds, seed!=null ? Number(seed)+1 : null);

    const assignments = Array.from({length: groupsCount}, ()=> [null,null]);
    let i=0, j=0, short = 0;

    for(let g=0; g<groupsCount; g++){
      const a = A[i] ?? null;
      const b = B[j] ?? null;
      if (a != null) { assignments[g][0]=a; i++; } else { short++; }
      if (b != null) { assignments[g][1]=b; j++; } else { short++; }
    }
    return { assignments, shortOz: Math.max(0, groupsCount - i), shortVa: Math.max(0, groupsCount - j) };
  }

  // Merge assignments into state groups respecting fillMode
  function applyAssignments(day, side, assignments, options){
    const fillUnassigned = options.fillMode === 'unassigned';
    const gs = assignments[0]?.length || 0;
    const groups = state.groups[day][side];

    for(let g=0; g<groups.length; g++){
      if (!groups[g]) groups[g] = Array(gs).fill(null);
      // ensure correct length
      const row = groups[g];
      while (row.length < gs) row.push(null);
      if (row.length > gs) row.length = gs;

      for(let i=0;i<gs;i++){
        const target = assignments[g][i] ?? null;
        if (fillUnassigned){
          if (row[i] == null) row[i] = target; // only fill empty
        } else {
          row[i] = target; // overwrite
        }
      }
    }
  }

  // ---------- Public entrypoints ----------
  function autoPairRound(day, side, options={}){
    const fmt = state.format[day][side];
    const gs  = desiredGroupSize(fmt);
    const isTeam = TEAM_FORMATS.has(fmt);

    const fillMode = options.fillMode || (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite');
    clearRoundIfNeeded(day, side, fillMode);

    // recompute availability AFTER optional clear
    const { oz, va } = availableByTeam(day, side, fillMode);

    // Build target assignments
    let res;
    if (isTeam && gs===4){
      res = buildAssignmentsTeam(oz, va, state.numGroups, options);
      applyAssignments(day, side, res.assignments, { fillMode });
      // messaging
      const msgs = [];
      if (res.shortA) msgs.push(`Ozark short by ${res.shortA} slot(s) on ${labelRound(day,side)}.`);
      if (res.shortB) msgs.push(`Valley short by ${res.shortB} slot(s) on ${labelRound(day,side)}.`);
      if (msgs.length) alert(msgs.join("\n"));
    } else {
      res = buildAssignmentsSingles(oz, va, state.numGroups, options);
      applyAssignments(day, side, res.assignments, { fillMode });
      const msgs = [];
      const need = state.numGroups;
      if (oz.length < need) msgs.push(`Ozark has only ${oz.length} available for singles on ${labelRound(day,side)} (need ${need}).`);
      if (va.length < need) msgs.push(`Valley has only ${va.length} available for singles on ${labelRound(day,side)} (need ${need}).`);
      if (msgs.length) alert(msgs.join("\n"));
    }

    if (typeof save === 'function') save();
    if (typeof renderAll === 'function') renderAll();
  }

  function autoPairDay(day, options={}){
    autoPairRound(day, 'front', options);
    autoPairRound(day, 'back',  options);
  }

  function autoPairAll(options={}){
    autoPairDay('day1', options);
    autoPairDay('day2', options);
  }

  function labelRound(day, side){
    return `${day==='day1'?'Day 1':'Day 2'} ${side==='front'?'Front 9':'Back 9'}`;
  }

  // ---------- Wire up buttons ----------
  function wireButtons(){
    const btnRound = document.getElementById('btnAutoPairRound');
    const btnDay   = document.getElementById('btnAutoPairDay');
    const btnAll   = document.getElementById('btnAutoPairAll');

    if (btnRound) btnRound.addEventListener('click', ()=>{
      autoPairRound(state.currentDay, state.side, { fillMode: (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite') });
    });
    if (btnDay) btnDay.addEventListener('click', ()=>{
      autoPairDay(state.currentDay, { fillMode: (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite') });
    });
    if (btnAll) btnAll.addEventListener('click', ()=>{
      autoPairAll({ fillMode: (document.getElementById('chkFillUnassigned')?.checked ? 'unassigned' : 'overwrite') });
    });
  }

  // init after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }

  // expose for debugging (optional)
  window.__autoPair = { autoPairRound, autoPairDay, autoPairAll };

})();

// ---- GLOBAL BRIDGE (must be last in your main JS) ----
window.state = window.state || state;
window.renderAll = window.renderAll || renderAll;
window.save = window.save || save;

window.TEAM_FORMATS = window.TEAM_FORMATS || TEAM_FORMATS;
window.desiredGroupSize = window.desiredGroupSize || desiredGroupSize;

// Optional: helpful to verify in console
console.log('[main] globals exposed:', {
  hasState: !!window.state,
  hasRenderAll: !!window.renderAll,
  hasSave: !!window.save,
  TEAM_FORMATS: window.TEAM_FORMATS ? [...window.TEAM_FORMATS] : null
});

