/* ==========================================================================
   The Museum of Human Decisions
   Everything here is progressive enhancement: with no JavaScript, or with
   reduced motion, every room is still readable and every exhibit reachable.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const reduce = reduceQuery.matches;
  const hasGSAP = !!window.gsap;
  const motion = hasGSAP && !reduce;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  window.__museumReady = true;
  if (motion) {
    document.documentElement.classList.add('motion');
  } else {
    document.documentElement.classList.remove('motion');
  }

  const visit = { start: Date.now(), decisions: 0, files: new Set() };

  // Deterministic randomness, so installations look the same on every visit
  function seeded(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Size a canvas to its box at device resolution; returns CSS-pixel size
  function fitCanvas(canvas, ctx) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  }

  // Run a frame loop only while the element is on screen
  function loopWhileVisible(el, frame) {
    let raf = 0, on = false, last = 0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame(dt, now / 1000);
      if (on) raf = requestAnimationFrame(tick);
    };
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !on) { on = true; last = performance.now(); raf = requestAnimationFrame(tick); }
      else if (!e.isIntersecting && on) { on = false; cancelAnimationFrame(raf); }
    }, { rootMargin: '120px' }).observe(el);
  }

  // In-page links: go there, then move keyboard focus to the destination
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const target = id.length > 1 && document.getElementById(id.slice(1));
      if (!target) return;
      e.preventDefault();
      const land = () => {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      };
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      land();
      history.replaceState(null, '', id);
    });
  });

  /* ------------------------------------------------------------------------
     Wayfinding — which room are we standing in?
     ------------------------------------------------------------------------ */
  const bar = $('.museum-bar');
  const floorplan = $('.floorplan');
  const rooms = $$('.room');
  let currentRoom = null;

  function enterRoom(room) {
    if (room === currentRoom) return;
    currentRoom = room;
    refreshChrome();
    const at = rooms.indexOf(room);
    $$('[data-room-link]').forEach((a, j) => {
      if (j === at) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
      a.classList.toggle('is-passed', j < at);
    });
    if (room.id === 'reflection-room') updateVisitSummary();
  }
  const roomObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) enterRoom(e.target); });
  }, { rootMargin: '-45% 0px -54% 0px' });
  rooms.forEach((r) => roomObserver.observe(r));

  // The visitor route: the red marker walks between stations as you move through each room
  let routeQueued = false;
  const updateRoute = () => {
    routeQueued = false;
    const y = window.scrollY + window.innerHeight * 0.5;
    const tops = rooms.map((r) => r.getBoundingClientRect().top + window.scrollY);
    let i = 0;
    while (i < tops.length - 1 && y >= tops[i + 1]) i++;
    const last = i === tops.length - 1;
    const frac = last ? 0 : clamp((y - tops[i]) / (tops[i + 1] - tops[i]));
    floorplan.style.setProperty('--p', ((i + frac) / (tops.length - 1)).toFixed(4));
  };
  const queueRoute = () => { if (!routeQueued) { routeQueued = true; requestAnimationFrame(updateRoute); } };
  window.addEventListener('scroll', queueRoute, { passive: true });
  window.addEventListener('resize', queueRoute);
  updateRoute();

  // The header and the route take on the colour of the room you are in
  function refreshChrome() {
    if (!currentRoom) return;
    const bg = getComputedStyle(currentRoom).backgroundColor;
    bar.style.setProperty('--bar-bg', bg);
    floorplan.style.setProperty('--fp-bg', bg);
  }

  /* ------------------------------------------------------------------------
     Room 01 — The Entrance: a tree of forking paths. Every fork is a decision.
     A red marker walks it, choosing a branch at each fork; it leans towards
     the visitor's pointer, so the visitor is the one deciding.
     ------------------------------------------------------------------------ */
  function initEntrance() {
    const section = $('#entrance');
    const canvas = $('.entrance-canvas');
    const ctx = canvas.getContext('2d');
    const INK = '242,242,242';
    const RED = '#ff3939';
    const LEVELS = 7;

    // The tree, in unit space: the root at the bottom centre, forking upwards
    const rnd = seeded(5);
    const build = (x, y, depth, spread, parent) => {
      const node = { x, y, depth, parent, kids: [] };
      if (depth < LEVELS) {
        const rise = (0.88 / LEVELS) * (0.85 + rnd() * 0.3);
        [-1, 1].forEach((side) => {
          node.kids.push(build(x + side * spread * (0.8 + rnd() * 0.4), y - rise, depth + 1, spread * 0.5, node));
        });
      }
      return node;
    };
    const root = build(0.5, 0.97, 0, 0.2, null);
    const all = [];
    (function collect(n) { all.push(n); n.kids.forEach(collect); })(root);

    // A branch is a soft S-curve from parent to child
    const point = (a, b, t, w, h) => {
      const my = (a.y + b.y) / 2;
      const u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * b.x;
      const y = u * u * u * a.y + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * b.y;
      return [x * w, y * h];
    };
    const branch = (a, b, upTo, w, h) => {
      const steps = Math.max(2, Math.round(18 * upTo));
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const [x, y] = point(a, b, (i / steps) * upTo, w, h);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };

    let grown = reduce ? LEVELS : 0;   // how many levels have grown in
    let pointerX = null;               // where the visitor is pointing, 0 to 1
    const walk = { path: [root], t: 0, rest: 0 };

    const choose = (node) => {
      if (pointerX === null) return node.kids[rnd() < 0.5 ? 0 : 1];
      return Math.abs(node.kids[0].x - pointerX) < Math.abs(node.kids[1].x - pointerX) ? node.kids[0] : node.kids[1];
    };

    const draw = () => {
      const { w, h } = fitCanvas(canvas, ctx);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';

      // every possible path, drawn quietly
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${INK},.13)`;
      all.forEach((n) => {
        if (!n.parent) return;
        const upTo = clamp(grown - (n.depth - 1));
        if (upTo > 0) branch(n.parent, n, upTo, w, h);
      });
      if (grown >= LEVELS) {
        ctx.fillStyle = `rgba(${INK},.3)`;
        all.forEach((n) => {
          if (n.kids.length) return;
          ctx.beginPath(); ctx.arc(n.x * w, n.y * h, 1.6, 0, Math.PI * 2); ctx.fill();
        });
      }

      // the path actually taken
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${INK},.55)`;
      for (let i = 1; i < walk.path.length; i++) {
        const last = i === walk.path.length - 1;
        branch(walk.path[i - 1], walk.path[i], last ? walk.t : 1, w, h);
      }
      const n = walk.path.length;
      const [mx, my] = n > 1 ? point(walk.path[n - 2], walk.path[n - 1], walk.t, w, h) : [root.x * w, root.y * h];
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2); ctx.fill();
    };

    if (reduce) {
      // a still image: the whole tree, and one path already chosen
      let node = root;
      while (node.kids.length) { node = choose(node); walk.path.push(node); }
      walk.t = 1;
      requestAnimationFrame(draw);
      window.addEventListener('resize', draw);
      return;
    }

    section.addEventListener('pointermove', (e) => {
      const r = section.getBoundingClientRect();
      pointerX = (e.clientX - r.left) / r.width;
    });
    section.addEventListener('pointerleave', () => { pointerX = null; });

    loopWhileVisible(section, (dt) => {
      grown = Math.min(LEVELS, grown + dt * 2.6);
      if (grown >= 1) {
        const here = walk.path[walk.path.length - 1];
        if (walk.path.length === 1) {
          walk.path.push(choose(root)); walk.t = 0;
        } else if (walk.t < 1) {
          walk.t = Math.min(1, walk.t + dt * 1.1);
        } else if (here.kids.length && here.depth < grown) {
          walk.path.push(choose(here)); walk.t = 0;
        } else if (!here.kids.length) {
          // arrived: rest a moment, then set out again
          walk.rest += dt;
          if (walk.rest > 1.6) { walk.path = [root]; walk.t = 0; walk.rest = 0; }
        }
      }
      draw();
    });
  }

  /* ------------------------------------------------------------------------
     Arrival (motion only, plays once on load)
     ------------------------------------------------------------------------ */
  function initArrival() {
    if (!motion) return;

    // Arrival
    gsap.set('.statement-inner', { yPercent: 110 });
    gsap.set('.statement', { visibility: 'visible' });
    const intro = gsap.timeline({ delay: 0.35 });
    intro
      .to('.statement-inner', { yPercent: 0, duration: 1.8, ease: 'expo.out', stagger: 0.16 })
      .to('#entrance [data-reveal]', { opacity: 1, y: 0, duration: 1.4, ease: 'expo.out', stagger: 0.12 }, 0.5)
      .from('.admission', { opacity: 0, duration: 1.5 }, 1.2);

  }

  /* ------------------------------------------------------------------------
     Room 03 — Evidence Wall
     ------------------------------------------------------------------------ */
  const PROJECTS = {
    careline: {
      tone: 'file',
      kicker: 'Case file HC-0117 · Healthcare',
      title: 'CareLine',
      lede: 'Booking a doctor without the 7am phone queue, for fourteen practices and the people who dread calling them.',
      meta: [['Role', 'Lead UX designer'], ['Team', '2 designers, 1 researcher, 6 engineers'], ['Duration', '9 months'], ['Scope', 'Research, service design, booking flow, design QA']],
      chapters: [
        { label: 'The person', title: 'People weren’t failing to book. They were failing to get through.', body: [
          'We spent two weeks in waiting rooms and on the phones with receptionists. The pattern was clear: most callers already knew what they needed. What they lacked was visibility. Nobody could see whether an appointment existed before committing to the queue.',
          'Older patients, carers and shift workers were hit hardest. For them, the phone line was the only door, and it was open for 40 minutes a day.' ],
          quote: ['I book at 7am because that’s when I’m brave enough to call.', 'Participant 07, age 68'] },
        { label: 'The friction', title: 'Every existing flow asked who you were before showing what was possible.', body: [
          'Login, then patient details, then reason for visit, then availability. Forty percent of people abandoned before they ever saw a time slot, and many then phoned anyway.' ] },
        { label: 'The decisions', tradeoffs: [
          ['Availability before identity', 'Login first', 'People commit when they can see a real option. Identity is asked for only once a slot is chosen.'],
          ['Plain-language reasons', 'Clinical triage codes', 'Patients describe symptoms in their own words. A light triage layer maps them for staff, not the other way round.'],
          ['Keep the phone line, make it quieter', 'Digital only', 'Excluding people who can’t or won’t use an app was never acceptable. Success meant the phone line served the people who needed it most.'] ] },
        { label: 'What changed', outcomes: [['−41%', 'calls to the morning queue within three months'], ['3 taps', 'to book from the home screen, down from 11'], ['1,000', 'patients a day booking without calling, by month six']] },
        { label: 'What I’d do differently', body: [
          'I’d bring receptionists into co-design sessions from week one, not week six. They knew the edge cases better than any dataset, and they became the product’s strongest advocates once they were included.' ] },
      ],
    },
    ledger: {
      tone: 'slips',
      kicker: 'Transaction slips · Fintech',
      title: 'Ledger',
      lede: 'A business bank account that explains its own numbers, so a payment never arrives as a small panic.',
      meta: [['Role', 'Senior product designer'], ['Team', 'Squad of 9, with risk and compliance'], ['Duration', '7 months'], ['Scope', 'Transactions, statements, payment confirmations']],
      chapters: [
        { label: 'The person', title: 'Small business owners read statements the way you read a letter from the tax office.', body: [
          'Diary studies with 16 owners showed the same moment again and again: an unfamiliar line on a statement, a jolt of worry, then 20 minutes of searching emails to work out what it was.' ],
          quote: ['I don’t mind paying things. I mind not knowing what I paid.', 'Café owner, diary study, week 2'] },
        { label: 'The friction', title: 'Merchant descriptors were written for banks, not people.', body: [
          '“DD MBRSHP 88-21” is perfectly clear to a payments system. To a person it reads as a mystery charge. Foreign exchange adjustments and pending holds made it worse, moving the balance without any visible reason.' ] },
        { label: 'The decisions', tradeoffs: [
          ['Explain every line in plain words', 'Show raw descriptors', 'We enriched transactions with merchant names, logos and a one-line reason. Raw data stays one tap away for accountants.'],
          ['Show the balance you can actually spend', 'Show the ledger balance', 'Pending holds were the biggest source of “where did my money go?” tickets.'],
          ['Ask before categorising', 'Auto-categorise silently', 'Silent mistakes eroded trust faster than slower, confirmed ones.'] ] },
        { label: 'What changed', outcomes: [['−52%', '“unrecognised payment” support tickets'], ['38% → 12%', 'drop-off in the payment flow after redesign'], ['4.7★', 'app rating among business customers, up from 3.9']] },
        { label: 'What I’d do differently', body: [
          'We underestimated how many owners share access with a partner or bookkeeper. I’d design for shared visibility from the start, not as a phase-two feature.' ] },
      ],
    },
    foundation: {
      tone: 'blueprint',
      kicker: 'Architectural plans · Design system',
      title: 'Foundation',
      lede: 'A design system for forty product teams, built like a building: structure first, decoration last, and accessibility in the foundations.',
      meta: [['Role', 'Design system lead'], ['Team', '3 designers, 4 engineers, 40 contributing teams'], ['Duration', '2023 to now'], ['Scope', 'Tokens, components, governance, documentation']],
      chapters: [
        { label: 'The person', title: 'The users of a design system are designers and engineers on a deadline.', body: [
          'We interviewed 31 people across product teams. Nobody wanted more components. They wanted fewer decisions to argue about, and confidence that what they shipped was accessible.' ],
          quote: ['I just want to know which button to use without a meeting.', 'Front-end engineer, payments team'] },
        { label: 'The friction', title: 'Four button styles, eleven greys and no single source of truth.', body: [
          'An audit found 230 near-duplicate components across products. Each had been a reasonable decision locally. Together they made every product feel slightly different, and slightly harder to use.' ] },
        { label: 'The decisions', tradeoffs: [
          ['Tokens before components', 'Ship a component library first', 'Agreeing on colour, type and spacing first made every later component cheaper to build and easier to theme.'],
          ['Accessibility as a default, not a checklist', 'Audit at the end', 'Every component ships with keyboard behaviour, focus states and contrast built in. Teams inherit compliance instead of retrofitting it.'],
          ['Contribution model', 'Central team builds everything', 'Teams propose, the core team reviews. The system grows at the speed of the organisation.'] ] },
        { label: 'What changed', outcomes: [['230 → 64', 'components after consolidation'], ['40', 'teams building on the same foundations'], ['−60%', 'accessibility defects found in QA']] },
        { label: 'What I’d do differently', body: [
          'I would publish decisions, not just components. The most-read page in the docs turned out to be “why we did it this way”.' ] },
      ],
    },
    atlas: {
      tone: 'map',
      kicker: 'Intelligence map · AI',
      title: 'Atlas',
      lede: 'An AI assistant for GP practices that drafts replies to patients, and knows when to hand the decision back to a clinician.',
      meta: [['Role', 'Principal designer, AI'], ['Team', 'ML, clinical safety, 2 practices as partners'], ['Duration', '10 months'], ['Scope', 'Interaction model, uncertainty UX, clinician workflow']],
      chapters: [
        { label: 'The person', title: 'Clinicians weren’t short of skill. They were short of minutes.', body: [
          'GPs in our partner practices spent up to two hours a day answering routine messages: repeat prescriptions, test results, appointment questions. Every minute spent there was a minute not spent with a patient in the room.' ],
          quote: ['I trust it when it tells me what it isn’t sure about.', 'GP partner, week 9 of the pilot'] },
        { label: 'The friction', title: 'A confident AI is easy to build. A trustworthy one is a design problem.', body: [
          'Early prototypes drafted fluent, plausible replies. Clinicians approved 94% of them unchanged, which sounded like success until we realised it meant they had stopped reading closely.' ] },
        { label: 'The decisions', tradeoffs: [
          ['Show uncertainty, visibly', 'Present every draft the same way', 'Drafts carry a confidence signal and highlight the exact sentence the model is unsure about, so attention goes where it matters.'],
          ['Automate the routine, escalate the rest', 'Full automation, or none', 'Admin replies send automatically after a short delay. Anything clinical needs a human.'],
          ['Explain the source', 'Fluent answers without context', 'Each draft cites the record entries it used. Clinicians verify in seconds rather than searching.'] ] },
        { label: 'What changed', outcomes: [['11,400', 'clinician hours returned per year across the pilot'], ['4 h → 52 min', 'median reply time to patients'], ['0', 'clinical safety incidents during the pilot']] },
        { label: 'What I’d do differently', body: [
          'I would run safety reviews with patients, not only clinicians. The people receiving the messages had sharp, different instincts about tone and about what should never be automated.' ] },
      ],
    },
  };
  const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

  function renderStory(p) {
    const meta = p.meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const chapters = p.chapters.map((c, i) => {
      let body = '';
      if (c.title) body += `<h3>${c.title}</h3>`;
      if (c.body) body += c.body.map((t) => `<p>${t}</p>`).join('');
      if (c.quote) body += `<blockquote class="story-quote"><p>“${c.quote[0]}”</p><cite>${c.quote[1]}</cite></blockquote>`;
      if (c.tradeoffs) {
        body += `<ul class="tradeoffs" role="list">${c.tradeoffs.map(([chose, over, why]) =>
          `<li><span class="t-k">Chose</span><span class="t-chose">${chose}</span><span class="t-k">Over</span><span class="t-over">${over}</span><p class="t-why">${why}</p></li>`).join('')}</ul>`;
      }
      if (c.outcomes) {
        body += `<ul class="outcomes" role="list">${c.outcomes.map(([fig, t]) => `<li><b>${fig}</b>${t}</li>`).join('')}</ul>`;
      }
      return `<section class="chapter"><p class="chapter-label"><b aria-hidden="true">${NUMERALS[i]}</b>${c.label}</p><div class="chapter-body">${body}</div></section>`;
    }).join('');
    return `
      <header class="story-head">
        <p class="story-kicker">${p.kicker}</p>
        <h2 class="story-title" id="dlg-title">${p.title}</h2>
        <p class="story-lede">${p.lede}</p>
        <dl class="story-meta">${meta}</dl>
      </header>
      ${chapters}`;
  }

  function initEvidenceWall() {
    const wall = $('.wall');
    const dialog = $('#exhibit-dialog');
    const content = $('.dlg-content', dialog);
    let opener = null;

    if (finePointer && !reduce) {
      // Objects lean toward curiosity
      $$('.artifact').forEach((a) => {
        a.addEventListener('pointermove', (e) => {
          const r = a.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          a.style.setProperty('--ry', `${x * 8}deg`);
          a.style.setProperty('--rx', `${-y * 6}deg`);
        });
        a.addEventListener('pointerleave', () => {
          a.style.setProperty('--ry', '0deg');
          a.style.setProperty('--rx', '0deg');
        });
      });
    }

    // Clay threads between the pins: the investigations are connected
    const threads = $('.wall-threads');
    const drawThreads = () => {
      threads.innerHTML = '';
      if (window.innerWidth < 820) return;
      const wr = wall.getBoundingClientRect();
      const pins = $$('.pin', wall).map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
      });
      const pairs = [[0, 1], [0, 2], [1, 3], [2, 3]];
      pairs.forEach(([a, b]) => {
        const A = pins[a], B = pins[b];
        const dist = Math.hypot(B.x - A.x, B.y - A.y);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M${A.x} ${A.y} Q${(A.x + B.x) / 2} ${Math.max(A.y, B.y) + 30 + dist * 0.12} ${B.x} ${B.y}`);
        threads.appendChild(path);
      });
    };
    drawThreads();
    window.addEventListener('resize', drawThreads);
    if (document.fonts) document.fonts.ready.then(drawThreads);

    // Opening an object opens its story
    $$('.artifact').forEach((a) => {
      a.addEventListener('click', () => {
        const p = PROJECTS[a.dataset.project];
        if (!p) return;
        opener = a;
        visit.files.add(a.dataset.project);
        dialog.dataset.tone = p.tone;
        content.innerHTML = renderStory(p);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        dialog.scrollTop = 0;
        if (motion) {
          gsap.from($$('.story-head > *, .chapter', content), {
            y: 30, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.08, delay: 0.15, clearProps: 'all',
          });
        }
      });
    });
    $('.dlg-close', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (opener) opener.focus({ preventScroll: true });
    });

    initIntelligenceMap();
  }

  // The AI artifact: a map of reasoning that keeps growing while you look at it
  function initIntelligenceMap() {
    const canvas = $('.map-canvas');
    const artifact = canvas.closest('.artifact');
    const ctx = canvas.getContext('2d');
    const rnd = seeded(42);
    const N = 54;
    const nodes = [];
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.42;
      nodes.push({
        x: 0.5 + Math.cos(a) * r * 1.1, y: 0.46 + Math.sin(a) * r * 0.9,
        born: i * 0.16 + rnd() * 0.3, unsure: rnd() < 0.12, phase: rnd() * 6.28, links: [],
      });
    }
    nodes.forEach((n, i) => {
      const prior = nodes.slice(0, i).map((m, j) => [j, Math.hypot(m.x - n.x, m.y - n.y)]).sort((p, q) => p[1] - q[1]);
      n.links = prior.slice(0, 2).map((p) => p[0]);
    });
    let t = reduce ? 999 : 0;
    let speed = 1;
    artifact.addEventListener('pointerenter', () => { speed = 3; });
    artifact.addEventListener('pointerleave', () => { speed = 1; });
    artifact.addEventListener('focus', () => { speed = 3; });
    artifact.addEventListener('blur', () => { speed = 1; });

    const draw = (time) => {
      const { w, h } = fitCanvas(canvas, ctx);
      ctx.clearRect(0, 0, w, h);
      nodes.forEach((n, i) => {
        const life = clamp((t - n.born) / 0.8);
        if (life <= 0) return;
        n.links.forEach((j) => {
          const m = nodes[j];
          const k = clamp((t - n.born) / 1.4);
          ctx.strokeStyle = `rgba(232,232,232,${0.18 * k})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(m.x * w, m.y * h);
          ctx.lineTo(lerp(m.x, n.x, k) * w, lerp(m.y, n.y, k) * h);
          ctx.stroke();
          // signal travelling along the connection
          if (k >= 1 && !reduce) {
            const s = (time * 0.25 + i * 0.137) % 1;
            ctx.fillStyle = 'rgba(216,216,216,.7)';
            ctx.beginPath();
            ctx.arc(lerp(m.x, n.x, s) * w, lerp(m.y, n.y, s) * h, 1.3, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      });
      nodes.forEach((n) => {
        const life = clamp((t - n.born) / 0.8);
        if (life <= 0) return;
        const breathe = reduce ? 1 : 0.85 + 0.15 * Math.sin(time * 1.4 + n.phase);
        if (n.unsure) {
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = `rgba(255,57,57,${0.75 * life})`;
          ctx.beginPath();
          ctx.arc(n.x * w, n.y * h, (9 + 3 * breathe) * life, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = n.unsure ? `rgba(255,57,57,${life})` : `rgba(235,235,235,${0.9 * life})`;
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, (n.unsure ? 3.2 : 2.2) * breathe * life, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    if (reduce) {
      requestAnimationFrame(() => draw(0));
      window.addEventListener('resize', () => draw(0));
      return;
    }
    loopWhileVisible(canvas, (dt, time) => {
      t += dt * speed;
      if (t > N * 0.16 + 14) t = 0; // the map relearns itself
      draw(time);
    });
  }

  /* ------------------------------------------------------------------------
     Room 04 — The Invisible Work: a core sample. Dig down to open each layer.
     ------------------------------------------------------------------------ */
  function initInvisibleWork() {
    const root = $('[data-dig]');
    if (!root) return;
    const names = ['Surface', 'Research insights', 'Design decisions', 'Stakeholder negotiations', 'Failed experiments', 'Iterations'];
    const short = ['Surface', '01 Research', '02 Decisions', '03 Negotiation', '04 Failures', '05 Iterations'];
    const well = $('[data-well]', root);
    const surface = $('.well-surface', root);
    const strata = $$('.stratum', root);
    const bands = $$('.band', root);
    const drill = $('.drill', root);
    const deeper = $('.well-deeper', root);
    const depthLabel = $('.well-depth', root);
    const progress = $('.dig-progress', root);
    const opened = new Set([0]);
    let depth = 0;
    strata.forEach((s) => { $('h3', s).tabIndex = -1; });

    // One layer is shown at a time, in the well. The drill marker shows where you are in the core.
    const show = (d, { focus = false, animate = true } = {}) => {
      depth = Math.max(0, Math.min(5, d));
      opened.add(depth);
      bands.forEach((b, i) => {
        b.setAttribute('aria-current', String(i === depth));
        b.classList.toggle('is-opened', opened.has(i));
        $('.band-state', b).textContent = i === depth ? 'Reading' : opened.has(i) ? 'Opened' : 'Unopened';
      });
      drill.style.transform = `translateY(${depth * 88}px)`;
      surface.hidden = depth !== 0;
      strata.forEach((s, i) => { s.hidden = i + 1 !== depth; });
      deeper.textContent = depth < 5 ? `Go deeper: ${short[depth + 1]}` : 'Back to the surface';
      depthLabel.textContent = `Layer ${String(depth).padStart(2, '0')} of 05 · ${names[depth]}`;
      progress.textContent = `${opened.size} of 6 levels opened`;
      if (animate) {
        well.classList.remove('is-descending');
        void well.offsetWidth;
        well.classList.add('is-descending');
      }
      if (focus) {
        const target = depth === 0 ? surface : $('h3', strata[depth - 1]);
        target.focus({ preventScroll: true });
        const top = well.getBoundingClientRect().top;
        if (top < 0 || top > window.innerHeight * 0.4) {
          well.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        }
      }
    };
    bands.forEach((b, i) => b.addEventListener('click', () => show(i, { focus: true })));
    deeper.addEventListener('click', () => show(depth < 5 ? depth + 1 : 0, { focus: true }));
    show(0, { animate: false });

    // 01 · Research: filter the quotes by theme
    const chips = $$('[data-filter]', root);
    const quotes = $$('.quote', root);
    const shown = $('.filter-count', root);
    chips.forEach((chip) => chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      let n = 0;
      quotes.forEach((q) => {
        const show = f === 'all' || q.dataset.tags.split(' ').includes(f);
        q.hidden = !show;
        if (show) n++;
      });
      shown.textContent = `Showing ${n} of ${quotes.length}`;
    }));

    // 02 · Decisions: look at each one from a different point of view
    $$('.dec', root).forEach((card) => {
      const lenses = $$('[data-lens]', card);
      const out = $('.lens-out', card);
      lenses.forEach((btn) => btn.addEventListener('click', () => {
        lenses.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        out.textContent = out.dataset[btn.dataset.lens];
      }));
    });

    // 03 · Negotiation: the same slot length means something different to each party
    const TARGET = {
      ops: { follow: 15, first: 20 },
      clinicians: { follow: 20, first: 30 },
      patients: { follow: 15, first: 30 },
    };
    const LABEL = { ops: 'Operations', clinicians: 'Clinicians', patients: 'Patients' };
    const value = { follow: 15, first: 15 };
    let kind = 'follow';
    const typeBtns = $$('[data-type]', root);
    const lenRange = $('#nego-range', root);
    const lenOut = $('#nego-val', root);
    const parties = $$('.party', root);
    const summary = $('.nego-summary', root);
    const settle = $('.settle', root);
    const score = (party) => {
      const s = (k) => Math.max(0, 100 - 6 * Math.abs(value[k] - TARGET[party][k]));
      return Math.round((s('follow') + s('first')) / 2);
    };
    const renderNego = () => {
      typeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === kind)));
      lenRange.value = value[kind];
      lenOut.textContent = `${value[kind]} min`;
      lenRange.setAttribute('aria-valuetext', `${value[kind]} minutes for ${kind === 'follow' ? 'follow-ups' : 'first visits'}`);
      const unhappy = [];
      parties.forEach((li) => {
        const key = li.dataset.party;
        const s = score(key);
        $('.meter-fill', li).style.width = `${s}%`;
        $('.party-score', li).textContent = `${s}%`;
        if (s < 75) unhappy.push(LABEL[key]);
      });
      summary.textContent = unhappy.length
        ? `Still pulling against: ${unhappy.join(' and ')}.`
        : 'Everyone can live with this.';
    };
    typeBtns.forEach((b) => b.addEventListener('click', () => { kind = b.dataset.type; renderNego(); }));
    lenRange.addEventListener('input', () => { value[kind] = Number(lenRange.value); renderNego(); });
    settle.addEventListener('click', () => {
      value.follow = 15;
      value.first = 30;
      renderNego();
      summary.textContent = `Settled at 15 minutes for follow-ups and 30 for first visits. ${summary.textContent}`;
    });
    renderNego();

    // 05 · Iterations: scrub through the versions of one button
    const VERSIONS = [
      { v: 'v1', label: 'Submit', c: 62, note: 'Nobody knew what pressing it would do.' },
      { v: 'v4', label: 'Book', c: 68, note: 'A verb, but still not a commitment.' },
      { v: 'v9', label: 'Book 11:40 with Dr. Rao', c: 76, note: 'Says what happens, to whom, and when. Confidence up 14 points.' },
    ];
    const iterRange = $('#iter-range', root);
    const iterBtn = $('[data-iter-btn]', root);
    const iterV = $('[data-iter-v]', root);
    const iterC = $('[data-iter-c]', root);
    const iterNote = $('[data-iter-note]', root);
    const renderIter = (i) => {
      const ver = VERSIONS[i];
      iterBtn.textContent = ver.label;
      iterV.textContent = ver.v;
      iterC.textContent = `${ver.c}%`;
      iterNote.textContent = ver.note;
      iterRange.setAttribute('aria-valuetext', `${ver.v}: ${ver.label}`);
    };
    iterRange.addEventListener('input', () => renderIter(Number(iterRange.value)));
    renderIter(0);
  }

  /* ------------------------------------------------------------------------
     Room 05 — The Decision Lab
     ------------------------------------------------------------------------ */
  const EXPERIMENTS = [
    {
      situation: 'Someone is paying a hospital bill on their phone for the first time. They are anxious about getting it wrong.',
      question: 'Do you design for speed, or for clarity?',
      scale: ['Speed', 'Clarity'],
      idle: '<p class="sp-k">Pay your bill</p><p class="sp-h">Waiting for your decision</p><div class="sp-field"></div><div class="sp-field"></div><div class="sp-btn" style="opacity:.2"></div>',
      options: [
        {
          name: 'One fast page', desc: 'All nine fields on a single screen. Nothing hidden, nothing extra.', side: -1,
          screen: '<p class="sp-k">Pay your bill</p><p class="sp-h">Payment details</p><div class="sp-row"><div class="sp-field"></div><div class="sp-field"></div></div><div class="sp-field is-err"></div><div class="sp-row"><div class="sp-field"></div><div class="sp-field is-err"></div></div><div class="sp-field"></div><div class="sp-row"><div class="sp-field"></div><div class="sp-field"></div></div><div class="sp-field"></div><div class="sp-btn"></div>',
          meters: [['Time to pay', '48 sec', 22, 'good'], ['Errors on submit', '3× higher', 78, 'bad'], ['Calls to billing', '+18%', 62, 'bad']],
          human: '“That was quick. I think I paid it? I’m not sure what I paid for.”',
        },
        {
          name: 'Guided steps', desc: 'Four short screens, one question each, with plain-language help.', side: 1,
          screen: '<div class="sp-steps"><i class="on"></i><i class="on"></i><i></i><i></i></div><p class="sp-k">Step 2 of 4</p><p class="sp-h">What does this bill cover?</p><div class="sp-msg">Your X-ray on 3 March. Insurance has already paid £140 of it.</div><div class="sp-field is-big"></div><div class="sp-btn is-clay"></div>',
          meters: [['Time to pay', '1 min 41 sec', 58, 'bad'], ['Errors on submit', '−61%', 16, 'good'], ['Calls to billing', '−34%', 24, 'good']],
          human: '“Slower, but I always knew where I was.” Returning payers found it tedious by the third visit.',
        },
      ],
      note: 'What shipped: clarity by default, plus a remembered fast path for returning payers. Good design rarely picks a side. It decides who gets which side, and when.',
    },
    {
      situation: 'A shop owner is setting up invoicing at 10pm, after closing. Their accountant will check every invoice later.',
      question: 'Do you keep it simple, or make it flexible?',
      scale: ['Simple', 'Flexible'],
      idle: '<p class="sp-k">New invoice</p><p class="sp-h">Waiting for your decision</p><div class="sp-field"></div><div class="sp-field"></div><div class="sp-btn" style="opacity:.2"></div>',
      options: [
        {
          name: 'Three templates', desc: 'Pick one, add your logo, send. No custom fields.', side: -1,
          screen: '<p class="sp-k">New invoice</p><p class="sp-h">Choose a template</p><div class="sp-field is-big"></div><div class="sp-field is-big" style="border-color:rgba(26,26,26,.2)"></div><div class="sp-field is-big" style="border-color:rgba(26,26,26,.2)"></div><div class="sp-btn is-clay"></div>',
          meters: [['Setup time', '4 min', 18, 'good'], ['First invoice sent', '89%', 89, 'good'], ['Accountants working around it', '28%', 28, 'bad']],
          human: '“Lovely. Until my accountant asked for VAT on a separate line.”',
        },
        {
          name: 'Full builder', desc: 'Every field, layout and rule can be configured from day one.', side: 1,
          screen: '<p class="sp-k">Invoice builder</p><p class="sp-h">Configure layout</p><div><span class="sp-chip">Columns</span><span class="sp-chip">Tax rules</span><span class="sp-chip">Fields</span><span class="sp-chip">Logic</span><span class="sp-chip">Numbering</span></div><div class="sp-grid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="sp-row"><div class="sp-field"></div><div class="sp-field"></div></div><div class="sp-field"></div><div class="sp-btn"></div>',
          meters: [['Setup time', '26 min', 76, 'bad'], ['First invoice sent', '59%', 59, 'bad'], ['Accountants working around it', '3%', 4, 'good']],
          human: '“It can do anything. I just needed it to do one thing tonight.”',
        },
      ],
      note: 'What shipped: a simple surface with flexibility one level down. Progressive disclosure means power is there when it’s needed, never imposed on the first night.',
    },
    {
      situation: 'An AI drafts replies to patient messages for a busy GP practice. Clinicians are overloaded; patients are waiting.',
      question: 'Does the AI send replies itself, or does a human approve each one?',
      scale: ['Automate', 'Control'],
      idle: '<p class="sp-k">Patient messages</p><p class="sp-h">Waiting for your decision</p><div class="sp-msg">Can I take ibuprofen with my new prescription?</div><div class="sp-btn" style="opacity:.2"></div>',
      options: [
        {
          name: 'Auto-send', desc: 'The model replies directly whenever it is confident.', side: -1,
          screen: '<p class="sp-k">Patient messages</p><div class="sp-msg">Can I take ibuprofen with my new prescription?</div><div class="sp-msg is-ai"><span class="sp-badge">Sent automatically · 2 min</span><br>Yes, ibuprofen is generally safe alongside…</div><div class="sp-msg">My pharmacist says that’s not right?</div>',
          meters: [['Reply time', '6 min', 8, 'good'], ['Replies wrong in a way that matters', '1 in 200', 46, 'bad'], ['Trust after a visible error', '−38%', 72, 'bad']],
          human: '“It was fast, until it gave my mum the wrong advice.”',
        },
        {
          name: 'Approve every draft', desc: 'A clinician reviews and sends every single reply.', side: 1,
          screen: '<p class="sp-k">Drafts to review · 47</p><div class="sp-msg">Can I take ibuprofen with my new prescription?</div><div class="sp-msg is-ai"><span class="sp-badge">Draft · waiting for Dr. Rao</span><br>Please check with us first. Your new medication…</div><div class="sp-btn"></div>',
          meters: [['Reply time', '52 min', 40, 'bad'], ['Drafts approved unchanged', '94%', 94, 'bad'], ['Clinician fatigue by week 3', 'High', 80, 'bad']],
          human: '“I approve 94 out of 100 without reading closely. That’s the dangerous part.”',
        },
      ],
      note: 'What shipped: automate the routine, escalate anything clinical, and show clinicians exactly which sentence the model is unsure about. Trust comes from knowing when to ask.',
    },
  ];

  function initDecisionLab() {
    const tabs = $$('.lab-tabs [role="tab"]');
    const panel = $('#lab-panel');
    const situation = $('.lab-situation', panel);
    const question = $('.lab-question', panel);
    const row = $('.choice-row', panel);
    const beam = $('.scale-beam', panel);
    const pans = $$('.scale-pan', panel);
    const labelL = $('.scale-label--l', panel);
    const labelR = $('.scale-label--r', panel);
    const screen = $('.specimen-screen', panel);
    const empty = $('.lab-empty', panel);
    const outcome = $('.lab-outcome', panel);
    const meters = $('.meters', panel);
    const human = $('.lab-human', panel);
    const curator = $('.curator-text', panel);
    const chosen = [null, null, null];
    let exp = 0;

    const springy = reduce ? 'none' : 'transform 1.4s cubic-bezier(.34,1.4,.5,1)';
    beam.style.transition = springy;
    pans.forEach((p) => { p.style.transition = springy; });

    function tilt(side) {
      const a = side * 9;
      beam.style.transform = `rotate(${a}deg)`;
      pans.forEach((p) => { p.style.transform = `rotate(${-a}deg)`; });
    }

    function showScreen(html) {
      if (motion) {
        gsap.to(screen, {
          opacity: 0, duration: 0.2, onComplete: () => {
            screen.innerHTML = html;
            gsap.fromTo(screen.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.04, ease: 'expo.out' });
            gsap.set(screen, { opacity: 1 });
          },
        });
      } else {
        screen.innerHTML = html;
      }
    }

    function showOutcome(o, e) {
      empty.hidden = true;
      outcome.hidden = false;
      meters.innerHTML = o.meters.map(([label, val, w, tone]) => `
        <li>
          <div class="meter-top"><span>${label}</span><b>${val}</b></div>
          <div class="meter-track" aria-hidden="true"><span class="meter-fill is-${tone}" data-w="${w}"></span></div>
        </li>`).join('');
      human.textContent = o.human;
      curator.textContent = e.note;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        $$('.meter-fill', meters).forEach((f) => { f.style.width = `${f.dataset.w}%`; });
      }));
      if (motion) gsap.from([human, curator.parentElement], { opacity: 0, y: 12, duration: 0.9, stagger: 0.12, delay: 0.25, ease: 'expo.out' });
    }

    function choose(i) {
      const e = EXPERIMENTS[exp];
      const o = e.options[i];
      if (chosen[exp] !== i) visit.decisions += 1;
      chosen[exp] = i;
      tilt(o.side);
      showScreen(o.screen);
      showOutcome(o, e);
    }

    function render() {
      const e = EXPERIMENTS[exp];
      situation.textContent = e.situation;
      question.textContent = e.question;
      labelL.textContent = e.scale[0];
      labelR.textContent = e.scale[1];
      row.innerHTML = e.options.map((o, i) => `
        <label class="choice">
          <input type="radio" name="exp-${exp}" value="${i}" ${chosen[exp] === i ? 'checked' : ''}>
          <span class="choice-name">${o.name}</span>
          <span class="choice-desc">${o.desc}</span>
        </label>`).join('');
      $$('input', row).forEach((inp) => inp.addEventListener('change', () => choose(Number(inp.value))));
      if (chosen[exp] === null) {
        tilt(0);
        screen.innerHTML = e.idle;
        empty.hidden = false;
        outcome.hidden = true;
      } else {
        const o = e.options[chosen[exp]];
        tilt(o.side);
        screen.innerHTML = o.screen;
        showOutcome(o, e);
      }
    }

    function selectTab(i, focus) {
      exp = i;
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === i));
        t.tabIndex = j === i ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', tabs[i].id);
      if (focus) tabs[i].focus();
      render();
    }

    tabs.forEach((t, i) => {
      t.addEventListener('click', () => selectTab(i));
      t.addEventListener('keydown', (e) => {
        const map = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
        if (e.key in map) { e.preventDefault(); selectTab(map[e.key], true); }
      });
    });
    render();
  }

  /* ------------------------------------------------------------------------
     Room 06 — The Impact Gallery: installations that give numbers weight
     ------------------------------------------------------------------------ */
  function installation(name, setup) {
    const fig = $(`[data-install="${name}"]`);
    const canvas = $('canvas', fig);
    const ctx = canvas.getContext('2d');
    const count = $('.count', fig);
    const figure = $('.install-figure', fig);
    const range = $('.install-range', fig);
    const now = $('.install-now', fig);
    const sides = $$('.install-compare > div', fig);
    const state = { p: motion ? 0 : 1 };
    const draw = setup(canvas, ctx, state);
    const still = () => draw(0, 0);

    const from = Number(count.dataset.from || 0);
    const to = Number(count.dataset.to);
    // One position, from before launch (0) to after launch (1), drives the drawing, the number and the labels
    const render = () => {
      count.textContent = Math.round(lerp(from, to, state.p)).toLocaleString('en-GB');
      range.value = Math.round(state.p * 100);
      const label = state.p < 0.02 ? 'Before launch' : state.p > 0.98 ? 'After launch' : `Part way, ${Math.round(state.p * 100)}%`;
      range.setAttribute('aria-valuetext', label);
      now.textContent = `Now showing: ${label.toLowerCase()}`;
      sides[0].classList.toggle('is-on', state.p < 0.5);
      sides[1].classList.toggle('is-on', state.p >= 0.5);
    };
    // The moving figure is decorative; the before and after text states the numbers
    figure.setAttribute('aria-hidden', 'true');

    let demo = null;
    range.addEventListener('input', () => {
      if (demo) { demo.kill(); demo = null; }
      state.p = Number(range.value) / 100;
      render();
      if (!motion) still();
    });
    render();

    if (motion) {
      // Play from before to after once, the first time the installation is seen
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        demo = gsap.to(state, { p: 1, duration: 4, ease: 'power2.inOut', onUpdate: render, onComplete: () => { demo = null; } });
      }, { threshold: 0.5 });
      io.observe(fig);
      loopWhileVisible(canvas, (dt, t) => draw(dt, t));
    } else {
      requestAnimationFrame(still);
      window.addEventListener('resize', still);
    }
  }

  function initImpact() {
    // 6.1 — a thousand lights in a sunflower spiral, lit from the centre out
    installation('lights', (canvas, ctx, state) => {
      const N = 1000;
      const golden = Math.PI * (3 - Math.sqrt(5));
      const rnd = seeded(3);
      const twinkle = Array.from({ length: N }, () => rnd() * 6.28);

      return (dt, t) => {
        const { w, h } = fitCanvas(canvas, ctx);
        ctx.clearRect(0, 0, w, h);
        const R = Math.min(w, h) * 0.44;
        const c = R / Math.sqrt(N);
        const lit = state.p * N;
        for (let i = 0; i < N; i++) {
          const r = c * Math.sqrt(i + 0.5);
          const a = i * golden;
          const x = w / 2 + Math.cos(a) * r;
          const y = h / 2 + Math.sin(a) * r;
          if (i < lit) {
            const fresh = clamp((lit - i) / 30);
            const tw = reduce ? 1 : 0.75 + 0.25 * Math.sin(t * 1.8 + twinkle[i]);
            const s = (1.8 + (1 - fresh) * 3) * tw;
            ctx.fillStyle = `rgb(242,242,242)`;
            ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.fillStyle = `rgba(242,242,242,.12)`;
            ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
          }
        }
      };
    });

    // 6.2 — a maze whose dead ends dissolve, leaving one clear path
    installation('maze', (canvas, ctx, state) => {
      const C = 21, Rw = 15;
      const rnd = seeded(11);
      const walls = { h: [], v: [] }; // h[r][c]: wall below cell; v[r][c]: wall right of cell
      for (let r = 0; r < Rw; r++) { walls.h.push(Array(C).fill(true)); walls.v.push(Array(C).fill(true)); }
      const seen = Array.from({ length: Rw }, () => Array(C).fill(false));
      const stack = [[0, 0]]; seen[0][0] = true;
      while (stack.length) {
        const [r, c] = stack[stack.length - 1];
        const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && y < Rw && x >= 0 && x < C && !seen[y][x]);
        if (!nb.length) { stack.pop(); continue; }
        const [y, x] = nb[Math.floor(rnd() * nb.length)];
        if (y > r) walls.h[r][c] = false; else if (y < r) walls.h[y][x] = false;
        else if (x > c) walls.v[r][c] = false; else walls.v[r][x] = false;
        seen[y][x] = true; stack.push([y, x]);
      }
      // solve with breadth-first search
      const prev = Array.from({ length: Rw }, () => Array(C).fill(null));
      const q = [[0, 0]]; const vis = Array.from({ length: Rw }, () => Array(C).fill(false)); vis[0][0] = true;
      while (q.length) {
        const [r, c] = q.shift();
        const opts = [];
        if (r > 0 && !walls.h[r - 1][c]) opts.push([r - 1, c]);
        if (r < Rw - 1 && !walls.h[r][c]) opts.push([r + 1, c]);
        if (c > 0 && !walls.v[r][c - 1]) opts.push([r, c - 1]);
        if (c < C - 1 && !walls.v[r][c]) opts.push([r, c + 1]);
        opts.forEach(([y, x]) => { if (!vis[y][x]) { vis[y][x] = true; prev[y][x] = [r, c]; q.push([y, x]); } });
      }
      const path = []; let cur = [Rw - 1, C - 1];
      while (cur) { path.unshift(cur); cur = prev[cur[0]][cur[1]]; }
      const onPath = new Set(path.map(([r, c]) => `${r},${c}`));
      // every wall segment, flagged if it lines the solution corridor
      const segs = [];
      for (let r = 0; r < Rw; r++) {
        for (let c = 0; c < C; c++) {
          if (walls.h[r][c] && r < Rw - 1) segs.push({ x1: c, y1: r + 1, x2: c + 1, y2: r + 1, keep: onPath.has(`${r},${c}`) || onPath.has(`${r + 1},${c}`), t: rnd() * 0.85 });
          if (walls.v[r][c] && c < C - 1) segs.push({ x1: c + 1, y1: r, x2: c + 1, y2: r + 1, keep: onPath.has(`${r},${c}`) || onPath.has(`${r},${c + 1}`), t: rnd() * 0.85 });
        }
      }
      let travel = 0;

      return (dt, t) => {
        const { w, h } = fitCanvas(canvas, ctx);
        ctx.clearRect(0, 0, w, h);
        const p = state.p;
        const shrink = lerp(1, 0.86, p);
        const cell = Math.min((w * 0.84) / C, (h * 0.8) / Rw) * shrink;
        const ox = (w - cell * C) / 2, oy = (h - cell * Rw) / 2;
        ctx.lineCap = 'round';
        // outer boundary, open at entrance and exit
        ctx.strokeStyle = `rgba(242,242,242,.55)`; ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ox + cell, oy); ctx.lineTo(ox + C * cell, oy); ctx.lineTo(ox + C * cell, oy + (Rw - 1) * cell);
        ctx.moveTo(ox + (C - 1) * cell, oy + Rw * cell); ctx.lineTo(ox, oy + Rw * cell); ctx.lineTo(ox, oy + cell);
        ctx.stroke();
        segs.forEach((s) => {
          const a = s.keep ? 0.55 : clamp((s.t + 0.15 - p) / 0.15) * 0.4;
          if (a <= 0.01) return;
          ctx.strokeStyle = `rgba(242,242,242,${a})`;
          ctx.beginPath();
          ctx.moveTo(ox + s.x1 * cell, oy + s.y1 * cell);
          ctx.lineTo(ox + s.x2 * cell, oy + s.y2 * cell);
          ctx.stroke();
        });
        // the clear route emerges
        const pts = path.map(([r, c]) => [ox + (c + 0.5) * cell, oy + (r + 0.5) * cell]);
        const shown = Math.floor(pts.length * clamp(p * 1.3));
        if (shown > 1) {
          ctx.strokeStyle = 'rgba(255,57,57,.85)'; ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < shown; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.stroke();
        }
        // a traveller who finds the way faster as the maze simplifies
        travel = reduce ? pts.length - 1 : (travel + dt * (3 + p * 14)) % (pts.length - 1);
        const i0 = Math.floor(travel), f = travel - i0;
        const P = pts[i0], Q = pts[Math.min(i0 + 1, pts.length - 1)];
        const tx = lerp(P[0], Q[0], f), ty = lerp(P[1], Q[1], f);
        ctx.fillStyle = `rgb(242,242,242)`; ctx.beginPath(); ctx.arc(tx, ty, cell * 0.3, 0, Math.PI * 2); ctx.fill();
      };
    });

    // 6.3 — tangled routes that straighten into direct, flowing paths
    installation('paths', (canvas, ctx, state) => {
      const LANES = 15;
      const rnd = seeded(23);
      const lanes = Array.from({ length: LANES }, (_, i) => ({ y: (i + 0.5) / LANES, ph: rnd() * 6.28, k: 9 + rnd() * 8 }));
      const parts = Array.from({ length: 170 }, () => ({ lane: Math.floor(rnd() * LANES), s: rnd(), v: 0.6 + rnd() * 0.6 }));
      const at = (L, s, p, w, h) => {
        const tangle = 1 - p;
        const x = s * w + tangle * w * 0.05 * Math.sin(s * L.k + L.ph) * 1.6;
        const y = L.y * h + tangle * h * 0.08 * Math.cos(s * L.k + L.ph) + tangle * h * 0.05 * Math.sin(s * 5 + L.ph * 2);
        return [x, y];
      };
      return (dt, t) => {
        const { w, h } = fitCanvas(canvas, ctx);
        const p = state.p;
        ctx.fillStyle = '#1C1C1C'; ctx.fillRect(0, 0, w, h);
        if (reduce) {
          // a still image of the straightened routes
          ctx.strokeStyle = `rgba(242,242,242,.35)`; ctx.lineWidth = 1;
          lanes.forEach((L) => {
            ctx.beginPath();
            for (let s = 0; s <= 1.0001; s += 0.01) { const [x, y] = at(L, s, p, w, h); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
            ctx.stroke();
          });
        }
        ctx.globalCompositeOperation = 'lighter';
        parts.forEach((q) => {
          const L = lanes[q.lane];
          // move at constant speed along the curve: tangled routes take longer
          const [x0, y0] = at(L, q.s, p, w, h);
          const [x1, y1] = at(L, q.s + 0.002, p, w, h);
          const seg = Math.hypot(x1 - x0, y1 - y0) / 0.002 || w;
          if (!reduce) q.s += (q.v * 120 * dt) / seg;
          if (q.s > 1) q.s -= 1;
          const [x, y] = at(L, q.s, p, w, h);
          ctx.fillStyle = `rgba(242,242,242,.85)`;
          ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
      };
    });
  }

  /* ------------------------------------------------------------------------
     Room 07 — The Reflection Room: a quiet record of the visit
     ------------------------------------------------------------------------ */
  function updateVisitSummary() {
    const el = $('.visit-summary');
    const secs = Math.round((Date.now() - visit.start) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const time = m ? `${plural(m, 'minute', 'minutes')} and ${plural(s, 'second', 'seconds')}` : plural(s, 'second', 'seconds');
    const d = visit.decisions;
    const f = visit.files.size;
    el.textContent = `You spent ${time} in the museum, made ${plural(d, 'decision', 'decisions')} in the lab, and opened ${plural(f, 'case file', 'case files')}. Thank you for walking through.`;
  }

  /* ------------------------------------------------------------------------
     Opening hours
     ------------------------------------------------------------------------ */
  /* ------------------------------------------------------------------------
     Parallax fallback — only where CSS scroll-driven animations are missing
     ------------------------------------------------------------------------ */
  function initParallaxFallback() {
    if (reduce || CSS.supports('animation-timeline: view()')) return;
    const layers = $$('.px');
    const amp = (el) => (el.classList.contains('ui') ? 6 : el.offsetHeight * 0.04);
    layers.forEach((el) => el.classList.add('px-js'));
    let queued = false;
    const update = () => {
      queued = false;
      const vh = window.innerHeight;
      layers.forEach((el) => {
        const r = el.parentElement.getBoundingClientRect();
        const p = clamp((vh - r.top) / (vh + r.height));
        const a = amp(el);
        el.style.transform = `translate3d(0, ${lerp(-a, a, p).toFixed(2)}px, 0)`;
      });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    update();
  }

  /* ------------------------------------------------------------------------
     Room 02 — The Human Room: a carousel where each moment is its own experiment
     ------------------------------------------------------------------------ */
  function initHumanRoom() {
    const root = $('[data-hr]');
    if (!root) return;
    const track = $('.hr-track', root);
    const slides = $$('.hr-slide', track);
    const dots = $$('.hr-dot', root);
    const count = $('.hr-count', root);
    const prev = $('.hr-prev', root);
    const next = $('.hr-next', root);
    const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    // Each case study is a small machine: it wakes when its slide arrives and sleeps when it leaves

    // 01 · The patient: the hold timer runs until a slot is chosen
    function patient(slide) {
      const timer = $('[data-timer]', slide);
      const chips = $$('.hr-chip', slide);
      const result = $('.hr-result', slide);
      let secs = 23, booked = false, tick = 0;
      const stop = () => { clearInterval(tick); tick = 0; };
      chips.forEach((chip) => chip.addEventListener('click', () => {
        if (booked) return;
        booked = true;
        stop();
        chip.setAttribute('aria-pressed', 'true');
        chips.forEach((c) => { c.disabled = c !== chip; });
        result.innerHTML = `<p class="hr-result-h">Booked: ${chip.dataset.slot} with Dr. Rao</p><p class="hr-note">You were on hold for ${fmtTime(secs)}. Nothing else was asked of you.</p>`;
      }));
      return {
        live() {
          timer.textContent = fmtTime(secs);
          if (!booked && !tick) tick = setInterval(() => { secs++; timer.textContent = fmtTime(secs); }, 1000);
        },
        idle: stop,
      };
    }

    // 02 · The parent: each tap records a dose, and the household sees the same list
    function parent(slide) {
      const doses = $$('.hr-dose', slide);
      const result = $('.hr-result', slide);
      const times = ['08:00', '14:00', '20:00'];
      const names = ['Not yet', 'Sam gave it', 'Priya gave it'];
      const state = [0, 0, 0];
      const render = () => {
        doses.forEach((b, i) => {
          b.dataset.state = String(state[i]);
          b.querySelector('.hr-dose-who').textContent = names[state[i]];
          b.setAttribute('aria-label', `${times[i]} dose: ${names[state[i]]}. Activate to change.`);
        });
        const due = times.filter((_, i) => !state[i]);
        result.innerHTML = due.length
          ? `<p class="hr-result-h">Next dose due ${due[0]}.</p><p class="hr-note">${3 - due.length} of 3 given today. Both parents see this same list.</p>`
          : '<p class="hr-result-h">All three doses are recorded.</p><p class="hr-note">Nobody has to check the fridge at 2am.</p>';
      };
      doses.forEach((b, i) => b.addEventListener('click', () => { state[i] = (state[i] + 1) % 3; render(); }));
      render();
      return { live() {}, idle() {} };
    }

    // 03 · The commuter: the full board, or only the one step that matters, with a countdown
    function commuter(slide) {
      const modes = $$('.hr-mode', slide);
      const rows = $$('.hr-row', slide);
      const step = $('.hr-next-step', slide);
      const clock = $('[data-count]', slide);
      let secs = 90, tick = 0, mode = 'all';
      const apply = () => {
        modes.forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.mode === mode)));
        rows.forEach((r, i) => { r.hidden = mode === 'next' && i > 0; });
        step.hidden = mode !== 'next';
      };
      modes.forEach((m) => m.addEventListener('click', () => { mode = m.dataset.mode; apply(); }));
      apply();
      return {
        live() {
          clock.textContent = `${secs} sec`;
          if (!tick) tick = setInterval(() => { secs = secs > 0 ? secs - 1 : 90; clock.textContent = `${secs} sec`; }, 1000);
        },
        idle() { clearInterval(tick); tick = 0; },
      };
    }

    // 04 · Under stress: each attempt adds an error, until the message finally says what is safe
    function stress(slide) {
      const btn = $('.hr-try', slide);
      const stack = $('.hr-stack', slide);
      const errors = ['Something went wrong.', 'Something went wrong. Try again.'];
      let tries = 0;
      const render = () => {
        if (tries === 0) {
          stack.innerHTML = '<p class="hr-note">Your photos are ready. Nothing has been sent yet.</p>';
          btn.textContent = 'Upload claim photos';
        } else if (tries <= errors.length) {
          stack.innerHTML = errors.slice(0, tries).map((m, i) => `<div class="hr-err" style="--k:${i}">${m}</div>`).join('');
          btn.textContent = 'Try upload again';
        } else {
          stack.innerHTML = '<div class="hr-calm"><p class="hr-result-h">We saved everything you entered.</p><p class="hr-note">The connection dropped during upload. Nothing is lost.</p><p class="hr-note">Or call Anna on 0800 123 456. She can see your claim.</p></div>';
          btn.textContent = 'Try upload again';
        }
      };
      btn.addEventListener('click', () => { tries++; render(); });
      render();
      return { live() {}, idle() {} };
    }

    const cases = [patient, parent, commuter, stress];
    const hooks = slides.map((slide, i) => cases[i](slide));
    slides.forEach((slide) => $$('.hr-unfold > *', slide).forEach((el, i) => el.style.setProperty('--i', i)));

    let index = -1;
    const go = (i, { scroll = true } = {}) => {
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i !== index) {
        index = i;
        slides.forEach((s, j) => {
          s.classList.toggle('is-live', j === index);
          if (j === index) hooks[j].live(); else hooks[j].idle();
        });
        dots.forEach((d, j) => d.setAttribute('aria-current', String(j === index)));
        count.textContent = `${index + 1} / ${slides.length}`;
        prev.disabled = index === 0;
        next.disabled = index === slides.length - 1;
      }
      if (scroll) track.scrollTo({ left: index * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    };

    // Swiping, trackpads and scrollbars all report here, so the controls always follow the slide on screen
    let raf = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== index) go(i, { scroll: false });
      });
    }, { passive: true });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    });
    dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
    prev.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));
    window.addEventListener('resize', () => { track.scrollLeft = index * track.clientWidth; });

    go(0, { scroll: false });
  }

  initEntrance();
  initArrival();
  initHumanRoom();
  initParallaxFallback();
  initEvidenceWall();
  initInvisibleWork();
  initDecisionLab();
  initImpact();
  updateVisitSummary();

})();
