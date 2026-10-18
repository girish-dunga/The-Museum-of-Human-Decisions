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
    // The header says which room you are in
    const here = $('.bar-here');
    if (here) {
      $('.bar-here-no', here).textContent = room.dataset.roomNum;
      $('.bar-here-of', here).textContent = `/ ${String(rooms.length).padStart(2, '0')}`;
      $('.bar-here-name', here).textContent = room.dataset.roomName;
      here.classList.remove('is-changing');
      void here.offsetWidth;   // restart the roll-in
      here.classList.add('is-changing');
    }
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
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--read', scrollable > 0 ? clamp(window.scrollY / scrollable).toFixed(4) : 0);
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

  // The header: it tucks itself away once you start reading, and the rooms menu
  // gives phones and tablets the same route the floor plan gives wide screens
  function initChrome() {
    const compact = () => bar.classList.toggle('is-compact', window.scrollY > 40);
    window.addEventListener('scroll', compact, { passive: true });
    compact();

    const toggle = $('.rooms-toggle');
    const list = $('#rooms-list');
    if (!toggle || !list) return;
    const set = (open, { focus = false } = {}) => {
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        const here = rooms.indexOf(currentRoom);
        $$('a', list).forEach((a, j) => { if (j === here) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
        if (focus) $('a', list).focus();
      }
    };
    toggle.addEventListener('click', () => set(list.hidden, { focus: false }));
    toggle.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); set(true, { focus: true }); } });
    $$('a', list).forEach((a) => a.addEventListener('click', () => set(false)));
    document.addEventListener('click', (e) => { if (!list.hidden && !e.target.closest('.rooms-menu')) set(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !list.hidden) { set(false); toggle.focus(); }
    });
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

    gsap.set('.statement-inner', { yPercent: 110 });
    gsap.set('.statement', { visibility: 'visible' });
    gsap.timeline({ delay: 0.15 })
      .to('.statement-inner', { yPercent: 0, duration: 1.4, ease: 'expo.out', stagger: 0.12 })
      .to('#entrance [data-reveal]', { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08 }, 0.35)
      .from('.admission', { opacity: 0, duration: 1.2 }, 0.9);
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
  const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  // A wall project's chapters, as HTML for the reader
  function projectChapters(p) {
    return p.chapters.map((c) => {
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
      return { label: c.label, html: body };
    });
  }

  // Every case study, from the wall or from a moment, reads the same way:
  // header, a jump list of chapters, the chapters, then the way on to the next one
  function renderStory(c, next) {
    const meta = c.meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const tpl = document.getElementById(`shots-${c.id}`);
    // A process artefact (journey map, user flow, IA or usability test) joins as its own chapter, after the research
    const art = document.getElementById(`artifact-${c.id}`);
    let chs = c.chapters;
    if (art) {
      const after = chs.findIndex((ch) => /research/i.test(ch.label));
      const at = after < 0 ? 1 : after + 1;
      chs = [...chs.slice(0, at), { label: art.dataset.label, html: art.innerHTML, wide: true }, ...chs.slice(at)];
    }
    const jump = chs.map((ch, i) =>
      `<li><a href="#dlg-ch-${i}" data-jump="${i}"><b aria-hidden="true">${NUMERALS[i]}</b>${ch.label}</a></li>`).join('')
      + (tpl ? `<li><a href="#dlg-ch-shots" data-jump="shots"><b aria-hidden="true">${NUMERALS[chs.length]}</b>Screens</a></li>` : '');
    const chapters = chs.map((ch, i) =>
      `<section class="chapter${ch.wide ? ' chapter--wide' : ''}" id="dlg-ch-${i}"><p class="chapter-label"><b aria-hidden="true">${NUMERALS[i]}</b>${ch.label}</p><div class="chapter-body">${ch.html}</div></section>`).join('');
    // Key screens from the project, when the page has them: a taste of the visual design, not the full flow
    const shots = tpl ? `
      <section class="shots" id="dlg-ch-shots" aria-labelledby="dlg-shots">
        <div class="shots-head">
          <p class="chapter-label" id="dlg-shots">Selected screens</p>
          <p class="shots-note">Where the process landed: a few key screens from the visual design, not the full flow. Scroll sideways for more.</p>
        </div>
        <div class="shots-row" tabindex="0" role="region" aria-label="Screens from ${c.title}">${tpl.innerHTML}</div>
      </section>` : '';
    const tryIt = c.slide ? `<button class="story-try" type="button" data-try>Try the interactive exhibit <span aria-hidden="true">&rarr;</span></button>` : '';
    const onward = next
      ? `<a class="story-next" href="#case-${next.id}" data-case-id="${next.id}"><span class="story-next-k">Next case study</span><span class="story-next-t">${next.title}</span><span class="story-next-s">${next.kind}</span></a>`
      : `<a class="story-next" href="#case-studies" data-case-index><span class="story-next-k">You have reached the end</span><span class="story-next-t">Back to all case studies</span></a>`;
    return `
      <header class="story-head">
        <p class="story-kicker">${c.kicker}</p>
        <h2 class="story-title" id="dlg-title" tabindex="-1">${c.title}</h2>
        <p class="story-lede">${c.lede}</p>
        <dl class="story-meta">${meta}</dl>
        ${tryIt}
      </header>
      <nav class="story-jump" aria-label="Chapters in this case study"><p class="story-jump-k">In this case study</p><ol role="list">${jump}</ol></nav>
      ${chapters}
      ${shots}
      <footer class="story-foot">${onward}</footer>`;
  }

  function renderIndex(cases) {
    const groups = [
      ['featured', 'Featured investigations', 'The four longest write-ups, from the Evidence Wall.'],
      ['human', 'Human moments', 'Shorter case studies, each paired with an interactive exhibit in the Human Room.'],
      ['ai', 'AI moments', 'Designing AI that people can question, correct and trust.'],
    ];
    const card = (c) => `
      <li><a class="cs-card" href="#case-${c.id}" data-case-id="${c.id}">
        <span class="cs-kind">${c.kind}</span>
        <span class="cs-title">${c.title}</span>
        ${c.subtitle ? `<span class="cs-sub">${c.subtitle}</span>` : ''}
        <span class="cs-sum">${c.summary}</span>
        <span class="cs-cue">Read the case study</span>
      </a></li>`;
    return `
      <header class="story-head story-head--index">
        <p class="story-kicker">The collection</p>
        <h2 class="story-title" id="dlg-title" tabindex="-1">Case studies</h2>
        <p class="story-lede">${cases.length} projects, each written up the same way: the problem, what research showed, the decisions, the results and what I’d do differently.</p>
      </header>
      ${groups.map(([g, name, note]) => {
        const list = cases.filter((c) => c.group === g);
        if (!list.length) return '';
        return `<section class="cs-group" aria-labelledby="cs-${g}">
          <div class="cs-group-head"><h3 id="cs-${g}">${name} <span>${list.length}</span></h3><p>${note}</p></div>
          <ul class="cs-grid" role="list">${list.map(card).join('')}</ul>
        </section>`;
      }).join('')}`;
  }

  /* ------------------------------------------------------------------------
     Exhibit presentation — a short, self-running walkthrough of one moment,
     shown over the case study instead of leaving it
     ------------------------------------------------------------------------ */
  function initPresenter(goLive) {
    const dlg = $('#present');
    if (!dlg) return { open() {} };
    const stage = $('.pr-stage', dlg);
    const title = $('.pr-k', dlg);
    const countEl = $('.pr-count', dlg);
    const steps = $('.pr-steps', dlg);
    const prev = $('.pr-prev', dlg);
    const next = $('.pr-next', dlg);
    const play = $('.pr-play', dlg);
    let slides = [];
    let at = 0;
    let caseNow = null;
    let returnTo = null;

    const frag = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

    // Build the slides from what the case study already says
    function build(c) {
      const out = [];
      const slide = c.slide;
      const pick = (re) => c.chapters.find((ch) => re.test(ch.label));
      const time = $('.moment-time', slide);
      const story = $('.moment-story', slide);
      out.push({ name: 'The moment', html: `
        <p class="ps-k">${$('.exhibit-no', slide).textContent}</p>
        <h3 class="ps-title">${c.subtitle}</h3>
        ${time ? `<p class="ps-time">${time.textContent}</p>` : ''}
        ${story ? `<div class="ps-story">${story.innerHTML}</div>` : ''}` });
      const prob = pick(/problem/i);
      if (prob) {
        const d = frag(prob.html);
        const h = $('h4', d), p = $('p', d);
        out.push({ name: 'The problem', html: `<p class="ps-k">The problem</p>${h ? `<p class="ps-big">${h.textContent}</p>` : ''}${p ? `<p class="ps-p">${p.textContent}</p>` : ''}` });
      }
      const res = pick(/research/i);
      const q = res && $('blockquote', frag(res.html));
      if (q) {
        const cite = $('cite', q);
        const who = cite ? cite.textContent : '';
        if (cite) cite.remove();
        out.push({ name: 'What people said', html: `<p class="ps-k">What the research said</p><blockquote class="ps-quote">${q.textContent.trim()}</blockquote><p class="ps-cite">${who}</p>` });
      }
      out.push({ name: 'The decision', html: `<p class="ps-k">The decision</p><p class="ps-decision">${c.lede}</p>` });
      const tpl = document.getElementById(`shots-${c.id}`);
      if (tpl) {
        const figs = $$('figure', tpl.content).slice(0, 2);
        out.push({ name: 'Key screens', html: `<p class="ps-k">Key screens</p><div class="ps-shots">${figs.map((f) =>
          `<div class="ps-shot">${$('.device', f).outerHTML}<p>${$('figcaption', f).innerHTML}</p></div>`).join('')}</div>` });
      }
      const changed = pick(/changed/i);
      if (changed) {
        const items = $$('li', frag(changed.html));
        if (items.length) out.push({ name: 'What changed', html: `<p class="ps-k">What changed</p><ul class="ps-outcomes" role="list">${items.map((li) => li.outerHTML).join('')}</ul>` });
      }
      out.push({ name: 'Your turn', html: `
        <p class="ps-k">Your turn</p>
        <p class="ps-big">Want to make the decision yourself?</p>
        <p class="ps-p">The live exhibit in the Human Room lets you try the same moment and see what changes.</p>
        <div class="ps-actions">
          <button class="ps-live" type="button" data-live>Open the live exhibit <span aria-hidden="true">&rarr;</span></button>
          <button class="ps-back" type="button" data-back>Back to the case study</button>
        </div>` });
      return out;
    }

    function setPlaying(on) {
      dlg.classList.toggle('is-paused', !on);
      play.setAttribute('aria-label', on ? 'Pause the presentation' : 'Play the presentation');
      play.innerHTML = on
        ? '<span aria-hidden="true">&#10074;&#10074;</span><span class="pr-long">Pause</span>'
        : '<span aria-hidden="true">&#9654;</span><span class="pr-long">Play</span>';
    }

    function render(dir) {
      const s = slides[at];
      stage.innerHTML = `<section class="ps ps--${dir || 'in'}" aria-roledescription="slide" aria-label="${at + 1} of ${slides.length}: ${s.name}">${s.html}</section>`;
      countEl.textContent = `${at + 1} / ${slides.length} · ${s.name}`;
      $$('.pr-step', steps).forEach((b, i) => {
        b.classList.toggle('is-done', i < at);
        b.classList.toggle('is-now', i === at);
        if (i === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      });
      prev.disabled = at === 0;
      next.disabled = at === slides.length - 1;
      // the last slide waits for the visitor
      if (at === slides.length - 1) setPlaying(false);
    }
    const go = (i) => {
      if (i < 0 || i >= slides.length || i === at) return;
      const dir = i > at ? 'next' : 'prev';
      at = i;
      render(dir);
    };

    // Each step's bar fills while its slide is shown; when it is full, the next slide follows
    steps.addEventListener('animationend', (e) => {
      if (e.target.closest('.pr-step.is-now')) go(at + 1);
    });
    steps.addEventListener('click', (e) => {
      const b = e.target.closest('.pr-step');
      if (b) go(Number(b.dataset.i));
    });
    prev.addEventListener('click', () => go(at - 1));
    next.addEventListener('click', () => go(at + 1));
    play.addEventListener('click', () => {
      const paused = dlg.classList.contains('is-paused');
      if (paused && at === slides.length - 1) { at = 0; render(); }
      setPlaying(paused);
    });
    $('.pr-close', dlg).addEventListener('click', () => dlg.close());
    stage.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) dlg.close();
      if (e.target.closest('[data-live]')) {
        const slide = caseNow.slide;
        returnTo = null;
        dlg.close();
        goLive(slide);
      }
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); play.click(); }
    });
    // Clicking the dimmed backdrop closes it
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => {
      stage.innerHTML = '';
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
      returnTo = null;
    });

    return {
      open(c, from) {
        caseNow = c;
        returnTo = from;
        slides = build(c);
        at = 0;
        title.textContent = `${$('.exhibit-no', c.slide).textContent} · ${c.subtitle}`;
        steps.innerHTML = slides.map((s, i) =>
          `<button class="pr-step" type="button" data-i="${i}" aria-label="Slide ${i + 1}: ${s.name}"><i></i></button>`).join('');
        setPlaying(!reduce);
        render();
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
        play.focus();
      },
    };
  }

  /* ------------------------------------------------------------------------
     Case study reader — one dialog for every case study. It has an index,
     previous and next, a link of its own for each case (#case-…), and the
     browser's Back button closes it.
     ------------------------------------------------------------------------ */
  const caseReader = { open() {}, openIndex() {} };

  function initCaseReader(humanRoom) {
    const dialog = $('#exhibit-dialog');
    if (!dialog) return;
    const content = $('.dlg-content', dialog);
    const indexBtn = $('.dlg-index', dialog);
    const prevBtn = $('.dlg-prev', dialog);
    const nextBtn = $('.dlg-next', dialog);
    const pos = $('.dlg-pos', dialog);

    // The collection: the wall's four investigations, then every moment in the Human Room
    const cases = Object.entries(PROJECTS).map(([id, p]) => {
      const caption = $(`.artifact[data-project="${id}"] .caption-kind`);
      return {
        id, group: 'featured', tone: p.tone, title: p.title,
        kind: caption ? caption.textContent : p.kicker,
        summary: p.lede, kicker: p.kicker, lede: p.lede, meta: p.meta, chapters: projectChapters(p),
      };
    });
    (humanRoom ? humanRoom.studies : []).forEach(({ slide, body, sub }) => {
      const [project, ...rest] = sub.split(' · ');
      const exhibit = $('.exhibit-no', slide).textContent;
      const chapters = $$('.hr-chap', body).map((chap) => {
        const label = $('.hr-chap-label', chap).textContent.replace(/^\d+\s*·\s*/, '');
        const html = Array.from(chap.children).filter((el) => !el.matches('.hr-chap-label')).map((el) => {
          const node = el.cloneNode(true);
          if (node.matches('.hr-figs')) node.className = 'outcomes';
          return node.outerHTML;
        }).join('');
        return { label, html };
      });
      const problem = $('.hr-chap h4', body);
      cases.push({
        id: slide.dataset.case.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
        group: slide.dataset.kind === 'ai' ? 'ai' : 'human', tone: 'moment', slide,
        title: project, subtitle: $('.moment-title', slide).textContent,
        kind: rest.join(' · '),
        summary: problem ? problem.textContent : '',
        kicker: `${exhibit} · ${$('.moment-title', slide).textContent}`,
        lede: $('.moment-decision p:not(.decision-label)', slide).innerHTML,
        meta: $$('.hr-case-meta > div', body).map((d) => [$('dt', d).textContent, $('dd', d).textContent]),
        chapters,
      });
    });
    // Reading order follows the index: featured, then human, then AI
    const order = ['featured', 'human', 'ai'];
    cases.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    const byId = new Map(cases.map((c) => [c.id, c]));

    let current = null;     // the case on screen, or null for the index
    let pushed = false;     // did opening the reader add a history entry that closing should undo?
    let opener = null;

    const setHash = (hash, push) => {
      const url = hash ? `#${hash}` : location.pathname + location.search;
      if (push) history.pushState({ reader: true }, '', url);
      else history.replaceState(history.state, '', url);
    };

    const show = (c) => {
      current = c;
      dialog.dataset.tone = c ? c.tone : 'index';
      if (c) {
        const i = cases.indexOf(c);
        content.innerHTML = renderStory(c, cases[i + 1]);
        pos.innerHTML = `<span class="dlg-long">Case study </span>${i + 1} of ${cases.length}`;
        prevBtn.disabled = i === 0;
        nextBtn.disabled = i === cases.length - 1;
        prevBtn.setAttribute('aria-label', i > 0 ? `Previous case study: ${cases[i - 1].title}` : 'Previous case study');
        nextBtn.setAttribute('aria-label', cases[i + 1] ? `Next case study: ${cases[i + 1].title}` : 'Next case study');
        visit.files.add(c.id);
      } else {
        content.innerHTML = renderIndex(cases);
        pos.textContent = `${cases.length} case studies`;
      }
      indexBtn.hidden = !c;
      prevBtn.hidden = nextBtn.hidden = !c;
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      dialog.scrollTop = 0;
      measure();
      marked = undefined;
      onScroll();
      $('#dlg-title', content).focus({ preventScroll: true });
      if (motion) {
        gsap.from($$('.story-head > *, .story-jump, .cs-group', content), {
          y: 24, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.05, clearProps: 'all',
        });
      }
    };

    // From the page, opening adds one history entry; moving between cases inside the reader replaces it
    const open = (id, { from } = {}) => {
      const c = id ? byId.get(id) : null;
      if (id && !c) return;
      const wasOpen = dialog.open;
      if (!wasOpen) { opener = from || document.activeElement; pushed = true; }
      setHash(c ? `case-${c.id}` : 'case-studies', !wasOpen);
      show(c);
    };
    caseReader.open = (id, opts) => open(id, opts);
    caseReader.openIndex = (opts) => open(null, opts);

    const close = () => { if (dialog.open) dialog.close(); };
    dialog.addEventListener('close', () => {
      current = null;
      if (pushed) { pushed = false; history.back(); }
      else if (/^#case-/.test(location.hash)) setHash('', false);
      // After the browser's own dialog focus handling and any Back navigation have settled
      const back = opener;
      opener = null;
      if (back && document.contains(back)) setTimeout(() => back.focus({ preventScroll: true }), 0);
    });

    // Back and Forward walk in and out of the reader
    const route = () => {
      const h = location.hash;
      if (h === '#case-studies' || h.startsWith('#case-')) {
        const c = h === '#case-studies' ? null : byId.get(h.slice(6));
        if (h !== '#case-studies' && !c) return;
        if (!dialog.open) pushed = history.state && history.state.reader;
        if (c !== current || !dialog.open) show(c);
      } else if (dialog.open) {
        pushed = false;
        close();
      }
    };
    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', route);

    $('.dlg-close', dialog).addEventListener('click', close);
    indexBtn.addEventListener('click', () => open(null));
    const step = (d) => {
      if (!current) return;
      const c = cases[cases.indexOf(current) + d];
      if (c) open(c.id);
    };
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    dialog.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.target.matches('input, textarea, select, .shots-row')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });

    // Links inside the reader: cards, chapter jumps, next case, and the way back to the live exhibit
    content.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;   // new tabs keep working
      const link = e.target.closest('[data-case-id], [data-case-index], [data-jump], [data-try]');
      if (!link) return;
      e.preventDefault();
      if (link.dataset.caseId) open(link.dataset.caseId);
      else if ('caseIndex' in link.dataset) open(null);
      else if (link.dataset.jump) {
        const target = $(`#dlg-ch-${link.dataset.jump}`, content);
        const top = target.getBoundingClientRect().top - dialog.getBoundingClientRect().top + dialog.scrollTop;
        dialog.scrollTo({ top: top - pinnedHeight() - 12, behavior: reduce ? 'auto' : 'smooth' });
        markChapter(link.dataset.jump);
      } else if ('try' in link.dataset && current && current.slide) {
        presenter.open(current, link);
      }
    });

    // The live exhibit in the Human Room, reached from the end of a presentation
    const goLive = (slide) => {
      pushed = false; opener = null;
      setHash('human-room', false);
      close();
      humanRoom.show(slide);
    };
    const presenter = initPresenter(goLive);

    // The chapter list stays pinned under the top bar; offsets account for both
    const bar = $('.dlg-bar', dialog);
    const pinnedHeight = () => {
      const nav = $('.story-jump', content);
      return bar.offsetHeight + (nav ? nav.offsetHeight : 0);
    };
    const measure = () => dialog.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
    window.addEventListener('resize', measure);
    let marked = null;
    function markChapter(id) {
      if (id === marked) return;
      marked = id;
      $$('.story-jump a', content).forEach((a) => {
        const on = a.dataset.jump === id;
        if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        if (on) {
          const list = a.closest('ol');
          list.scrollTo({ left: a.offsetLeft - list.offsetLeft - 16, behavior: reduce ? 'auto' : 'smooth' });
        }
      });
    }

    // Reading progress along the top bar, and which chapter is being read
    function onScroll() {
      const max = dialog.scrollHeight - dialog.clientHeight;
      dialog.style.setProperty('--read', max > 0 ? (dialog.scrollTop / max).toFixed(4) : 0);
      const sections = $$('.chapter, .shots', content);
      if (!sections.length) return;
      const line = dialog.getBoundingClientRect().top + pinnedHeight() + 48;
      let id = null;
      sections.forEach((sec) => { if (sec.getBoundingClientRect().top <= line) id = sec.id.replace('dlg-ch-', ''); });
      if (max > 0 && dialog.scrollTop >= max - 2) id = sections[sections.length - 1].id.replace('dlg-ch-', '');
      markChapter(id);
    }
    dialog.addEventListener('scroll', onScroll, { passive: true });

    // Every "case studies" link on the page opens the index
    $$('[data-open-index]').forEach((a) => a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      open(null, { from: a });
    }));

    // Arriving on a link to a case study opens it straight away
    if (location.hash === '#case-studies' || location.hash.startsWith('#case-')) {
      pushed = false;
      route();
    }
  }

  function initEvidenceWall() {
    const wall = $('.wall');

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

    // Red threads between the pins, each named for the insight the two investigations share
    const threads = $('.wall-threads');
    const notes = $('.wall-notes');
    const items = $$('.wall-item', wall);
    const LINKS = [
      { a: 0, b: 1, label: 'Show what’s real first' },
      { a: 0, b: 2, label: 'Accessible by default' },
      { a: 1, b: 3, label: 'Explain the why' },
      { a: 2, b: 3, label: 'Trust is built in' },
    ];
    const drawThreads = () => {
      threads.innerHTML = '';
      notes.innerHTML = '';
      if (window.innerWidth < 820) return;
      const wr = wall.getBoundingClientRect();
      const pins = $$('.pin', wall).map((p) => {
        const r = p.getBoundingClientRect();
        return { x: r.left - wr.left + r.width / 2, y: r.top - wr.top + r.height / 2 };
      });
      LINKS.forEach((l, i) => {
        const A = pins[l.a], B = pins[l.b];
        const dist = Math.hypot(B.x - A.x, B.y - A.y);
        const cx = (A.x + B.x) / 2, cy = Math.max(A.y, B.y) + 30 + dist * 0.12;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M${A.x} ${A.y} Q${cx} ${cy} ${B.x} ${B.y}`);
        path.setAttribute('pathLength', '1');
        path.dataset.link = i;
        path.style.setProperty('--d', `${i * 0.25}s`);
        threads.appendChild(path);
        // the note sits on the thread's lowest point
        const note = document.createElement('span');
        note.className = 'wall-note';
        note.dataset.link = i;
        note.textContent = l.label;
        note.style.left = `${(A.x + 2 * cx + B.x) / 4}px`;
        note.style.top = `${(A.y + 2 * cy + B.y) / 4}px`;
        note.style.setProperty('--d', `${0.6 + i * 0.25}s`);
        notes.appendChild(note);
      });
      paint();
    };

    // Which objects and threads are lit: by the lens, and by whatever is being looked at
    let lens = 'all';
    let focus = null;
    const lensNote = $('.wall-lens-note');
    const paint = () => {
      const lit = new Set();
      items.forEach((it, i) => { if (lens === 'all' || it.dataset.tags.split(' ').includes(lens)) lit.add(i); });
      const linked = new Set(focus === null ? [] : [focus]);
      if (focus !== null) LINKS.forEach((l) => { if (l.a === focus) linked.add(l.b); if (l.b === focus) linked.add(l.a); });
      items.forEach((it, i) => {
        const dim = !lit.has(i) || (focus !== null && !linked.has(i));
        it.classList.toggle('is-dim', dim);
        it.classList.toggle('is-linked', focus !== null && linked.has(i) && i !== focus);
      });
      $$('[data-link]', wall).forEach((el) => {
        const l = LINKS[el.dataset.link];
        const on = focus !== null ? (l.a === focus || l.b === focus) : lens !== 'all' && lit.has(l.a) && lit.has(l.b);
        const off = focus !== null ? !on : lens !== 'all' && !on;
        el.classList.toggle('is-on', on);
        el.classList.toggle('is-off', off);
      });
    };
    items.forEach((it, i) => {
      const art = $('.artifact', it);
      const enter = () => { focus = i; paint(); };
      const leave = () => { focus = null; paint(); };
      art.addEventListener('pointerenter', enter);
      art.addEventListener('pointerleave', leave);
      art.addEventListener('focus', enter);
      art.addEventListener('blur', leave);
    });
    const lensNames = { all: 'Hover an object to see what it connects to.', access: 'Access: designing for the people most often left out.', clarity: 'Clarity: plain answers before anything else is asked.', trust: 'Trust: showing the why, so people can check it.' };
    $$('.wall-lens').forEach((btn) => btn.addEventListener('click', () => {
      lens = btn.dataset.lens;
      $$('.wall-lens').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      lensNote.textContent = lensNames[lens];
      paint();
    }));

    // A soft light follows the pointer across the board
    if (finePointer && !reduce) {
      wall.addEventListener('pointermove', (e) => {
        const r = wall.getBoundingClientRect();
        wall.style.setProperty('--mx', `${e.clientX - r.left}px`);
        wall.style.setProperty('--my', `${e.clientY - r.top}px`);
        wall.classList.add('is-lit');
      });
      wall.addEventListener('pointerleave', () => wall.classList.remove('is-lit'));
    }

    // The threads are drawn the first time the board is seen
    if (reduce || !('IntersectionObserver' in window)) wall.classList.add('is-drawn');
    else {
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        wall.classList.add('is-drawn');
      }, { threshold: 0.25 });
      io.observe(wall);
    }
    drawThreads();
    window.addEventListener('resize', drawThreads);
    if (document.fonts) document.fonts.ready.then(drawThreads);

    // Opening an object opens its story in the case study reader
    $$('.artifact').forEach((a) => {
      a.addEventListener('click', () => caseReader.open(a.dataset.project, { from: a }));
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
    const well = $('[data-well]', root);
    const strata = $$('.stratum', root);
    const bands = $$('.band', root);
    const progress = $('.dig-progress', root);
    const meter = $('.dig-meter-fill', root);
    const opened = new Set([0]);
    let depth = 0;
    strata.forEach((s) => { $('h3', s).tabIndex = -1; });

    // One layer is shown at a time, beside the finished screen it sits under.
    const show = (d, { focus = false, animate = true } = {}) => {
      depth = Math.max(0, Math.min(strata.length - 1, d));
      opened.add(depth);
      bands.forEach((b, i) => {
        b.setAttribute('aria-current', String(i === depth));
        b.classList.toggle('is-opened', opened.has(i));
        $('.band-state', b).textContent = i === depth ? 'Open' : opened.has(i) ? 'Opened' : 'Unopened';
      });
      strata.forEach((s, i) => { s.hidden = i !== depth; });
      progress.textContent = `${opened.size} of ${strata.length} layers opened`;
      meter.style.width = `${(opened.size / strata.length) * 100}%`;
      if (animate) {
        well.classList.remove('is-descending');
        void well.offsetWidth;
        well.classList.add('is-descending');
      }
      if (focus) {
        $('h3', strata[depth]).focus({ preventScroll: true });
        const top = well.getBoundingClientRect().top;
        if (top < 0 || top > window.innerHeight * 0.6) {
          well.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
        }
      }
    };
    bands.forEach((b, i) => b.addEventListener('click', () => show(i, { focus: true })));
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
    const specimens = $('.specimens', panel);
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

    // Both options stand side by side, each under its own pan of the scale
    function showScreens(e) {
      specimens.innerHTML = e.options.map((o, i) => `
        <div class="specimen" data-pick="${i}">
          <div class="specimen-frame"><div class="specimen-screen">${o.screen}</div></div>
          <p class="specimen-cap"><span>${e.scale[o.side < 0 ? 0 : 1]}</span>${o.name}</p>
        </div>`).join('');
      // the phones are a shortcut for pointer users; the radio buttons stay the accessible control
      $$('.specimen', specimens).forEach((sp) => sp.addEventListener('click', () => {
        const input = $(`input[value="${sp.dataset.pick}"]`, row);
        input.checked = true;
        input.dispatchEvent(new Event('change'));
      }));
    }

    function markChosen(i) {
      if (i === null) delete specimens.dataset.chosen;
      else specimens.dataset.chosen = String(i);
      $$('.specimen', specimens).forEach((sp) => sp.classList.toggle('is-chosen', Number(sp.dataset.pick) === i));
      if (motion && i !== null) {
        const pick = $(`.specimen[data-pick="${i}"] .specimen-screen`, specimens);
        gsap.fromTo(pick.children, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.04, ease: 'expo.out' });
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
      markChosen(i);
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
        showScreens(e);
        markChosen(null);
        empty.hidden = false;
        outcome.hidden = true;
      } else {
        const o = e.options[chosen[exp]];
        tilt(o.side);
        showScreens(e);
        specimens.dataset.chosen = String(chosen[exp]);
        $(`.specimen[data-pick="${chosen[exp]}"]`, specimens).classList.add('is-chosen');
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
    const stage = $('.install-stage', fig);
    const canvas = $('canvas', fig);
    const ctx = canvas.getContext('2d');
    const count = $('.count', fig);
    const figure = $('.install-figure', fig);
    const range = $('.install-range', fig);
    const hudState = $('.hud-state b', fig);
    const sides = $$('.ic', fig);
    const replay = $('.install-replay', fig);
    const state = { p: motion ? 0 : 1 };
    const draw = setup(canvas, ctx, state);
    const still = () => draw(0, 0);

    const from = Number(count.dataset.from || 0);
    const to = Number(count.dataset.to);
    // One position, from before launch (0) to after launch (1), drives the drawing, the number and every control
    const render = () => {
      const p = state.p;
      count.textContent = Math.round(lerp(from, to, p)).toLocaleString('en-GB');
      range.value = Math.round(p * 100);
      const label = p < 0.02 ? 'Before launch' : p > 0.98 ? 'After launch' : `Part way, ${Math.round(p * 100)}%`;
      range.setAttribute('aria-valuetext', label);
      hudState.textContent = label;
      fig.style.setProperty('--p', p.toFixed(3));
      fig.dataset.at = p < 0.02 ? 'before' : p > 0.98 ? 'after' : 'between';
      sides[0].setAttribute('aria-pressed', String(p < 0.02));
      sides[1].setAttribute('aria-pressed', String(p > 0.98));
      if (!motion) still();
    };
    // The moving figure is decorative; the before and after buttons state the numbers
    figure.setAttribute('aria-hidden', 'true');

    let tween = null;
    const stop = () => { if (tween) { tween.kill(); tween = null; } };
    const set = (p) => { stop(); state.p = clamp(p); render(); };
    // Glide to a state; without motion, jump straight there
    const go = (target, duration = 1.6) => {
      stop();
      if (!motion) { set(target); return; }
      tween = gsap.to(state, { p: target, duration, ease: 'power2.inOut', onUpdate: render, onComplete: () => { tween = null; } });
    };
    const touched = () => fig.classList.add('is-touched');

    range.addEventListener('input', () => { touched(); set(Number(range.value) / 100); });
    sides.forEach((btn) => btn.addEventListener('click', () => { touched(); go(Number(btn.dataset.p)); }));
    replay.addEventListener('click', () => {
      touched();
      if (!motion) { set(1); return; }
      stop(); state.p = 0; render(); go(1, 3.2);
    });

    // Drag across the artwork itself to scrub. Vertical swipes still scroll the page on touch screens.
    let dragging = false;
    const fromPointer = (e) => {
      const r = stage.getBoundingClientRect();
      set((e.clientX - r.left) / r.width);
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; touched();
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('is-dragging');
      fromPointer(e);
    });
    stage.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
    const end = () => { dragging = false; stage.classList.remove('is-dragging'); };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    render();

    if (motion) {
      // Play from before to after once, the first time the installation is seen
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        if (!fig.classList.contains('is-touched')) go(1, 4);
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

    // 05 · The reader: the text grows to the size she reads at; one layout clips, the other reflows
    function reader(slide) {
      const range = $('.dig-range', slide);
      const out = $('output', slide);
      const modes = $$('.hr-mode', slide);
      const screen = $('.hr-screen', slide);
      const result = $('.hr-result', slide);
      let layout = 'fixed';
      const render = () => {
        const pct = Number(range.value);
        out.textContent = `${pct}%`;
        range.setAttribute('aria-valuetext', `${pct} percent`);
        screen.style.setProperty('--scale', pct / 100);
        screen.dataset.layout = layout;
        modes.forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.layout === layout)));
        if (pct === 100) {
          result.innerHTML = '<p class="hr-result-h">At 100% both layouts look the same.</p><p class="hr-note">That is why nobody noticed. Move the slider to the size Margaret uses.</p>';
        } else if (layout === 'fluid') {
          result.innerHTML = `<p class="hr-result-h">At ${pct}% everything is still on screen.</p><p class="hr-note">Rows stack instead of shrinking. Nothing is cut off.</p>`;
        } else if (pct < 150) {
          result.innerHTML = `<p class="hr-result-h">At ${pct}% the old layout is running out of room.</p><p class="hr-note">One more step and the amounts leave the screen.</p>`;
        } else {
          result.innerHTML = `<p class="hr-result-h">At ${pct}% the old layout cuts the amounts off.</p><p class="hr-note">The numbers are still there. Margaret just cannot see them.</p>`;
        }
      };
      range.addEventListener('input', render);
      modes.forEach((m) => m.addEventListener('click', () => { layout = m.dataset.layout; render(); }));
      render();
      return { live() {}, idle() {} };
    }

    // 06 · The nurse: a call bell interrupts the third check, and the handover resumes where it stopped
    function nurse(slide) {
      const list = $('.hr-checks', slide);
      const items = $$('.hr-item', list);
      const bell = $('.hr-bell', slide);
      const btn = $('.hr-try', slide);
      const result = $('.hr-result', slide);
      const labels = { done: 'Done', here: 'You stopped here', todo: 'To do' };
      const breakAt = 2;
      let done = 0, away = false, wasAway = false;
      const render = () => {
        items.forEach((li, i) => {
          const state = i < done ? 'done' : (wasAway && done === breakAt && i === breakAt ? 'here' : 'todo');
          li.dataset.state = state;
          $('.hr-item-state', li).textContent = labels[state];
        });
        list.hidden = away;
        bell.hidden = !away;
        btn.textContent = away ? 'Return to the handover' : done === items.length ? 'Start again' : 'Confirm next check';
        if (away) {
          result.innerHTML = '<p class="hr-result-h">You were called away mid-task.</p><p class="hr-note">The old form timed out after three minutes and emptied itself.</p>';
        } else if (done === items.length) {
          result.innerHTML = '<p class="hr-result-h">Handover complete.</p><p class="hr-note">Five checks, one interruption, nothing entered twice.</p>';
        } else if (wasAway && done === breakAt) {
          result.innerHTML = `<p class="hr-result-h">Resumed at check ${breakAt + 1} of ${items.length}.</p><p class="hr-note">The two you finished are still finished.</p>`;
        } else {
          result.innerHTML = `<p class="hr-result-h">${done} of ${items.length} checks confirmed.</p><p class="hr-note">Each one is saved the moment you confirm it.</p>`;
        }
      };
      btn.addEventListener('click', () => {
        if (away) away = false;
        else if (done === items.length) { done = 0; wasAway = false; }
        else if (done === breakAt && !wasAway) away = wasAway = true;
        else done++;
        render();
      });
      render();
      return { live() {}, idle() {} };
    }

    // 07 · The sender: a warning before the action, or ten seconds to take it back afterwards
    function sender(slide) {
      const modes = $$('.hr-mode', slide);
      const btn = $('.hr-try', slide);
      const clock = $('.hr-count-down', slide);
      const left = $('[data-undo]', slide);
      const result = $('.hr-result', slide);
      const buttons = { ready: 'Send £200', asking: 'Yes, send it', pending: 'Undo', sent: 'Start again', undone: 'Start again' };
      let guard = 'confirm', stage = 'ready', secs = 10, tick = 0;
      const stop = () => { clearInterval(tick); tick = 0; };
      const render = () => {
        modes.forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.guard === guard)));
        clock.hidden = stage !== 'pending';
        left.textContent = `${secs} sec`;
        btn.textContent = buttons[stage];
        if (stage === 'ready') {
          result.innerHTML = '<p class="hr-note">Nothing has been sent yet.</p>';
        } else if (stage === 'asking') {
          result.innerHTML = '<p class="hr-result-h">Are you sure?</p><p class="hr-note">This cannot be undone. Amara has no new information, only more doubt.</p>';
        } else if (stage === 'pending') {
          result.innerHTML = '<p class="hr-result-h">On its way to Folake.</p><p class="hr-note">You can still take it back. Nothing has left your account yet.</p>';
        } else if (stage === 'undone') {
          result.innerHTML = '<p class="hr-result-h">Stopped. Nothing left your account.</p><p class="hr-note">A way back does what a warning only pretends to do.</p>';
        } else if (guard === 'confirm') {
          result.innerHTML = '<p class="hr-result-h">Sent. It cannot be recalled.</p><p class="hr-note">The question did not make the transfer safer. It only made it slower.</p>';
        } else {
          result.innerHTML = '<p class="hr-result-h">Sent to Folake Adeyemi.</p><p class="hr-note">The undo window has closed. Ten seconds was enough to notice a mistake.</p>';
        }
      };
      // The countdown sits outside the live region, so it is not read out every second
      const run = () => {
        if (tick) return;
        tick = setInterval(() => {
          secs--;
          if (secs > 0) { left.textContent = `${secs} sec`; return; }
          stop(); stage = 'sent'; render();
        }, 1000);
      };
      btn.addEventListener('click', () => {
        if (stage === 'ready' && guard === 'confirm') stage = 'asking';
        else if (stage === 'ready') { stage = 'pending'; secs = 10; run(); }
        else if (stage === 'asking') stage = 'sent';
        else if (stage === 'pending') { stop(); stage = 'undone'; }
        else stage = 'ready';
        render();
      });
      modes.forEach((m) => m.addEventListener('click', () => { stop(); guard = m.dataset.guard; stage = 'ready'; render(); }));
      render();
      return {
        live() { if (stage === 'pending') run(); },
        idle: stop,
      };
    }

    // 08 · The field worker: visits are saved on the phone, and send themselves when the signal returns
    function fieldWorker(slide) {
      const modes = $$('.hr-mode', slide);
      const btn = $('.hr-try', slide);
      const queue = $('.hr-queue', slide);
      const result = $('.hr-result', slide);
      const homes = ['Household 14 · weight check', 'Household 15 · vaccination', 'Household 17 · follow-up', 'Household 21 · new baby'];
      const visitsWord = (n) => (n === 1 ? '1 visit' : `${n} visits`);
      let online = false, visits = [];   // one entry per visit: true once it has reached the clinic
      const render = () => {
        modes.forEach((m) => m.setAttribute('aria-pressed', String(m.dataset.signal === String(online))));
        queue.innerHTML = visits.map((sent, i) => `<li class="hr-item" data-state="${sent ? 'done' : 'todo'}"><span>${homes[i]}</span><span class="hr-item-state">${sent ? 'Sent to the clinic' : 'Saved on this phone'}</span></li>`).join('');
        btn.textContent = visits.length === homes.length ? 'Start the round again' : 'Record a visit';
        const waiting = visits.filter((sent) => !sent).length;
        if (!visits.length) {
          result.innerHTML = `<p class="hr-note">${online ? 'There is signal here. Record a visit and it goes straight to the clinic.' : 'No signal here. Record a visit anyway.'}</p>`;
        } else if (waiting) {
          result.innerHTML = `<p class="hr-result-h">${visitsWord(waiting)} saved on this phone.</p><p class="hr-note">${waiting === 1 ? 'It will send itself' : 'They will send themselves'} when the signal returns. Asha does not have to remember.</p>`;
        } else {
          result.innerHTML = `<p class="hr-result-h">${visits.length === 1 ? 'Your visit has' : `All ${visits.length} visits have`} reached the clinic.</p><p class="hr-note">Nothing was written twice, and nobody pressed sync.</p>`;
        }
      };
      btn.addEventListener('click', () => {
        if (visits.length === homes.length) visits = []; else visits.push(online);
        render();
      });
      modes.forEach((m) => m.addEventListener('click', () => {
        online = m.dataset.signal === 'true';
        if (online) visits = visits.map(() => true);
        render();
      }));
      render();
      return { live() {}, idle() {} };
    }

    // 09 · The hiring lead: an AI agent ranks interviewers by the factors the recruiter switches on, and says why
    function panel(slide) {
      const modes = $$('.hr-mode', slide);
      const list = $('[data-panel]', slide);
      const result = $('.hr-result', slide);
      const reasons = { skills: 'strong skills match', avail: 'free this week', load: 'light interview load', persp: 'adds a different perspective' };
      const people = [
        { name: 'Priya N.', role: 'Staff engineer', skills: 0.96, avail: 0.7, load: 0.15, persp: 0.4, panels: 9 },
        { name: 'Tom R.', role: 'Principal engineer', skills: 0.92, avail: 0.75, load: 0.2, persp: 0.3, panels: 8 },
        { name: 'Mei L.', role: 'Senior engineer', skills: 0.84, avail: 0.8, load: 0.9, persp: 0.7, panels: 2 },
        { name: 'Daniel O.', role: 'Engineering manager', skills: 0.7, avail: 0.9, load: 0.8, persp: 0.65, panels: 3 },
        { name: 'Sara K.', role: 'Product designer', skills: 0.5, avail: 0.85, load: 0.95, persp: 0.95, panels: 1 },
      ];
      const on = new Set(['skills', 'avail']);
      const render = () => {
        modes.forEach((m) => m.setAttribute('aria-pressed', String(on.has(m.dataset.factor))));
        if (!on.size) {
          list.innerHTML = '';
          result.innerHTML = '<p class="hr-result-h">The agent has nothing to weigh.</p><p class="hr-note">Switch on at least one factor. It will not guess what matters to you.</p>';
          return;
        }
        const factors = [...on];
        const ranked = people
          .map((p) => ({ ...p, score: factors.reduce((s, f) => s + p[f], 0) / factors.length }))
          .sort((a, b) => b.score - a.score);
        list.innerHTML = ranked.map((p, i) => {
          const why = factors.filter((f) => p[f] >= 0.75).sort((a, b) => p[b] - p[a]).slice(0, 2).map((f) => reasons[f]);
          const tired = !on.has('load') && i < 3 && p.panels >= 8 ? ` · ${p.panels} panels this month` : '';
          return `<li class="hr-item" data-state="${i < 3 ? 'done' : 'todo'}"><span><b>${p.name}</b> · ${p.role}<span class="hr-why">${why.length ? `Why: ${why.join(', ')}` : 'No strong reason on these factors'}${tired}</span></span><span class="hr-item-state">${i < 3 ? 'Suggested · ' : ''}${Math.round(p.score * 100)}%</span></li>`;
        }).join('');
        const overloaded = ranked.slice(0, 3).filter((p) => p.panels >= 8);
        if (overloaded.length) {
          result.innerHTML = `<p class="hr-result-h">${overloaded.map((p) => p.name).join(' and ')} ${overloaded.length > 1 ? 'are' : 'is'} suggested again.</p><p class="hr-note">Skilled and free, and already on ${overloaded.map((p) => p.panels).join(' and ')} panels this month. Without load, the agent repeats the habit it was meant to fix.</p>`;
        } else {
          result.innerHTML = '<p class="hr-result-h">A panel that spreads the work.</p><p class="hr-note">Every name comes with its reasons. Nadia can still swap anyone before she books.</p>';
        }
      };
      modes.forEach((m) => m.addEventListener('click', () => {
        if (on.has(m.dataset.factor)) on.delete(m.dataset.factor); else on.add(m.dataset.factor);
        render();
      }));
      render();
      return { live() {}, idle() {} };
    }

    // 10 · The late-night searcher: danger signs are checked by fixed rules first, then the model picks a level of care
    function symptomNavigator(slide) {
      const step = $('[data-step]', slide);
      const question = $('[data-question]', slide);
      const answers = $('[data-answers]', slide);
      const trail = $('[data-trail]', slide);
      const result = $('.hr-result', slide);
      const restart = $('.hr-try', slide);
      const QUESTIONS = [
        { key: 'danger', short: 'Danger signs', q: 'Is Yusuf showing any of these?', options: ['None of these', 'A rash that doesn’t fade under a glass', 'Very hard to wake'] },
        { key: 'age', short: 'Age', q: 'How old is Yusuf?', options: ['Under 3 months', '3 months to 5 years', 'Over 5 years'] },
        { key: 'temp', short: 'Temperature', q: 'What is his temperature?', options: ['Under 38°C', '38 to 39°C', 'Over 39°C'] },
      ];
      let picked = [];
      const advise = () => {
        const [danger, age, temp] = picked;
        if (danger > 0) {
          return { level: 'Call 999 now.', why: danger === 1 ? 'A rash that doesn’t fade under a glass can be a sign of sepsis or meningitis.' : 'Being very hard to wake is a danger sign at any temperature.', source: 'From a fixed clinical safety rule. The model was not asked.' };
        }
        if (age === 0 && temp > 0) {
          return { level: 'Speak to a nurse within 1 hour.', why: 'Any fever in a baby under 3 months needs a clinician to check.', source: 'From a fixed clinical safety rule. The model was not asked.' };
        }
        if (temp === 2) {
          return { level: 'Speak to a nurse tonight, within 4 hours.', why: 'A high temperature with no danger signs. Most settle, but a nurse should check.', source: 'From the model. Its confidence was 64%, below our threshold, so it moved you up one level.' };
        }
        return { level: 'Care for him at home tonight.', why: 'No danger signs, and a temperature most children manage at home. Check again in 4 hours. If he becomes hard to wake, or a rash appears, call 999.', source: 'From the model, with 91% confidence.' };
      };
      const render = () => {
        trail.innerHTML = picked.map((a, i) => `<li class="hr-item" data-state="done"><span>${QUESTIONS[i].short}</span><span class="hr-item-state">${QUESTIONS[i].options[a]}</span></li>`).join('');
        const finished = picked.length === QUESTIONS.length || picked[0] > 0;
        restart.hidden = !finished;
        if (finished) {
          const a = advise();
          step.textContent = picked[0] > 0 ? 'Stopped after 1 question' : `Answered ${picked.length} of ${QUESTIONS.length}`;
          question.textContent = 'Here is where to go';
          answers.innerHTML = '';
          result.innerHTML = `<p class="hr-kicker">Level of care</p><p class="hr-result-h">${a.level}</p><p class="hr-note">${a.why}</p><p class="hr-note">${a.source}</p><p class="hr-note">Or speak to a nurse now. One tap, at any point.</p>`;
          return;
        }
        const Q = QUESTIONS[picked.length];
        step.textContent = `Question ${picked.length + 1} of ${QUESTIONS.length}`;
        question.textContent = Q.q;
        answers.innerHTML = Q.options.map((o, i) => `<button class="hr-chip" type="button" data-answer="${i}">${o}</button>`).join('');
        result.innerHTML = picked.length
          ? '<p class="hr-note">No diagnosis, only where to go and how fast.</p>'
          : '<p class="hr-note">Danger signs come first. If any are present, no more questions are asked.</p>';
      };
      answers.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-answer]');
        if (!btn) return;
        picked.push(Number(btn.dataset.answer));
        render();
        const first = $('.hr-chip', answers) || restart;
        if (!first.hidden) first.focus({ preventScroll: true });   // keep keyboard focus in the conversation
      });
      restart.addEventListener('click', () => { picked = []; render(); });
      render();
      return { live() {}, idle() {} };
    }

    // A list of row buttons where exactly one can be chosen; returns a setter that marks the chosen row
    const pickOne = (buttons, onPick) => {
      const mark = (k) => buttons.forEach((b, j) => {
        b.dataset.state = j === k ? '1' : '0';
        b.setAttribute('aria-pressed', String(j === k));
      });
      buttons.forEach((b, k) => b.addEventListener('click', () => { mark(k); onPick(k); }));
      return mark;
    };

    // 11 · The researcher: each AI theme opens onto the quotes and people behind it
    function researcher(slide) {
      const result = $('.hr-result', slide);
      const themes = [
        { name: 'Fees feel hidden until checkout', count: 9, quotes: [['I only saw the booking fee on the last screen. It felt like a trick.', 'P03'], ['I’d rather pay more up front than be surprised.', 'P08']] },
        { name: 'Text reminders are trusted more than the app', count: 6, quotes: [['The text I believe. The app, I have to go and look for.', 'P05'], ['I screenshot the text in case the app logs me out.', 'P11']] },
        { name: 'People want to pay in instalments', count: 4, quotes: [['Splitting it over two months would make it possible this month.', 'P02']] },
        { name: 'Users want a dark mode', count: 1, quotes: [['It’s a bit bright at night, I suppose.', 'P09, in passing']] },
      ];
      pickOne($$('[data-themes] .hr-dose', slide), (k) => {
        const t = themes[k];
        const weak = t.count < 3;
        result.innerHTML = `<p class="hr-kicker">${weak ? 'Weak evidence' : 'Evidence'} · ${t.count} of 12 participants</p><p class="hr-result-h">${t.name}</p>`
          + t.quotes.map(([q, who]) => `<p class="hr-note">“${q}” · ${who}</p>`).join('')
          + `<p class="hr-note">${weak ? 'One person said this once. The copilot keeps it, and marks it so nobody presents it as a finding.' : 'Every quote opens the transcript at the moment it was said.'}</p>`;
      });
      result.innerHTML = '<p class="hr-note">The copilot drafted four themes. None of them is a finding until you have seen its evidence.</p>';
      return { live() {}, idle() {} };
    }

    // 12 · The new joiner: answers cite their sources, admit conflicts and respect access
    function knowledge(slide) {
      const result = $('.hr-result', slide);
      const answers = [
        '<p class="hr-kicker">Answer · 1 source</p><p class="hr-result-h">26 weeks at full pay, for any parent.</p><p class="hr-note">Source: Parental Leave Policy. Owned by the People team, updated March 2026.</p><p class="hr-note">Applies to employees in the UK. Open the source to read the exact wording.</p>',
        '<p class="hr-kicker">Sources disagree</p><p class="hr-result-h">Two pages give different answers.</p><p class="hr-note">Home Working Policy, updated 2026: up to £250 for a chair.</p><p class="hr-note">IT Equipment page, updated 2023: chairs are not covered.</p><p class="hr-note">The assistant won’t choose for you. It has asked the owner, Dev in Finance, to settle it, and will let you know.</p>',
        '<p class="hr-kicker">No access</p><p class="hr-result-h">You can’t see that, so neither can I.</p><p class="hr-note">Salary bands are shared with managers and the People team. The assistant only reads what you can read.</p><p class="hr-note">Hana, your People partner, can talk you through your own band.</p>',
      ];
      pickOne($$('[data-asks] .hr-dose', slide), (k) => { result.innerHTML = answers[k]; });
      result.innerHTML = '<p class="hr-note">Answers come only from company sources, and every one says which.</p>';
      return { live() {}, idle() {} };
    }

    // 13 · The engineer: ranked causes for this machine; each “didn’t fix it” moves to the next
    function engineer(slide) {
      const list = $('[data-causes]', slide);
      const acts = $('[data-acts]', slide);
      const restart = $('.hr-try', slide);
      const result = $('.hr-result', slide);
      const causes = [
        { name: 'Low refrigerant pressure', why: 'This unit logged E-47 in May. A leak repair fixed it then.' },
        { name: 'Blocked condenser coil', why: 'Fixed 41% of E-47 faults on this model across the fleet.' },
        { name: 'Failed pressure sensor', why: 'The sensor is six years old, past its usual life.' },
      ];
      let at = 0, fixed = false;
      const render = () => {
        const over = fixed || at === causes.length;
        list.innerHTML = causes.map((c, i) => {
          const state = i < at ? 'Ruled out' : i === at ? (fixed ? 'Fixed' : 'Check this now') : 'Next';
          return `<li class="hr-item" data-state="${i === at && !fixed ? 'here' : i < at || (fixed && i === at) ? 'done' : 'todo'}"><span><b>${i + 1}. ${c.name}</b><span class="hr-why">${c.why}</span></span><span class="hr-item-state">${state}</span></li>`;
        }).join('');
        acts.hidden = over;
        restart.hidden = !over;
        if (fixed) {
          const ruled = causes.slice(0, at).map((c) => c.name.toLowerCase());
          result.innerHTML = `<p class="hr-kicker">Job report drafted</p><p class="hr-result-h">E-47 fixed: ${causes[at].name.toLowerCase()}.</p><p class="hr-note">${ruled.length ? `Ruled out first: ${ruled.join(', ')}. ` : ''}Written from what happened on the job. Check it and sign. There is nothing to type.</p>`;
        } else if (over) {
          result.innerHTML = '<p class="hr-result-h">The copilot has run out of likely causes.</p><p class="hr-note">It says so instead of guessing. A specialist is booked, and everything you ruled out goes with the job.</p>';
        } else {
          result.innerHTML = `<p class="hr-note">Step ${at + 1} of ${causes.length}. ${at ? 'What you ruled out is saved, and it improves the next suggestion for everyone.' : 'Ranked for this chiller, from its own history and similar fixes across the fleet.'}</p>`;
        }
      };
      acts.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        if (btn.dataset.act === 'fixed') fixed = true; else at++;
        render();
        if (!restart.hidden) restart.focus({ preventScroll: true });
      });
      restart.addEventListener('click', () => { at = 0; fixed = false; render(); });
      render();
      return { live() {}, idle() {} };
    }

    const cases = { patient, parent, commuter, stress, reader, nurse, sender, fieldWorker, panel, symptomNavigator, researcher, knowledge, engineer };
    const hooks = slides.map((slide) => cases[slide.dataset.case](slide));

    // The full case study under each moment opens in the case study reader, where it has room to be read.
    // Without JavaScript it stays a fold-out beneath the moment.
    const studies = slides.map((slide) => {
      const study = $('.hr-case', slide);
      if (!study) return null;
      const body = $('.hr-case-body', study);
      const sub = $('.hr-case-sub', study).textContent;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hr-case-open';
      btn.innerHTML = $('summary', study).innerHTML;
      btn.addEventListener('click', () => caseReader.open(slide.dataset.case.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), { from: btn }));
      // It sits with the exhibit, straight after the decision it explains
      const decision = $('.moment-decision', slide);
      const more = study.closest('.hr-more');
      if (decision) {
        decision.after(btn);
        if (more) more.remove(); else study.remove();
      } else {
        study.replaceWith(btn);
      }
      return { slide, body, sub };
    }).filter(Boolean);
    slides.forEach((slide) => $$('.hr-unfold > *', slide).forEach((el, i) => el.style.setProperty('--i', i)));

    // The index: every moment by number and name, grouped as human and AI
    const dots = slides.map((slide, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'hr-dot';
      d.dataset.kind = slide.dataset.kind;
      d.innerHTML = `<span class="hr-dot-no">${String(i + 1).padStart(2, '0')}</span><span class="hr-dot-name">${slide.dataset.name}</span>`;
      $(`.hr-group[data-group="${slide.dataset.kind}"] .hr-dots`, root).appendChild(d);
      return d;
    });

    // Human or AI: one row at a time. The toggle follows the carousel, and choosing a kind walks to its first moment.
    const tabs = $$('.hr-tab', root);
    const groups = $$('.hr-group', root);
    let kind = 'human';
    tabs.forEach((t) => { $('[data-n]', t).textContent = slides.filter((s) => s.dataset.kind === t.dataset.tab).length; });

    // Each row says how much of it is out of sight, and offers to show it
    const railState = (group) => {
      const row = $('.hr-dots', group);
      const r = row.getBoundingClientRect();
      const items = $$('.hr-dot', row).map((d) => d.getBoundingClientRect());
      const after = items.filter((b) => b.right > r.right + 2).length;
      const before = items.filter((b) => b.left < r.left - 2).length;
      const more = $('.hr-scroll--more', group), back = $('.hr-scroll--back', group);
      more.hidden = !after;
      back.hidden = !before;
      $('[data-more]', more).textContent = `${after} more`;
      more.setAttribute('aria-label', `Show ${after} more ${group.dataset.group === 'ai' ? 'AI' : 'human'} moments`);
      $('.hr-rail', group).classList.toggle('has-more', !!after);
      $('.hr-rail', group).classList.toggle('has-back', !!before);
    };
    const refreshRails = () => groups.forEach((g) => { if (!g.hidden) railState(g); });
    groups.forEach((g) => {
      const row = $('.hr-dots', g);
      row.addEventListener('scroll', () => railState(g), { passive: true });
      $('.hr-scroll--more', g).addEventListener('click', () => row.scrollBy({ left: row.clientWidth * 0.75, behavior: reduce ? 'auto' : 'smooth' }));
      $('.hr-scroll--back', g).addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.75, behavior: reduce ? 'auto' : 'smooth' }));
    });
    window.addEventListener('resize', refreshRails);
    if (document.fonts) document.fonts.ready.then(refreshRails);

    const setKind = (k) => {
      if (k === kind) return;
      kind = k;
      tabs.forEach((t) => {
        const on = t.dataset.tab === k;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      $('.hr-switch', root).dataset.kind = k;
      groups.forEach((g) => { g.hidden = g.dataset.group !== k; });
      refreshRails();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => {
        if (slides[index] && slides[index].dataset.kind === t.dataset.tab) return setKind(t.dataset.tab);
        go(slides.findIndex((s) => s.dataset.kind === t.dataset.tab));
      });
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const other = tabs[(i + 1) % tabs.length];
        other.focus();
        other.click();
      });
    });

    // The track is as tall as the moment on screen, and follows it as it grows (results, an opened case study)
    const fit = () => { if (slides[index]) track.style.height = `${slides[index].offsetHeight}px`; };
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(fit);
      slides.forEach((s) => ro.observe(s));
    }

    let index = -1, centre = 0;
    const go = (i, { scroll = true } = {}) => {
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i !== index) {
        index = i;
        slides.forEach((s, j) => {
          const live = j === index;
          s.classList.toggle('is-live', live);
          if (live) hooks[j].live(); else hooks[j].idle();
        });
        dots.forEach((d, j) => d.setAttribute('aria-current', String(j === index)));
        dots[index].dataset.seen = '';
        setKind(slides[index].dataset.kind);
        root.style.setProperty('--hr-progress', slides.length > 1 ? index / (slides.length - 1) : 1);
        // Each row scrolls sideways, so bring the current name into view
        clearTimeout(centre);
        centre = setTimeout(() => {
          const d = dots[index], row = d.parentElement;
          if (row.scrollWidth <= row.clientWidth) return;
          const left = row.scrollLeft + d.getBoundingClientRect().left - row.getBoundingClientRect().left - (row.clientWidth - d.offsetWidth) / 2;
          row.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
        }, reduce ? 0 : 280);
        count.textContent = `${index + 1} / ${slides.length}`;
        prev.disabled = index === 0;
        next.disabled = index === slides.length - 1;
        fit();
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
      if (e.target.matches('input')) return;   // arrow keys belong to the slider while it has focus
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    });
    dots.forEach((d, j) => d.addEventListener('click', () => go(j)));
    prev.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));
    window.addEventListener('resize', () => { track.scrollLeft = index * track.clientWidth; });

    go(0, { scroll: false });
    refreshRails();

    return {
      studies,
      // Walk to a moment from elsewhere, such as "Try the interactive exhibit" in the reader
      show(slide) {
        const room = $('#human-room');
        room.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
        track.scrollLeft = 0;
        index = -1;
        go(slides.indexOf(slide), { scroll: false });
        track.scrollLeft = index * track.clientWidth;
        const stage = $('.hr-stage', slide);
        if (stage) {
          if (!stage.hasAttribute('tabindex')) stage.setAttribute('tabindex', '-1');
          stage.focus({ preventScroll: true });
        }
      },
    };
  }

  initChrome();
  initEntrance();
  initArrival();
  const humanRoom = initHumanRoom();
  initCaseReader(humanRoom);
  initParallaxFallback();
  initEvidenceWall();
  initInvisibleWork();
  initDecisionLab();
  initImpact();
  updateVisitSummary();

})();
