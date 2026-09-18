// Sylva's original proximity spring and specular-rim implementation, adapted to an independent navigation lifecycle.
let REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01=v=>Math.max(0,Math.min(1,v));
  var DOCK = { root: null, items: [], on: false, live: false, key: false, dirty: false, u: 1 };
  var SPEC = { items: [], on: false, dirty: false };
  var aimX = 0, aimY = 0, aimSeen = false, aimMoved = false;

  function fineHover() {
    return !REDUCED && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  }

  function measureDock() {
    if (!DOCK.root) return;
    DOCK.on = fineHover();
    DOCK.u = parseFloat(getComputedStyle(document.querySelector('.dock-wrap')).getPropertyValue('--u'));
    for (var i = 0; i < DOCK.items.length; i++) {
      var st = DOCK.items[i];
      st.el.style.width = st.el.style.height = st.el.style.transform = '';
      st.el.dataset.near = 'false';
      st.v = st.vel = st.target = 0;
    }
    for (i = 0; i < DOCK.items.length; i++) {
      var r = DOCK.items[i].el.getBoundingClientRect();
      DOCK.items[i].w = r.width;
      DOCK.items[i].h = r.height;
    }
    DOCK.live = false;
    DOCK.dirty = true;
    aimMoved = aimSeen;
  }

  function dockRest() {
    DOCK.live = false;
    DOCK.dirty = true;
    for (var i = 0; i < DOCK.items.length; i++) {
      DOCK.items[i].target = 0;
      DOCK.items[i].el.dataset.near = 'false';
    }
  }

  function drawDock(dt) {
    if (!DOCK.root || !DOCK.on || document.querySelector('.dock-wrap').classList.contains('is-side')) return;

    /* Targets are only recomputed when the pointer actually MOVES.
       Re-deriving them every frame from a stale position oscillates: the
       capsule is centred, so a growing pill shifts the whole bar sideways,
       which slides a different pill under a stationary cursor, which grows
       instead, which shifts it back.
       And whichever input moved last owns the dock, or the pointer's last
       position re-targets over keyboard focus and focus never takes. */
    if (aimSeen && aimMoved && !DOCK.key) {
      var rr = DOCK.root.getBoundingClientRect();
      /* the catch box reaches well below the bar, because that is where the
         pills grow to and the pointer has to be able to follow them */
      if (aimX > rr.left - 48 && aimX < rr.right + 48 && aimY > rr.top - 44 && aimY < rr.bottom + 104) {
        for (var i = 0; i < DOCK.items.length; i++) {
          var st = DOCK.items[i], r = st.el.getBoundingClientRect();
          var prox = clamp01(1 - Math.abs(aimX - (r.left + r.width * 0.5)) / (128 * DOCK.u));
          st.target = prox * prox * (3 - 2 * prox);
          st.el.dataset.near = st.target > 0.08 ? 'true' : 'false';
        }
        DOCK.live = true;
        DOCK.dirty = true;
      } else if (DOCK.live) dockRest();
    }

    if (!DOCK.dirty) return;
    var moving = false;
    for (i = 0; i < DOCK.items.length; i++) {
      st = DOCK.items[i];
      st.vel += (st.target - st.v) * 190 * dt;
      st.vel *= Math.exp(-23 * dt);
      st.v += st.vel * dt;
      if (Math.abs(st.target - st.v) < 0.001 && Math.abs(st.vel) < 0.004) { st.v = st.target; st.vel = 0; }
      else moving = true;

      var v = Math.min(Math.max(st.v, 0), 1.08);
      var mark = st.el.classList.contains('dock-mark');
      var ew = mark ? 14 * DOCK.u : Math.min(18 * DOCK.u, st.w * 0.24);
      var eh = mark ? 14 * DOCK.u : 16 * DOCK.u;
      st.el.style.width = (st.w + ew * v).toFixed(2) + 'px';
      st.el.style.height = (st.h + eh * v).toFixed(2) + 'px';
      st.el.style.transform = 'translateY(' + (v * 3.5 * DOCK.u).toFixed(2) + 'px)';
    }
    if (!moving) DOCK.dirty = false;
  }

  function drawSpec(dt) {
    if (!SPEC.on) return;

    if (aimSeen && aimMoved) {
      for (var i = 0; i < SPEC.items.length; i++) {
        var st = SPEC.items[i], r = st.el.getBoundingClientRect();
        var cx = r.left + r.width * 0.5, cy = r.top + r.height * 0.5;
        var dx = Math.max(r.left - aimX, 0, aimX - r.right);
        var dy = Math.max(r.top - aimY, 0, aimY - r.bottom);
        var d = Math.sqrt(dx * dx + dy * dy);
        /* inside the box there is no direction to point at, so bias off the
           corner and let the offset from centre steer it */
        st.tAng = d === 0
          ? Math.atan2(2 / Math.max(r.height, 1), -2 / Math.max(r.width, 1)) +
            ((aimX - cx) / Math.max(r.width * 0.5, 1)) * 0.30 +
            ((cy - aimY) / Math.max(r.height * 0.5, 1)) * 0.15
          : Math.atan2(cy - aimY, aimX - cx);
        var raw = clamp01(1 - d / (st.reach * DOCK.u));
        st.tBr = Math.max(raw * raw * (3 - 2 * raw), st.focused ? 0.9 : 0);
      }
      SPEC.dirty = true;
    }

    if (!SPEC.dirty) return;
    var moving = false;
    for (i = 0; i < SPEC.items.length; i++) {
      st = SPEC.items[i];
      var diff = ((st.tAng - st.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      st.ang += diff * (1 - Math.exp(-dt * 8));
      st.br += (st.tBr - st.br) * (1 - Math.exp(-dt * 9));
      if (Math.abs(diff) < 0.001 && Math.abs(st.tBr - st.br) < 0.002) { st.ang = st.tAng; st.br = st.tBr; }
      else moving = true;
      st.el.style.setProperty('--spec-angle', st.ang.toFixed(4) + 'rad');
      st.el.style.setProperty('--spec-bright', (clamp01(st.br) * 0.92).toFixed(3));
    }
    if (!moving) SPEC.dirty = false;
  }

  function initDock() {
    var root = document.querySelector('.dock');
    if (!root) return;
    DOCK.root = root;
    DOCK.items = [].map.call(root.querySelectorAll('[data-dock]'), function (el) {
      return { el: el, w: 0, h: 0, v: 0, vel: 0, target: 0 };
    });
    SPEC.items = [].map.call(document.querySelectorAll('[data-spec]'), function (el) {
      return { el: el, ang: 2.4, tAng: 2.4, br: 0, tBr: 0, focused: false,
               reach: el.classList.contains('dock') ? 250 : 185 };
    });
    SPEC.on = fineHover();

    measureDock();
    /* the labels set the pill widths, so the base measure is wrong until the
       real face has landed */
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureDock);
    window.addEventListener('resize', measureDock);

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      aimX = e.clientX; aimY = e.clientY; aimSeen = true; aimMoved = true; DOCK.key = false;
      DOCK.dirty = SPEC.dirty = true;
    }, { passive: true });

    window.addEventListener('pointerleave', function () {
      aimSeen = false;
      dockRest();
      for (var i = 0; i < SPEC.items.length; i++) SPEC.items[i].tBr = SPEC.items[i].focused ? 0.9 : 0;
      SPEC.dirty = true;
    });

    /* keyboard gets the same magnification, centred on the focused pill */
    root.addEventListener('focusin', function (e) {
      var item = e.target.closest('[data-dock]');
      if (!item || !DOCK.on) return;
      var idx = DOCK.items.map(function (st) { return st.el; }).indexOf(item);
      DOCK.items.forEach(function (st, i) {
        st.target = i === idx ? 1 : Math.abs(i - idx) === 1 ? 0.24 : 0;
        st.el.dataset.near = st.target > 0.08 ? 'true' : 'false';
      });
      DOCK.live = false; DOCK.key = true; DOCK.dirty = true;
    });
    root.addEventListener('focusout', function () {
      requestAnimationFrame(function () {
        if (!root.contains(document.activeElement)) { DOCK.key = false; dockRest(); }
      });
    });
    for (var i = 0; i < SPEC.items.length; i++) (function (st) {
      st.el.addEventListener('focusin', function () { st.focused = true; SPEC.dirty = true; });
      st.el.addEventListener('focusout', function () { st.focused = false; SPEC.dirty = true; });
    })(SPEC.items[i]);
  }
  initDock();
  const wrap=document.querySelector('.dock-wrap');
  const links=[...wrap.querySelectorAll('a[href^="#"]:not(.dock-mark)')];
  const sections=links.map(a=>document.querySelector(a.getAttribute('href')));
  let dockAnimations=[];
  function setSide(side){
    if(wrap.classList.contains('is-side')===side)return;
    dockAnimations.forEach(animation=>animation.cancel());
    const elements=[DOCK.root,...DOCK.items.map(item=>item.el)];
    const before=elements.map(el=>el.getBoundingClientRect());
    wrap.classList.toggle('is-side',side);
    dockRest();measureDock();
    const after=elements.map(el=>el.getBoundingClientRect());
    if(REDUCED)return;
    dockAnimations=elements.map((el,i)=>{
      const a=before[i],b=after[i];
      // Children inherit the dock's translation; offset that to preserve their own path.
      const dx=a.left-b.left-(i?before[0].left-after[0].left:0);
      const dy=a.top-b.top-(i?before[0].top-after[0].top:0);
      return el.animate([{translate:dx+'px '+dy+'px'},{translate:'0px 0px'}],{duration:650,easing:'cubic-bezier(.22,1,.36,1)'});
    });
  }
  function syncSection(){
    setSide(document.querySelector('#verify').getBoundingClientRect().top<=innerHeight*.6);
    wrap.classList.toggle('is-scrolled',window.scrollY>50);
    let index=0; sections.forEach((section,i)=>{if(section.getBoundingClientRect().top<=innerHeight*.4)index=i;});
    links.forEach((a,i)=>{a.classList.toggle('is-active',i===index);if(i===index)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
  }
  let scrollPending=false;
  window.addEventListener('scroll',()=>{if(!scrollPending){scrollPending=true;requestAnimationFrame(()=>{syncSection();scrollPending=false;});}},{passive:true});
  syncSection();
  window.addEventListener('resize',syncSection);
  let last=performance.now(),frame;
  function tick(now){let dt=Math.min((now-last)/1000,.035);last=now;drawDock(dt);drawSpec(dt);aimMoved=false;frame=requestAnimationFrame(tick);}
  frame=requestAnimationFrame(tick);
  document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(frame);if(!document.hidden){last=performance.now();frame=requestAnimationFrame(tick);}});
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{REDUCED=e.matches;SPEC.on=fineHover();measureDock();});
