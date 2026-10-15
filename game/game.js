/* 균승이 개패기 — 1인칭 잠입 게임 (Three.js)
   현관에서 출발 → 소리 안 나게 균승이 방까지 → 한 대 때리기 → 현관으로 복귀.
   무궁화꽃이 피었습니다 규칙: 균승이가 고개를 들 때 움직이면 들킨다. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), canvas = $('#gl'), fist = $('#fist'), flash = $('#flash'), vignette = $('#vignette');
  const bubble = $('#bubble'), statusEl = $('#status'), timerEl = $('#timer'), timerSub = $('#timerSub');
  const friendIcon = $('#friendIcon'), friendText = $('#friendText');
  const noiseBar = $('#noiseBar > i'), stamBar = $('#stamBar > i'), noiseText = $('#noiseText'), stamText = $('#stamText');
  const btnHit = $('#btnHit'), btnSneak = $('#btnSneak'), btnRun = $('#btnRun'), joy = $('#joy'), knob = $('#knob');
  const minimap = $('#minimap'), mctx = minimap.getContext('2d');

  // ======================= 난이도 =======================
  const DIFF = {
    easy:   { label: '쉬움',   chase: 1.7, lookMin: 6,   lookMax: 10,  lookDurMin: 1.0, lookDurMax: 1.6, cue: 0.8,  suspicion: 1.7, trash: 14 },
    normal: { label: '보통',   chase: 2.3, lookMin: 4.5, lookMax: 8,   lookDurMin: 1.2, lookDurMax: 2.0, cue: 0.6,  suspicion: 1.15, trash: 22 },
    hard:   { label: '어려움', chase: 2.9, lookMin: 3.5, lookMax: 6.5, lookDurMin: 1.4, lookDurMax: 2.4, cue: 0.45, suspicion: 0.8, trash: 32 },
  };
  let diffKey = 'normal';
  const D = () => DIFF[diffKey];

  // ======================= 오디오 =======================
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let actx = null, master = null, muted = false, ambientNodes = [];
  function initAudio() {
    if (actx || !AudioCtx) return;
    try { actx = new AudioCtx(); master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination); } catch (_) { actx = null; }
  }
  function noiseBuffer(sec) {
    const b = actx.createBuffer(1, Math.max(1, Math.floor(actx.sampleRate * sec)), actx.sampleRate);
    const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
  }
  function env(g, t, peak, attack, decay) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay); }
  let stepSide = 1;
  function sfxStep(kind, surface) { // kind: sneak | walk | run
    if (!actx || muted) return;
    const t = actx.currentTime, run = kind === 'run', sneak = kind === 'sneak';
    const vol = sneak ? 0.22 : run ? 0.9 : 0.55;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer(0.14);
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = surface === 'tile' ? 2.5 : 0.9;
    bp.frequency.value = surface === 'tile' ? 1500 + Math.random() * 500 : surface === 'rug' ? 220 + Math.random() * 80 : 330 + Math.random() * 160;
    const g = actx.createGain(); env(g, t, vol, 0.008, run ? 0.1 : 0.15);
    const pan = actx.createStereoPanner ? actx.createStereoPanner() : null; stepSide = -stepSide; if (pan) pan.pan.value = stepSide * 0.45;
    const thump = actx.createOscillator(); thump.type = 'sine'; thump.frequency.setValueAtTime(surface === 'tile' ? 180 : 110, t); thump.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const tg = actx.createGain(); env(tg, t, vol * (surface === 'rug' ? 0.5 : 0.8), 0.005, 0.13);
    src.connect(bp).connect(g); thump.connect(tg);
    if (pan) { g.connect(pan); tg.connect(pan); pan.connect(master); } else { g.connect(master); tg.connect(master); }
    src.start(t); thump.start(t); src.stop(t + 0.25); thump.stop(t + 0.25);
  }
  function sfxCreak() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(260, t); o.frequency.linearRampToValueAtTime(170, t + 0.35); o.frequency.linearRampToValueAtTime(230, t + 0.5);
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 6;
    const g = actx.createGain(); env(g, t, 0.35, 0.05, 0.5);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.6);
  }
  function sfxTrash(kind) { // box | can | bag | cup
    if (!actx || muted) return;
    const t = actx.currentTime;
    if (kind === 'can') {
      const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(2200 + Math.random() * 600, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.25);
      const g = actx.createGain(); env(g, t, 0.6, 0.004, 0.3); o.connect(g).connect(master); o.start(t); o.stop(t + 0.35);
      const o2 = actx.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(1400, t + 0.12); const g2 = actx.createGain(); env(g2, t + 0.12, 0.25, 0.004, 0.2);
      o2.connect(g2).connect(master); o2.start(t + 0.12); o2.stop(t + 0.4);
      return;
    }
    const n = kind === 'bag' ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const dt = i * (kind === 'bag' ? 0.06 : 0.09) + Math.random() * 0.02;
      const src = actx.createBufferSource(); src.buffer = noiseBuffer(0.12);
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = kind === 'bag' ? 3500 + Math.random() * 2000 : 1200 + Math.random() * 800; bp.Q.value = 1.2;
      const g = actx.createGain(); env(g, t + dt, kind === 'bag' ? 0.5 : 0.8, 0.004, 0.1);
      src.connect(bp).connect(g).connect(master); src.start(t + dt); src.stop(t + dt + 0.2);
    }
  }
  function sfxPunch() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer(0.25);
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    const g = actx.createGain(); env(g, t, 1.2, 0.004, 0.25);
    const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const og = actx.createGain(); env(og, t, 1, 0.004, 0.22);
    src.connect(lp).connect(g).connect(master); o.connect(og).connect(master); src.start(t); o.start(t); src.stop(t + 0.3); o.stop(t + 0.3);
  }
  function sfxWhoosh() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer(0.3);
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3000, t + 0.18);
    const g = actx.createGain(); env(g, t, 0.5, 0.08, 0.22); src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + 0.32);
  }
  function sfxAlarm() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(660, t + 0.09); o.frequency.setValueAtTime(880, t + 0.18); o.frequency.setValueAtTime(660, t + 0.27);
    const g = actx.createGain(); env(g, t, 0.18, 0.005, 0.4); o.connect(g).connect(master); o.start(t); o.stop(t + 0.42);
  }
  function sfxCue() { // 균승이가 고개 들기 직전: 젓가락 내려놓는 소리 + 의자 삐걱
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(3200, t); o.frequency.exponentialRampToValueAtTime(2200, t + 0.08);
    const g = actx.createGain(); env(g, t, 0.35, 0.003, 0.12); o.connect(g).connect(master); o.start(t); o.stop(t + 0.15);
    const o2 = actx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(140, t + 0.1); o2.frequency.linearRampToValueAtTime(200, t + 0.35);
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 5;
    const g2 = actx.createGain(); env(g2, t + 0.1, 0.25, 0.03, 0.3); o2.connect(f).connect(g2).connect(master); o2.start(t + 0.1); o2.stop(t + 0.5);
  }
  function sfxChew() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer(0.08);
    const bp = actx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 500;
    const g = actx.createGain(); env(g, t, 0.16, 0.01, 0.08); src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + 0.12);
  }
  function sfxHeart() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    for (const dt of [0, 0.14]) {
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.1);
      const g = actx.createGain(); env(g, t + dt, 0.5, 0.005, 0.12); o.connect(g).connect(master); o.start(t + dt); o.stop(t + dt + 0.14);
    }
  }
  function sfxDoor() {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.linearRampToValueAtTime(320, t + 0.6);
    const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 4;
    const g = actx.createGain(); env(g, t, 0.3, 0.05, 0.7); o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.8);
    const c = actx.createOscillator(); c.type = 'square'; c.frequency.setValueAtTime(1200, t + 0.7); const cg = actx.createGain(); env(cg, t + 0.7, 0.2, 0.003, 0.08);
    c.connect(cg).connect(master); c.start(t + 0.7); c.stop(t + 0.85);
  }
  function startAmbient() { // 집안 환풍기/냉장고 웅웅
    if (!actx || ambientNodes.length) return;
    const src = actx.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const g = actx.createGain(); g.gain.value = 0.08;
    src.connect(lp).connect(g).connect(master); src.start();
    const hum = actx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 60; const hg = actx.createGain(); hg.gain.value = 0.03; hum.connect(hg).connect(master); hum.start();
    ambientNodes = [src, hum, g, hg];
  }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; if (m && 'speechSynthesis' in window) speechSynthesis.cancel(); }

  // ---- "엥마" 음성: ./voice/engma.mp3 가 있으면 실제 목소리, 없으면 TTS ----
  const voiceFiles = { hit: './voice/engma.mp3', catch: './voice/engma_catch.mp3' };
  const voiceClips = {};
  async function probeVoice(kind) {
    try { const r = await fetch(voiceFiles[kind], { method: 'HEAD' }); const ct = r.headers.get('content-type') || '';
      if (r.ok && ct.startsWith('audio')) { const a = new Audio(voiceFiles[kind]); a.preload = 'auto'; voiceClips[kind] = a; } } catch (_) {}
  }
  probeVoice('hit'); probeVoice('catch');
  let koVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    koVoice = vs.find(v => /ko/i.test(v.lang) && /female|yuna|sora|heami|여/i.test(v.name)) || vs.find(v => /ko/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  const ENGMA_LINES = ['엥마~', '엥~마!', '엥마 엥마~', '에엥마~'];
  function sayEngma(kind) {
    if (muted) return;
    const clip = voiceClips[kind] || voiceClips.hit;
    if (clip) { try { clip.currentTime = 0; clip.play(); } catch (_) {} return; }
    if (!('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(kind === 'catch' ? '엥마! 잡았지롱~' : ENGMA_LINES[Math.floor(Math.random() * ENGMA_LINES.length)]);
      u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice; u.pitch = 2; u.rate = kind === 'catch' ? 1.25 : 1.1; speechSynthesis.speak(u);
    } catch (_) {}
  }

  // ======================= 절차적 텍스처 =======================
  function makeTex(w, h, draw, repeatX = 1, repeatY = 1) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function grain(ctx, w, h, alpha, n = 4000) { for (let i = 0; i < n; i++) { ctx.fillStyle = `rgba(${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},${alpha})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }
  const TEX = {};
  function buildTextures() {
    TEX.wood = makeTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(0, 0, w, h);
      const rows = 8, cols = 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const off = (r % 2) * (w / cols / 2); const x = c * (w / cols) + off - (w / cols / 2) * (r % 2 ? 0 : 0), y = r * (h / rows);
        const l = 0.78 + Math.random() * 0.3; ctx.fillStyle = `rgb(${Math.round(140 * l)},${Math.round(92 * l)},${Math.round(54 * l)})`;
        ctx.fillRect(x, y, w / cols, h / rows);
        for (let k = 0; k < 14; k++) { ctx.strokeStyle = `rgba(60,30,10,${0.08 + Math.random() * 0.12})`; ctx.lineWidth = 1 + Math.random() * 2; ctx.beginPath();
          const yy = y + Math.random() * (h / rows); ctx.moveTo(x, yy); ctx.bezierCurveTo(x + 60, yy + (Math.random() * 8 - 4), x + 120, yy + (Math.random() * 8 - 4), x + w / cols, yy + (Math.random() * 6 - 3)); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(30,15,5,.55)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w / cols, h / rows);
      }
      grain(ctx, w, h, 0.06);
    }, 4, 4);
    TEX.wallpaper = makeTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#d8d0bf'; ctx.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) { ctx.fillStyle = (x / 16) % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.03)'; ctx.fillRect(x, 0, 16, h); }
      grain(ctx, w, h, 0.05, 2500);
    }, 6, 3);
    TEX.wallpaperRoom = makeTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#c9ccd3'; ctx.fillRect(0, 0, w, h); grain(ctx, w, h, 0.05, 2500);
      ctx.fillStyle = 'rgba(255,255,255,.06)'; for (let y = 0; y < h; y += 32) ctx.fillRect(0, y, w, 1);
    }, 6, 3);
    TEX.tile = makeTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#b8b4ab'; ctx.fillRect(0, 0, w, h);
      const n = 4; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const l = 0.9 + Math.random() * 0.1; ctx.fillStyle = `rgb(${Math.round(226 * l)},${Math.round(222 * l)},${Math.round(212 * l)})`;
        ctx.fillRect(i * w / n + 4, j * h / n + 4, w / n - 8, h / n - 8); }
      grain(ctx, w, h, 0.05);
    }, 6, 6);
    TEX.rug = makeTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#5a3f3b'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#a0776c'; ctx.lineWidth = 10; ctx.strokeRect(24, 24, w - 48, h - 48);
      ctx.strokeStyle = '#7a5750'; ctx.lineWidth = 4; ctx.strokeRect(60, 60, w - 120, h - 120);
      ctx.fillStyle = '#8e6a60'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, 40 + i * 25, 0, Math.PI * 2); ctx.stroke(); }
      grain(ctx, w, h, 0.09, 9000);
    });
    TEX.ceiling = makeTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#e9e6df'; ctx.fillRect(0, 0, w, h); grain(ctx, w, h, 0.04, 800); }, 8, 6);
    TEX.fabric = makeTex(256, 256, (ctx, w, h) => { ctx.fillStyle = '#4b5563'; ctx.fillRect(0, 0, w, h); grain(ctx, w, h, 0.12, 9000); }, 2, 2);
    TEX.bedding = makeTex(256, 256, (ctx, w, h) => { ctx.fillStyle = '#9fb5c9'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
      for (let i = 0; i < w; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); } grain(ctx, w, h, 0.06, 3000); }, 2, 2);
    TEX.window = makeTex(256, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0a1326'); g.addColorStop(1, '#1b2a4a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,${200 + Math.random() * 55},${120 + Math.random() * 100},${0.4 + Math.random() * 0.6})`; ctx.fillRect(Math.random() * w, h * 0.45 + Math.random() * h * 0.5, 3, 4); }
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, 0, w, 6);
    });
    TEX.monitor = makeTex(512, 320, (ctx, w, h) => {
      ctx.fillStyle = '#121214'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1f1f24'; ctx.fillRect(0, 0, w * 0.68, h);
      const g = ctx.createRadialGradient(w * 0.34, h * 0.55, 10, w * 0.34, h * 0.55, 180); g.addColorStop(0, '#6b4a3a'); g.addColorStop(1, '#231a16'); ctx.fillStyle = g; ctx.fillRect(0, 0, w * 0.68, h);
      ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(26, 26, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('LIVE  균승이 먹방 🍗', 44, 34);
      ctx.font = '18px sans-serif'; ctx.fillStyle = '#ddd'; ctx.fillText('👁 1,284', w * 0.68 - 110, 34);
      ctx.fillStyle = '#17171c'; ctx.fillRect(w * 0.68, 0, w * 0.32, h);
      const chat = ['형 치킨 몇 마리째', '엥마ㅋㅋㅋ', '뒤에 누구 있는데', '한입만', '오늘 양념?', 'ㅋㅋㅋㅋㅋ', '소리 뭐야'];
      ctx.font = '15px sans-serif'; chat.forEach((c, i) => { ctx.fillStyle = `hsl(${(i * 53) % 360},70%,65%)`; ctx.fillText('시청자' + (i + 1), w * 0.69, 40 + i * 36); ctx.fillStyle = '#eee'; ctx.fillText(c, w * 0.69, 58 + i * 36); });
    });
    TEX.tv = makeTex(512, 288, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1a2a44'); g.addColorStop(1, '#0a0f1a'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c62828'; ctx.fillRect(0, h - 56, w, 56); ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('속보  동네 친구, 먹방 중 기습 당해', 20, h - 20);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; for (let i = 0; i < 30; i++) ctx.fillRect(Math.random() * w, Math.random() * (h - 60), 40, 6);
    });
    TEX.poster = makeTex(256, 384, (ctx, w, h) => {
      ctx.fillStyle = '#f5e7c8'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#b71c1c'; ctx.fillRect(16, 16, w - 32, 90);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 44px sans-serif'; ctx.fillText('균승 먹방', 30, 78);
      ctx.fillStyle = '#333'; ctx.font = 'bold 28px sans-serif'; ctx.fillText('매일 밤 10시', 40, 160); ctx.fillText('치킨 3마리', 40, 210); ctx.fillText('엥마 금지', 40, 260);
      ctx.font = '90px serif'; ctx.fillText('🍗', 70, 360);
    });
    TEX.chicken = makeTex(256, 256, (ctx, w, h) => { ctx.fillStyle = '#e8dcc3'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c62828'; ctx.fillRect(0, 0, w, 70); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('치킨', 80, 52);
      ctx.fillStyle = 'rgba(120,70,20,.35)'; for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(Math.random() * w, 90 + Math.random() * 160, 8 + Math.random() * 14, 0, 7); ctx.fill(); } });
    TEX.pizza = makeTex(256, 256, (ctx, w, h) => { ctx.fillStyle = '#d9b382'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#2e7d32'; ctx.fillRect(20, 20, w - 40, 60); ctx.fillStyle = '#fff'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('PIZZA', 70, 64); grain(ctx, w, h, 0.05); });
    TEX.bag = makeTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#eef3ff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#2962ff'; ctx.font = 'bold 22px sans-serif'; ctx.fillText('배달', 36, 70); grain(ctx, w, h, 0.1); });
    TEX.can = makeTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#1565c0'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(0, 50, w, 28); ctx.fillStyle = '#1565c0'; ctx.font = 'bold 20px sans-serif'; ctx.fillText('COLA', 32, 72); });
    TEX.cup = makeTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#f44336'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('라면', 36, 72); });
    TEX.shoe = makeTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#5d4037'; ctx.fillRect(0, 0, w, h); grain(ctx, w, h, 0.1); });
    TEX.fridge = makeTex(128, 256, (ctx, w, h) => { ctx.fillStyle = '#e6e8ea'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c5c8cc'; ctx.fillRect(0, 100, w, 4); ctx.fillStyle = '#9aa0a6'; ctx.fillRect(100, 40, 8, 50); ctx.fillRect(100, 120, 8, 100);
      ctx.fillStyle = '#ff7043'; ctx.fillRect(20, 30, 30, 30); ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText('치킨', 22, 50); });
    TEX.mat = makeTex(128, 64, (ctx, w, h) => { ctx.fillStyle = '#6d4c41'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#d7ccc8'; ctx.font = 'bold 22px sans-serif'; ctx.fillText('WELCOME', 8, 40); });
    TEX.slap = makeTex(128, 128, (ctx, w, h) => { const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(255,60,60,.85)'); g.addColorStop(0.5, 'rgba(255,60,60,.45)'); g.addColorStop(1, 'rgba(255,60,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); });
    TEX.stars = makeTex(256, 128, (ctx, w, h) => { ctx.font = '48px serif'; ctx.fillText('⭐', 10, 60); ctx.fillText('💫', 100, 100); ctx.fillText('⭐', 190, 60); });
    TEX.eyes = makeTex(256, 96, (ctx, w, h) => { ctx.font = 'bold 60px sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeText('👀 ?', 50, 70); ctx.fillText('👀 ?', 50, 70); });
    TEX.exclaim = makeTex(128, 128, (ctx, w, h) => { ctx.font = 'bold 100px sans-serif'; ctx.fillStyle = '#ff3b3b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 8; ctx.strokeText('!', 44, 100); ctx.fillText('!', 44, 100); });
  }

  // ======================= 월드 =======================
  let renderer, scene, camera;
  const solids = [];      // {x0,z0,x1,z1} 충돌 박스
  const trash = [];       // {mesh,x,z,kind,hitT}
  const creaks = [];      // {x0,z0,x1,z1,t}
  const WORLD = { w: 16, d: 11, start: { x: 1.7, z: 10.0 }, seat: { x: 12.5, z: 1.75 }, roomRect: { x0: 9.15, z0: 0.15, x1: 15.85, z1: 4.85 }, door: { x: 10.7, z: 5 } };
  const friend = { sprite: null, state: 'eat', pos: new THREE.Vector3(WORLD.seat.x, 0, WORLD.seat.z), tex: {}, t: 0, nextLook: 5, lookEnd: 0, cueAt: 0, cued: false, suspicion: 0, frame: 0, frameT: 0, path: null, pathT: 0, hitOff: 0, stunned: 0, chewT: 0, slap: null, stars: null, eyes: null, exclaim: null, light: null };

  function addSolid(x0, z0, x1, z1) { solids.push({ x0, z0, x1, z1 }); }
  function box(w, h, d, mat, x, y, z, solid = true, castShadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = castShadow; m.receiveShadow = true; scene.add(m);
    if (solid) addSolid(x - w / 2, z - d / 2, x + w / 2, z + d / 2); return m;
  }
  function wall(x0, z0, x1, z1, mat, h = 2.7) { const w = x1 - x0, d = z1 - z0; return box(w, h, d, mat, (x0 + x1) / 2, h / 2, (z0 + z1) / 2, true, true); }
  function plane(w, d, mat, x, y, z, rotX = -Math.PI / 2) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = rotX; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; }
  function pointLight(color, intensity, x, y, z, shadow = false, dist = 0) {
    const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); l.castShadow = shadow;
    if (shadow) { l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.004; l.shadow.radius = 3; } scene.add(l); return l;
  }
  function ceilingLamp(x, z, color = 0xffe3b5, intensity = 14, shadow = false) {
    const l = pointLight(color, intensity, x, 2.45, z, shadow, 14);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 2.2 })); m.position.set(x, 2.66, z); scene.add(m); return l;
  }
  function sprite(tex, w, h, x, y, z) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); s.scale.set(w, h, 1); s.position.set(x, y, z); scene.add(s); return s; }

  function buildWorld() {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x05060a); scene.fog = new THREE.Fog(0x05060a, 14, 30);
    const M = {
      wood: new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.55, metalness: 0.05 }),
      tile: new THREE.MeshStandardMaterial({ map: TEX.tile, roughness: 0.35, metalness: 0.05 }),
      wall: new THREE.MeshStandardMaterial({ map: TEX.wallpaper, roughness: 0.9 }),
      wallRoom: new THREE.MeshStandardMaterial({ map: TEX.wallpaperRoom, roughness: 0.9 }),
      ceiling: new THREE.MeshStandardMaterial({ map: TEX.ceiling, roughness: 1 }),
      rug: new THREE.MeshStandardMaterial({ map: TEX.rug, roughness: 1 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.7 }),
      darkWood: new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.6 }),
      white: new THREE.MeshStandardMaterial({ color: 0xeceff1, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.3, metalness: 0.8 }),
      black: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 }),
      fabric: new THREE.MeshStandardMaterial({ map: TEX.fabric, roughness: 1 }),
      bedding: new THREE.MeshStandardMaterial({ map: TEX.bedding, roughness: 1 }),
      pillow: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 1 }),
      window: new THREE.MeshStandardMaterial({ map: TEX.window, emissive: 0x334466, emissiveMap: TEX.window, emissiveIntensity: 0.9, roughness: 0.2 }),
      monitor: new THREE.MeshStandardMaterial({ map: TEX.monitor, emissive: 0xffffff, emissiveMap: TEX.monitor, emissiveIntensity: 1.4, roughness: 0.4 }),
      tv: new THREE.MeshStandardMaterial({ map: TEX.tv, emissive: 0xffffff, emissiveMap: TEX.tv, emissiveIntensity: 1.1, roughness: 0.4 }),
      poster: new THREE.MeshStandardMaterial({ map: TEX.poster, roughness: 0.9 }),
      plant: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 }),
      pot: new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 }),
      fridge: new THREE.MeshStandardMaterial({ map: TEX.fridge, roughness: 0.35, metalness: 0.2 }),
      door: new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.7 }),
      frontDoor: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5, metalness: 0.4 }),
      mat: new THREE.MeshStandardMaterial({ map: TEX.mat, roughness: 1 }),
      ring: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3 }),
      chicken: new THREE.MeshStandardMaterial({ map: TEX.chicken, roughness: 0.9 }),
      pizza: new THREE.MeshStandardMaterial({ map: TEX.pizza, roughness: 0.9 }),
      bag: new THREE.MeshStandardMaterial({ map: TEX.bag, roughness: 0.6 }),
      can: new THREE.MeshStandardMaterial({ map: TEX.can, roughness: 0.3, metalness: 0.6 }),
      cup: new THREE.MeshStandardMaterial({ map: TEX.cup, roughness: 0.8 }),
      startRing: new THREE.MeshBasicMaterial({ color: 0xffd33d, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    };
    M.monitor.emissiveMap.colorSpace = THREE.SRGBColorSpace;

    // ---- 바닥 / 천장 ----
    plane(9, 11, M.wood, 4.5, 0, 5.5);             // 거실+현관+북서 복도 (나무)
    plane(7, 6, M.tile, 12.5, 0, 8);               // 주방 (타일)
    plane(7, 5, M.wood, 12.5, 0.001, 2.5);         // 균승이 방 (나무)
    plane(3, 2, M.tile, 1.5, 0.002, 1);            // 화장실 바닥 (문 닫힘)
    plane(3.2, 2.2, M.rug, 2.4, 0.004, 5.0);       // 거실 러그
    plane(0.9, 0.6, M.mat, 1.7, 0.004, 10.4);      // 현관 매트
    plane(16, 11, M.ceiling, 8, 2.7, 5.5, Math.PI / 2);
    // 삐걱거리는 마루 (약간 다른 색)
    const creakPatches = [[8.6, 7.3, 9.6, 8.7], [10.1, 4.4, 11.3, 5.6], [3.9, 1.7, 5.5, 2.5]];
    for (const [x0, z0, x1, z1] of creakPatches) creaks.push({ x0, z0, x1, z1, t: 0 });  // 보이지 않는 삐걱 구간 (문턱 근처)

    // ---- 벽 ----
    const W = M.wall;
    wall(0, 10.85, 16, 11, W); wall(0, 0, 16, 0.15, W); wall(0, 0, 0.15, 11, W); wall(15.85, 0, 16, 11, W);
    wall(3, 9.4, 3.15, 10.85, W); wall(0.15, 8.2, 1.4, 8.35, W);                       // 현관 벽
    wall(9, 0.15, 9.15, 7.2, M.wallRoom); wall(9, 8.8, 9.15, 10.85, W);               // 거실/주방 - 방 경계
    wall(9.15, 4.85, 10.2, 5, M.wallRoom); wall(11.2, 4.85, 15.85, 5, M.wallRoom);     // 방 남쪽 벽 (문 10.2~11.2)
    wall(0.15, 1.85, 4, 2, W); wall(5.4, 1.85, 9, 2, W);                               // 북서 복도 벽 (통로 4~5.4)
    wall(3, 0.15, 3.15, 1.85, W);                                                     // 화장실 벽
    // 문짝들
    box(0.9, 2.1, 0.06, M.door, 1.6, 1.05, 1.95, false);          // 화장실 문 (닫힘)
    box(1.0, 2.1, 0.05, M.door, 9.7, 1.05, 4.78, false);           // 균승이 방 문 (활짝 열려 방 안쪽 벽에 붙음)
    const frontDoor = box(1.0, 2.1, 0.08, M.frontDoor, 1.7, 1.05, 10.85, false); frontDoor.name = 'frontDoor';
    box(0.04, 0.04, 0.2, M.metal, 2.1, 1.0, 10.78, false);         // 손잡이
    // 걸레받이
    for (const [x0, z0, x1, z1] of [[0.15, 10.75, 16, 10.85], [0.15, 0.15, 16, 0.25], [0.15, 0.15, 0.25, 10.85], [15.75, 0.15, 15.85, 10.85]]) box(x1 - x0, 0.1, z1 - z0, M.darkWood, (x0 + x1) / 2, 0.05, (z0 + z1) / 2, false, false);
    // 창문
    plane(2.2, 1.3, M.window, 5.5, 1.6, 0.16, 0); plane(1.8, 1.3, M.window, 15.84, 1.6, 2.2, -Math.PI / 2).rotation.set(0, -Math.PI / 2, 0);
    plane(2.0, 1.3, M.window, 15.84, 1.6, 7.5, 0).rotation.set(0, -Math.PI / 2, 0);
    // 포스터 / TV
    plane(0.6, 0.9, M.poster, 14.5, 1.6, 0.16, 0);
    plane(1.4, 0.8, M.tv, 9.16, 1.65, 2.3, 0).rotation.set(0, Math.PI / 2, 0);        // 방 벽걸이 TV (방송 화면)
    box(1.5, 0.9, 0.05, M.black, 9.18, 1.65, 2.3, false, false).rotation.set(0, Math.PI / 2, 0);

    // ---- 현관 ----
    box(0.35, 1.0, 1.2, M.darkWood, 0.33, 0.5, 10.2);                      // 신발장
    for (let i = 0; i < 4; i++) box(0.26, 0.1, 0.12, M.black, 0.8 + i * 0.3, 0.05, 10.55, false);  // 신발
    const startRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 40), M.startRing); startRing.rotation.x = -Math.PI / 2; startRing.position.set(WORLD.start.x, 0.01, WORLD.start.z); scene.add(startRing); WORLD.startRing = startRing;

    // ---- 거실 ----
    box(2.0, 0.5, 0.45, M.darkWood, 2.4, 0.25, 2.4);                       // TV장
    box(1.6, 0.9, 0.06, M.black, 2.4, 1.1, 2.3); plane(1.5, 0.82, M.tv, 2.4, 1.1, 2.34, 0);  // TV
    box(2.4, 0.45, 0.9, M.fabric, 2.4, 0.22, 6.2);                         // 소파 좌석
    box(2.4, 0.5, 0.25, M.fabric, 2.4, 0.7, 6.55, false); box(0.25, 0.35, 0.9, M.fabric, 1.3, 0.6, 6.2, false); box(0.25, 0.35, 0.9, M.fabric, 3.5, 0.6, 6.2, false);
    box(1.2, 0.42, 0.6, M.darkWood, 2.4, 0.21, 4.7);                        // 커피 테이블
    box(0.35, 1.8, 2.0, M.darkWood, 0.33, 0.9, 5.0);                        // 책장
    for (let i = 0; i < 10; i++) box(0.3, 0.26, 0.05, new THREE.MeshStandardMaterial({ color: [0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6a1b9a][i % 5] }), 0.33, 0.2 + (i % 5) * 0.34, 4.2 + Math.floor(i / 5) * 0.3 + (i % 5) * 0.12, false);
    const pot = box(0.4, 0.4, 0.4, M.pot, 0.6, 0.2, 2.6); const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), M.plant); leaves.position.set(0.6, 0.95, 2.6); leaves.castShadow = true; scene.add(leaves);
    const lamp = box(0.12, 1.6, 0.12, M.metal, 4.3, 0.8, 2.5); const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.35, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 1.2, side: THREE.DoubleSide })); shade.position.set(4.3, 1.7, 2.5); scene.add(shade);
    pointLight(0xffd9a0, 6, 4.3, 1.6, 2.5, false, 6);
    box(1.0, 0.75, 0.6, M.darkWood, 6.5, 0.37, 9.5); box(0.5, 0.06, 0.4, M.black, 6.5, 0.78, 9.5, false); // 콘솔 + 노트북

    // ---- 주방 ----
    box(0.75, 0.9, 3.8, M.white, 15.47, 0.45, 7.1); box(0.77, 0.05, 3.82, M.metal, 15.47, 0.93, 7.1, false); // 싱크대 상판
    box(0.5, 0.12, 0.6, M.black, 15.47, 1.0, 6.2, false); box(0.1, 0.3, 0.1, M.metal, 15.47, 1.1, 8.1, false); // 가스레인지, 수전
    box(0.85, 1.85, 0.8, M.fridge, 15.42, 0.93, 9.6);                                   // 냉장고
    box(1.4, 0.06, 1.0, M.darkWood, 11.7, 0.75, 8.5); for (const [dx, dz] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) box(0.08, 0.72, 0.08, M.darkWood, 11.7 + dx, 0.36, 8.5 + dz, false);
    addSolid(11.0, 8.0, 12.4, 9.0);
    for (const [cx, cz] of [[10.8, 8.5], [12.6, 8.5]]) { box(0.42, 0.45, 0.42, M.darkWood, cx, 0.22, cz); box(0.42, 0.5, 0.06, M.darkWood, cx, 0.7, cz + (cx < 11.7 ? -0.2 : 0.2), false); }
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.6, 16), M.metal); bin.position.set(14.6, 0.3, 10.4); bin.castShadow = true; scene.add(bin); addSolid(14.35, 10.15, 14.85, 10.65);
    box(1.2, 0.5, 0.35, M.white, 13.0, 2.0, 10.65, false);                                // 상부장

    // ---- 북서 복도 ----
    box(0.6, 0.85, 0.6, M.white, 3.7, 0.42, 0.5); box(0.4, 0.4, 0.02, M.black, 3.7, 0.5, 0.82, false); // 세탁기
    box(0.5, 0.4, 0.5, M.chicken, 6.5, 0.2, 0.5); box(0.5, 0.4, 0.5, M.chicken, 6.5, 0.6, 0.5, false); box(0.45, 0.4, 0.45, M.pizza, 7.3, 0.2, 0.5); // 쌓인 박스

    // ---- 균승이 방 ----
    const desk = box(1.7, 0.06, 0.7, M.darkWood, 12.5, 0.75, 2.75); addSolid(11.65, 2.4, 13.35, 3.1);
    for (const [dx, dz] of [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]]) box(0.06, 0.72, 0.06, M.metal, 12.5 + dx, 0.36, 2.75 + dz, false);
    box(0.6, 0.38, 0.03, M.black, 12.5, 1.05, 2.55, false).rotation.y = Math.PI;      // 모니터 (뒷면이 문 쪽)
    const mon = plane(0.58, 0.36, M.monitor, 12.5, 1.05, 2.53, 0); mon.rotation.set(0, Math.PI, 0);
    box(0.25, 0.04, 0.2, M.black, 12.5, 0.8, 2.9, false);                                   // 키보드
    for (let i = 0; i < 3; i++) box(0.3, 0.1, 0.25, M.chicken, 11.9 + i * 0.45, 0.83, 2.95, false); // 책상 위 치킨 박스
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03, 10, 40), M.ring); ring.position.set(12.5, 1.55, 3.55); scene.add(ring);
    box(0.05, 1.5, 0.05, M.metal, 12.5, 0.75, 3.55); addSolid(12.3, 3.35, 12.7, 3.75);   // 링라이트 삼각대
    box(0.08, 0.15, 0.02, M.black, 12.5, 1.5, 3.57, false);                                // 폰
    friend.light = pointLight(0xffffff, 9, 12.5, 1.6, 3.4, true, 9);                       // 링라이트 조명 (그림자)
    pointLight(0x7aa7ff, 2.5, 12.5, 1.2, 2.3, false, 4);                                   // 모니터 푸른 빛
    box(2.0, 0.45, 1.6, M.bedding, 14.75, 0.22, 1.2); box(0.5, 0.12, 0.6, M.pillow, 15.35, 0.5, 0.7, false); box(2.0, 0.08, 1.6, M.darkWood, 14.75, 0.02, 1.2, false, false); // 침대
    box(0.6, 2.1, 1.6, M.darkWood, 9.45, 1.05, 2.0);                                       // 옷장
    box(0.5, 0.6, 0.5, M.white, 15.55, 0.3, 4.0); box(0.3, 0.02, 0.3, M.black, 15.55, 0.61, 4.0, false); // 미니냉장고
    box(0.35, 1.5, 1.0, M.darkWood, 15.65, 0.75, 3.0); for (let i = 0; i < 6; i++) box(0.12, 0.12, 0.12, M.cup, 15.6, 0.3 + (i % 3) * 0.45, 2.65 + Math.floor(i / 3) * 0.4, false); // 라면 선반
    const chair = box(0.5, 0.45, 0.5, M.black, 12.5, 0.22, 1.9, false); box(0.5, 0.6, 0.06, M.black, 12.5, 0.75, 1.65, false);

    // ---- 조명 ----
    scene.add(new THREE.HemisphereLight(0x5a6a8a, 0x1a1410, 0.55));
    ceilingLamp(4.5, 6.5, 0xffe3b5, 16, true);      // 거실
    ceilingLamp(12.5, 8.5, 0xfff1dd, 13, false);    // 주방
    ceilingLamp(1.6, 9.6, 0xffe3b5, 5, false);      // 현관
    ceilingLamp(5.5, 1.0, 0xffe3b5, 4, false);      // 복도
    ceilingLamp(12.5, 2.5, 0xffd9a0, 3.5, false);   // 방 (어둑하게, 링라이트가 주광)

    // ---- 쓰레기 ----
    spawnTrash();

    // ---- 균승이 ----
    friend.sprite = sprite(friend.tex.idle, 1, 1, WORLD.seat.x, 1.0, WORLD.seat.z);
    setFriendSprite('idle');
    friend.slap = sprite(TEX.slap, 0.5, 0.5, 0, -10, 0); friend.stars = sprite(TEX.stars, 1.2, 0.6, 0, -10, 0);
    friend.eyes = sprite(TEX.eyes, 1.0, 0.38, 0, -10, 0); friend.exclaim = sprite(TEX.exclaim, 0.5, 0.5, 0, -10, 0);
  }

  function setFriendSprite(name) {
    const tex = friend.tex[name]; if (!tex || !friend.sprite) return;
    const img = tex.image; const aspect = img.width / img.height;
    const standing = name.startsWith('chase');
    const H = standing ? 1.82 : (name === 'idle' ? 1.0 : name === 'phone' ? 1.05 : 1.1);
    friend.sprite.material.map = tex; friend.sprite.material.needsUpdate = true;
    friend.sprite.scale.set(H * aspect, H, 1);
    friend.sprite.userData.bottom = standing ? 0 : 0.5; friend.sprite.userData.H = H;
    friend.sprite.position.y = friend.sprite.userData.bottom + H / 2;
  }

  const TRASH_KINDS = [
    { kind: 'box', make: (M) => new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 0.28), M.chicken), noise: 0.75, r: 0.3 },
    { kind: 'box', make: (M) => new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), M.pizza), noise: 0.65, r: 0.32 },
    { kind: 'can', make: (M) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.13, 12), M.can); m.rotation.z = Math.PI / 2; return m; }, noise: 1.0, r: 0.22 },
    { kind: 'bag', make: (M) => new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), M.bag), noise: 0.55, r: 0.26 },
    { kind: 'cup', make: (M) => new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.1, 10), M.cup), noise: 0.6, r: 0.22 },
  ];
  let trashMats = null;
  function spawnTrash() {
    for (const t of trash) scene.remove(t.mesh); trash.length = 0;
    if (!trashMats) trashMats = { chicken: new THREE.MeshStandardMaterial({ map: TEX.chicken }), pizza: new THREE.MeshStandardMaterial({ map: TEX.pizza }), can: new THREE.MeshStandardMaterial({ map: TEX.can, metalness: 0.6, roughness: 0.3 }), bag: new THREE.MeshStandardMaterial({ map: TEX.bag }), cup: new THREE.MeshStandardMaterial({ map: TEX.cup }) };
    const zones = [ // [x0,z0,x1,z1, weight]
      [9.4, 0.6, 15.3, 4.6, 0.45],   // 균승이 방
      [9.4, 5.3, 15.0, 10.5, 0.3],   // 주방
      [0.6, 2.4, 8.7, 10.4, 0.25],   // 거실
    ];
    const n = D().trash; let tries = 0;
    while (trash.length < n && tries++ < 2000) {
      let r = Math.random(), zone = zones[0]; for (const z of zones) { if (r < z[4]) { zone = z; break; } r -= z[4]; }
      const x = zone[0] + Math.random() * (zone[2] - zone[0]), z = zone[1] + Math.random() * (zone[3] - zone[1]);
      if (Math.hypot(x - WORLD.start.x, z - WORLD.start.z) < 1.6) continue;
      if (Math.hypot(x - WORLD.seat.x, z - WORLD.seat.z) < 1.0) continue;
      if (solids.some(s => x > s.x0 - 0.3 && x < s.x1 + 0.3 && z > s.z0 - 0.3 && z < s.z1 + 0.3)) continue;
      if (trash.some(t => Math.hypot(t.x - x, t.z - z) < 0.55)) continue;
      const def = TRASH_KINDS[Math.floor(Math.random() * TRASH_KINDS.length)];
      const mesh = def.make(trashMats); mesh.position.set(x, def.kind === 'can' ? 0.035 : def.kind === 'bag' ? 0.14 : 0.05, z); mesh.rotation.y = Math.random() * Math.PI * 2; mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh); trash.push({ mesh, x, z, kind: def.kind, noise: def.noise, r: def.r, hitT: -9 });
    }
  }

  // ======================= 내비 그리드 (균승이 길찾기) =======================
  const NAV = { cell: 0.4, cols: 40, rows: 28, blocked: null, dist: null };
  function buildNav() {
    NAV.blocked = new Uint8Array(NAV.cols * NAV.rows);
    for (let j = 0; j < NAV.rows; j++) for (let i = 0; i < NAV.cols; i++) {
      const x = (i + 0.5) * NAV.cell, z = (j + 0.5) * NAV.cell;
      NAV.blocked[j * NAV.cols + i] = solids.some(s => x > s.x0 - 0.28 && x < s.x1 + 0.28 && z > s.z0 - 0.28 && z < s.z1 + 0.28) ? 1 : 0;
    }
  }
  function cellOf(x, z) { return [Math.max(0, Math.min(NAV.cols - 1, Math.floor(x / NAV.cell))), Math.max(0, Math.min(NAV.rows - 1, Math.floor(z / NAV.cell)))]; }
  function bfs(tx, tz) { // 목표에서 거리장 계산
    const dist = new Int16Array(NAV.cols * NAV.rows).fill(-1); const [ci, cj] = cellOf(tx, tz);
    let start = cj * NAV.cols + ci;
    if (NAV.blocked[start]) { // 목표가 막힌 칸이면 가장 가까운 빈 칸
      let best = -1, bd = 1e9; for (let j = 0; j < NAV.rows; j++) for (let i = 0; i < NAV.cols; i++) { const k = j * NAV.cols + i; if (NAV.blocked[k]) continue; const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = k; } } start = best;
    }
    const q = [start]; dist[start] = 0;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % NAV.cols, j = (k / NAV.cols) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NAV.cols || nj >= NAV.rows) continue;
        const nk = nj * NAV.cols + ni; if (NAV.blocked[nk] || dist[nk] >= 0) continue; dist[nk] = dist[k] + 1; q.push(nk);
      }
    }
    return dist;
  }
  function stepAlong(dist, x, z) { // 현재 위치에서 거리장이 줄어드는 이웃 칸 중심
    const [i, j] = cellOf(x, z); const k = j * NAV.cols + i; let best = null, bd = dist[k] < 0 ? 1e9 : dist[k];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NAV.cols || nj >= NAV.rows) continue;
      const nk = nj * NAV.cols + ni; if (NAV.blocked[nk] || dist[nk] < 0) continue;
      if (di && dj && (NAV.blocked[j * NAV.cols + ni] || NAV.blocked[nj * NAV.cols + i])) continue; // 모서리 끼임 방지
      if (dist[nk] < bd) { bd = dist[nk]; best = [(ni + 0.5) * NAV.cell, (nj + 0.5) * NAV.cell]; }
    }
    return best;
  }

  // ======================= 플레이어 =======================
  const P = { x: WORLD.start.x, z: WORLD.start.z, yaw: 0, pitch: 0, speed: 0, sneak: false, run: false, stamina: 100, stepAcc: 0, bobT: 0, vx: 0, vz: 0, moved: 0 };
  const input = { f: 0, s: 0, jx: 0, jy: 0 };
  const R = 0.28;
  function collide(x, z) {
    for (const s of solids) {
      if (x + R > s.x0 && x - R < s.x1 && z + R > s.z0 && z - R < s.z1) return true;
    }
    return x - R < 0.15 || x + R > 15.85 || z - R < 0.15 || z + R > 10.85;
  }
  function movePlayer(dt) {
    let fx = input.f + input.jy, sx = input.s + input.jx;
    const len = Math.hypot(fx, sx); if (len > 1) { fx /= len; sx /= len; }
    const base = P.sneak ? 1.15 : 2.3;
    const canRun = P.run && !P.sneak && P.stamina > 0 && len > 0.1;
    const spd = canRun ? 3.7 : base;
    if (canRun) P.stamina = Math.max(0, P.stamina - 26 * dt); else P.stamina = Math.min(100, P.stamina + 13 * dt);
    const dirX = Math.sin(P.yaw), dirZ = Math.cos(P.yaw);   // yaw=0 → -z 방향
    const vx = (-dirX * fx + dirZ * sx) * spd, vz = (-dirZ * fx - dirX * sx) * spd;
    let nx = P.x + vx * dt, nz = P.z + vz * dt;
    if (!collide(nx, P.z)) P.x = nx; if (!collide(P.x, nz)) P.z = nz;
    const moved = Math.hypot(vx, vz) * dt * (len > 0.05 ? 1 : 0); P.moved = moved; P.speed = len > 0.05 ? spd : 0;
    stage.classList.toggle('walk', P.speed > 0 && !canRun); stage.classList.toggle('run', canRun);
    // 발소리
    if (P.speed > 0) {
      P.stepAcc += moved; const stride = canRun ? 0.62 : P.sneak ? 0.8 : 0.74;
      if (P.stepAcc >= stride) { P.stepAcc = 0; onStep(canRun ? 'run' : P.sneak ? 'sneak' : 'walk'); }
      P.bobT += dt * (canRun ? 11 : P.sneak ? 5 : 8);
    } else { P.stepAcc = Math.min(P.stepAcc, 0.3); }
  }
  function surfaceAt(x, z) { if (x > 9 && z > 5) return 'tile'; if (x > 0.8 && x < 4 && z > 3.9 && z < 6.1) return 'rug'; return 'wood'; }
  function onStep(kind) {
    sfxStep(kind, surfaceAt(P.x, P.z));
    addNoise(kind === 'run' ? 0.45 : kind === 'walk' ? 0.2 : 0.05);
    for (const c of creaks) if (P.x > c.x0 && P.x < c.x1 && P.z > c.z0 && P.z < c.z1 && now() - c.t > 0.9) { c.t = now(); sfxCreak(); addNoise(0.5); say('삐걱…', 700); break; }
  }
  // 쓰레기 밟기 (연속 체크)
  function checkTrash() {
    for (const t of trash) {
      if (Math.hypot(P.x - t.x, P.z - t.z) < t.r && now() - t.hitT > 1.2) {
        t.hitT = now(); sfxTrash(t.kind); addNoise(t.noise * (P.sneak ? 0.8 : 1));
        // 발로 차여 밀려남
        const ang = Math.atan2(t.z - P.z, t.x - P.x) + (Math.random() - 0.5); const d = 0.25 + Math.random() * 0.3;
        let nx = t.x + Math.cos(ang) * d, nz = t.z + Math.sin(ang) * d; if (!collide(nx, nz)) { t.x = nx; t.z = nz; }
        t.mesh.position.x = t.x; t.mesh.position.z = t.z; t.mesh.rotation.y += Math.random() * 2;
        say(t.kind === 'can' ? '땡그랑!' : t.kind === 'bag' ? '부스럭!' : '바스락!', 700);
      }
    }
  }

  // ======================= 소음 / 균승이 AI =======================
  let noiseLevel = 0;           // HUD 표시용
  function friendDist() { return Math.hypot(P.x - friend.pos.x, P.z - friend.pos.z); }
  function addNoise(v) {
    noiseLevel = Math.min(1, noiseLevel + v);
    const d = friendDist(); const heard = v * Math.max(0.15, Math.min(1, 1 - (d - 2.5) / 11));
    friend.suspicion += heard;
    if (friend.state === 'look' && playerVisible()) spotted('noise');
  }
  function playerVisible() {
    const r = WORLD.roomRect;
    if (P.x > r.x0 && P.x < r.x1 && P.z > r.z0 && P.z < r.z1) return true;
    // 문 밖 (주방) 부채꼴
    if (P.z >= 5 && P.z < 9.5 && Math.abs(P.x - WORLD.door.x) < (P.z - 5) * 0.9 + 0.5) return true;
    return false;
  }
  function setFriendHud(icon, text) { friendIcon.textContent = icon; friendText.textContent = text; }
  function friendGoto(state) {
    friend.state = state; friend.t = 0;
    if (state === 'eat') { friend.nextLook = D().lookMin + Math.random() * (D().lookMax - D().lookMin); friend.cued = false; setFriendSprite(Math.random() < 0.35 ? 'phone' : 'idle'); setFriendHud('🍗', '밥 먹는 중'); friend.sprite.material.rotation = 0; }
    if (state === 'look') { friend.lookEnd = D().lookDurMin + Math.random() * (D().lookDurMax - D().lookDurMin); setFriendSprite('look'); setFriendHud('👀', '두리번'); showOver(friend.eyes, 1.0); }
    if (state === 'hit') { setFriendSprite('hit'); setFriendHud('😵', '맞음'); }
    if (state === 'taunt') { setFriendSprite('taunt'); setFriendHud('😜', '엥마~'); }
    if (state === 'chase') { setFriendSprite('chase0'); setFriendHud('😡', '쫓아온다!'); vignette.classList.add('danger'); friend.heartT = 0; showOver(friend.exclaim, 1.2); }
    if (state === 'return') { setFriendSprite('chase0'); setFriendHud('😤', '돌아가는 중'); vignette.classList.remove('danger'); }
  }
  let overTimers = [];
  function showOver(sp, sec) { sp.userData.until = now() + sec; }
  function spotted(reason) {
    if (G.state !== 'play' || friend.state === 'chase' || friend.state === 'hit' || friend.state === 'taunt') return;
    sfxAlarm(); say(reason === 'noise' ? '뭔 소리야!!' : '딱 걸렸어!', 1200, true); setStatus('들켰다! 현관으로 도망쳐!! 🏃💨', 'alert');
    friendGoto('chase');
  }
  function updateFriend(dt) {
    friend.t += dt; friend.suspicion = Math.max(0, friend.suspicion - 0.28 * dt);
    const sp = friend.sprite;
    if (friend.state === 'eat') {
      friend.chewT -= dt; if (friend.chewT <= 0) { if (friendDist() < 9) sfxChew(); friend.chewT = 0.35 + Math.random() * 0.4; }
      // 의심 누적 → 바로 돌아봄
      if (friend.suspicion > D().suspicion && !friend.cued) { friend.nextLook = Math.min(friend.nextLook, friend.t + D().cue * 0.7); friend.suspicion = 0; }
      if (!friend.cued && friend.t >= friend.nextLook - D().cue) { friend.cued = true; sfxCue(); setFriendHud('❓', '…'); setStatus('…멈춰!', 'alert'); }
      if (friend.t >= friend.nextLook) friendGoto('look');
      sp.position.y = sp.userData.bottom + sp.userData.H / 2 + Math.sin(friend.t * 2.2) * 0.012;
    } else if (friend.state === 'look') {
      if (playerVisible() && P.moved > 0.004) spotted('seen');
      if (friend.t >= friend.lookEnd) { friendGoto('eat'); if (G.state === 'play' && !G.hit) setStatus('살금살금… 🤫'); }
    } else if (friend.state === 'hit') {
      sp.material.rotation = -0.4 * Math.sin(Math.min(1, friend.t / 0.5) * Math.PI);
      sp.position.y = sp.userData.bottom + sp.userData.H / 2 + 0.15 * Math.sin(Math.min(1, friend.t / 0.5) * Math.PI);
      if (friend.t >= 0.6) { friendGoto('taunt'); say('엥마~', 1300, true); sayEngma('hit'); }
    } else if (friend.state === 'taunt') {
      sp.material.rotation = Math.sin(friend.t * 30) * 0.05;
      if (friend.t >= 1.0) { friendGoto('chase'); setStatus('쫓아온다! 현관으로!! 🏃💨', 'alert'); }
    } else if (friend.state === 'chase' || friend.state === 'return') {
      const chasing = friend.state === 'chase';
      const tx = chasing ? P.x : WORLD.seat.x, tz = chasing ? P.z : WORLD.seat.z;
      friend.pathT -= dt; if (friend.pathT <= 0 || !friend.path) { friend.path = bfs(tx, tz); friend.pathT = 0.3; }
      const d = Math.hypot(tx - friend.pos.x, tz - friend.pos.z);
      let gx, gz;
      if (d < 1.0) { gx = tx; gz = tz; } else { const s = stepAlong(friend.path, friend.pos.x, friend.pos.z); if (s) { gx = s[0]; gz = s[1]; } else { gx = tx; gz = tz; } }
      const dx = gx - friend.pos.x, dz = gz - friend.pos.z, gl = Math.hypot(dx, dz) || 1;
      const speed = chasing ? D().chase : 1.6; const stepL = Math.min(gl, speed * dt);
      friend.pos.x += dx / gl * stepL; friend.pos.z += dz / gl * stepL;
      friend.frameT += dt; if (friend.frameT > 0.24) { friend.frameT = 0; friend.frame ^= 1; setFriendSprite('chase' + friend.frame); }
      sp.position.y = sp.userData.H / 2 + Math.abs(Math.sin(friend.t * 9)) * 0.05; sp.material.rotation = Math.sin(friend.t * 9) * 0.03;
      if (chasing) {
        friend.heartT -= dt; if (friend.heartT <= 0) { sfxHeart(); friend.heartT = Math.max(0.45, Math.min(1.2, d / 5)); }
        if (friendDist() < 0.8) caught();
        if (!G.hit && Math.hypot(P.x - WORLD.start.x, P.z - WORLD.start.z) < 0.9) { // 들켰지만 때리진 않은 채 현관 도착 → 포기하고 돌아감
          say('다음엔 각오해 😤', 1500); friendGoto('return'); setStatus('균승이가 돌아갑니다. 다시 시도!', 'good');
        }
      } else if (d < 0.3) { friend.pos.set(WORLD.seat.x, 0, WORLD.seat.z); friendGoto('eat'); if (G.state === 'play') setStatus('살금살금… 🤫'); }
    }
    sp.position.x = friend.pos.x; sp.position.z = friend.pos.z;
    // 오버레이 스프라이트들 (머리 위)
    const headY = sp.position.y + sp.userData.H / 2;
    for (const o of [friend.eyes, friend.exclaim, friend.stars]) { if (o.userData.until > now()) { o.position.set(friend.pos.x, headY + 0.25, friend.pos.z); } else o.position.y = -10; }
    if (friend.slap.userData.until > now()) { friend.slap.position.set(friend.pos.x + 0.12, sp.position.y + sp.userData.H * 0.25, friend.pos.z + 0.02); friend.slap.material.opacity = Math.min(1, (friend.slap.userData.until - now()) / 0.6); } else friend.slap.position.y = -10;
    if (friend.light) friend.light.intensity = 9 + Math.sin(now() * 40) * 0.3;
  }

  // ======================= 게임 흐름 =======================
  const G = { state: 'idle', hit: false, startT: 0, hitT: 0, endT: 0, name: '' };
  function now() { return performance.now() / 1000; }
  let bubbleTimer = 0;
  function say(text, ms = 1400, big = false) { bubble.textContent = text; bubble.classList.toggle('big', big); bubble.classList.add('on'); clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubble.classList.remove('on'), ms); }
  function setStatus(text, cls = '') { statusEl.textContent = text; statusEl.className = cls; }
  function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function fmt(t) { return t.toFixed(2) + '초'; }

  function canHit() {
    if (G.state !== 'play' || G.hit) return false;
    if (!(friend.state === 'eat' || friend.state === 'look')) return false;
    const dx = friend.pos.x - P.x, dz = friend.pos.z - P.z, d = Math.hypot(dx, dz); if (d > 1.6) return false;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw); return (fx * dx + fz * dz) / d > 0.45;
  }
  function punch() {
    if (G.state !== 'play') return;
    restartAnim(fist, 'punch');
    if (!canHit()) { sfxWhoosh(); return; }
    G.hit = true; G.hitT = now() - G.startT;
    sfxPunch(); restartAnim(stage, 'shake'); say('퍽!!', 700); addNoise(0.3);
    showOver(friend.slap, 1.4); showOver(friend.stars, 1.2);
    friendGoto('hit'); timerSub.textContent = '현관으로 돌아가!'; setStatus('때렸다! 이제 현관으로 도망!! 🏃', 'good');
    btnHit.hidden = true;
  }
  function caught() {
    if (G.state !== 'play') return;
    G.state = 'over'; G.endT = now() - G.startT;
    flash.style.opacity = .75; setTimeout(() => flash.style.opacity = 0, 200); restartAnim(stage, 'shake');
    sfxPunch(); say('엥마!!', 1800, true); sayEngma('catch'); setStatus('잡혔다… 😵', 'alert');
    vignette.classList.remove('danger'); stage.classList.remove('walk', 'run'); setFriendSprite('taunt'); friend.sprite.position.y = 0.5 + 1.1 / 2;
    setTimeout(() => showResult(false), 1600);
  }
  function escaped() {
    if (G.state !== 'play') return;
    G.state = 'over'; G.endT = now() - G.startT;
    sfxDoor(); say('탈출 성공!! 🎉', 1800, true); setStatus('현관 도착! 성공!', 'good'); vignette.classList.remove('danger'); stage.classList.remove('walk', 'run');
    const rec = { name: G.name, time: Math.round(G.endT * 100) / 100, hitTime: Math.round(G.hitT * 100) / 100, diff: diffKey, date: Date.now() };
    saveRecord(rec);
    setTimeout(() => showResult(true, rec), 1400);
  }
  function showResult(success, rec) {
    const ov = $('#overOverlay'); ov.hidden = false;
    $('#overFace').src = success ? './assets/friend_hit.png' : './assets/friend_taunt.png';
    $('#overTitle').innerHTML = success ? '균승이 <span>개패기 성공</span>' : '엥마~ <span>잡혔다</span>';
    $('#result').textContent = fmt(G.endT);
    $('#resultSub').textContent = success ? `${G.name} · ${D().label} · 때린 시각 ${fmt(G.hitT)}` : `${G.name} · ${D().label} · ${G.hit ? '때리고 도망치다가 잡힘' : '때리기도 전에 잡힘'} (기록 없음)`;
    renderRecords($('#recordTable tbody'), rec);
  }
  function startGame() {
    const nameInput = $('#playerName'); G.name = (nameInput.value || '').trim() || '익명';
    try { localStorage.setItem('engma_name', G.name); } catch (_) {}
    initAudio(); if (actx && actx.state === 'suspended') actx.resume(); startAmbient(); pickVoice();
    $('#startOverlay').hidden = true; $('#overOverlay').hidden = true; $('#recordsOverlay').hidden = true;
    // 리셋
    P.x = WORLD.start.x; P.z = WORLD.start.z; P.yaw = 0; P.pitch = 0; P.stamina = 100; P.sneak = true; btnSneak.classList.add('on');
    friend.pos.set(WORLD.seat.x, 0, WORLD.seat.z); friend.suspicion = 0; friend.path = null; friend.sprite.material.rotation = 0;
    G.state = 'play'; G.hit = false; G.startT = now(); G.hitT = 0; noiseLevel = 0;
    spawnTrash(); friendGoto('eat'); vignette.classList.remove('danger');
    timerSub.textContent = '균승이 방으로 (살금 켜짐)'; setStatus('살금살금… 🤫');
    if (document.pointerLockElement !== canvas && !('ontouchstart' in window)) { try { canvas.requestPointerLock(); } catch (_) {} }
  }

  // ======================= 기록 =======================
  const LS_KEY = 'engma_records';
  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (_) { return []; } }
  function saveLocal(list) { try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 200))); } catch (_) {} }
  let fsdb = null; // Firestore (선택)
  function initFirestore() {
    const cfg = window.ENGMA_FIREBASE; if (!cfg || !cfg.projectId) return;
    const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    load('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js').then(() => load('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js')).then(() => {
      try { const app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(cfg); fsdb = window.firebase.firestore(app); $('#recordsNote').textContent = '성공한 판만 기록됩니다. 기록은 친구들과 공유됩니다.'; } catch (e) { console.warn('firestore init failed', e); }
    }).catch(e => console.warn('firebase sdk load failed', e));
  }
  function saveRecord(rec) {
    const list = loadLocal(); list.push(rec); list.sort((a, b) => a.time - b.time); saveLocal(list);
    if (fsdb) { try { fsdb.collection('engma_records').add(rec).catch(e => console.warn('save failed', e)); } catch (_) {} }
  }
  async function fetchRecords() {
    if (fsdb) { try { const snap = await fsdb.collection('engma_records').orderBy('time').limit(50).get(); const out = []; snap.forEach(d => out.push(d.data())); if (out.length) return out; } catch (e) { console.warn('fetch failed', e); } }
    return loadLocal();
  }
  async function renderRecords(tbody, mine) {
    tbody.innerHTML = '<tr><td colspan="4">불러오는 중…</td></tr>';
    const list = (await fetchRecords()).slice(0, 15);
    tbody.innerHTML = '';
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="4">아직 기록이 없습니다. 첫 번째로 균승이를 패 보세요.</td></tr>'; return; }
    list.forEach((r, i) => {
      const tr = document.createElement('tr'); if (mine && r.date === mine.date && r.name === mine.name) tr.className = 'me';
      tr.innerHTML = `<td>${i + 1}</td><td></td><td>${(DIFF[r.diff] || DIFF.normal).label}</td><td class="num">${fmt(r.time)}</td>`;
      tr.children[1].textContent = r.name || '익명'; tbody.appendChild(tr);
    });
  }

  // ======================= 입력 =======================
  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (!e.repeat) toggleSneak(); }
    if (e.code === 'Space') { P.run = true; btnRun.classList.add('down'); e.preventDefault(); }
    if (e.code === 'KeyE' && !e.repeat) punch();
    updateKeys();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Space') { P.run = false; btnRun.classList.remove('down'); } updateKeys(); });
  function updateKeys() { input.f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0); input.s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0); }
  function toggleSneak() { P.sneak = !P.sneak; btnSneak.classList.toggle('on', P.sneak); say(P.sneak ? '🤫 살금살금' : '🚶 보통 걸음', 600); }
  btnSneak.addEventListener('click', (e) => { e.preventDefault(); toggleSneak(); });
  function bindHold(btn, on, off) {
    const down = (e) => { e.preventDefault(); btn.classList.add('down'); on(); };
    const up = (e) => { if (e) e.preventDefault(); btn.classList.remove('down'); off(); };
    btn.addEventListener('pointerdown', down); btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
  }
  bindHold(btnRun, () => P.run = true, () => P.run = false);
  btnHit.addEventListener('pointerdown', (e) => { e.preventDefault(); punch(); });
  // 조이스틱
  let joyId = null, joyCx = 0, joyCy = 0;
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; const r = joy.getBoundingClientRect(); joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2; joy.setPointerCapture(e.pointerId); moveJoy(e); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) moveJoy(e); });
  const endJoy = (e) => { if (e.pointerId === joyId) { joyId = null; input.jx = 0; input.jy = 0; knob.style.transform = ''; } };
  joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy);
  function moveJoy(e) { let dx = e.clientX - joyCx, dy = e.clientY - joyCy; const m = Math.hypot(dx, dy), max = 42; if (m > max) { dx *= max / m; dy *= max / m; } knob.style.transform = `translate(${dx}px,${dy}px)`; input.jx = dx / max; input.jy = -dy / max; }
  // 둘러보기 (캔버스 드래그 / 마우스)
  let lookId = null, lastLX = 0, lastLY = 0, lookMoved = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') { if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch (_) {} } else punch(); return; }
    if (lookId !== null) return; lookId = e.pointerId; lastLX = e.clientX; lastLY = e.clientY; lookMoved = 0; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    const dx = e.clientX - lastLX, dy = e.clientY - lastLY; lastLX = e.clientX; lastLY = e.clientY; lookMoved += Math.abs(dx) + Math.abs(dy);
    P.yaw -= dx * 0.0045; P.pitch = Math.max(-1.1, Math.min(1.1, P.pitch - dy * 0.0035));
  });
  const endLook = (e) => { if (e.pointerId === lookId) { lookId = null; if (lookMoved < 8 && canHit()) punch(); } };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
  document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { P.yaw -= e.movementX * 0.0022; P.pitch = Math.max(-1.1, Math.min(1.1, P.pitch - e.movementY * 0.0022)); } });
  $('#btnMute').addEventListener('click', (e) => { setMuted(!muted); e.currentTarget.textContent = muted ? '🔇' : '🔊'; });
  $('#diffSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; diffKey = b.dataset.diff; [...$('#diffSeg').children].forEach(c => c.classList.toggle('on', c === b)); });
  $('#btnStart').addEventListener('click', startGame);
  $('#btnRetry').addEventListener('click', startGame);
  $('#btnHome').addEventListener('click', () => { $('#overOverlay').hidden = true; $('#startOverlay').hidden = false; G.state = 'idle'; });
  $('#btnRecords').addEventListener('click', () => { $('#recordsOverlay').hidden = false; renderRecords($('#recordTable2 tbody')); });
  $('#btnRecordsClose').addEventListener('click', () => { $('#recordsOverlay').hidden = true; });
  try { $('#playerName').value = localStorage.getItem('engma_name') || ''; } catch (_) {}
  document.addEventListener('visibilitychange', () => { if (document.hidden && 'speechSynthesis' in window) speechSynthesis.cancel(); });

  // ======================= 미니맵 =======================
  function drawMinimap() {
    const s = 12; mctx.clearRect(0, 0, minimap.width, minimap.height);
    mctx.fillStyle = 'rgba(255,255,255,.08)'; mctx.fillRect(0, 0, 16 * s, 11 * s);
    mctx.fillStyle = 'rgba(255,255,255,.35)'; for (const w of solids) { const ww = (w.x1 - w.x0), hh = (w.z1 - w.z0); if (ww < 0.2 || hh < 0.2) mctx.fillRect(w.x0 * s, w.z0 * s, Math.max(2, ww * s), Math.max(2, hh * s)); }
    mctx.fillStyle = '#ffd33d'; mctx.beginPath(); mctx.arc(WORLD.start.x * s, WORLD.start.z * s, 4, 0, 7); mctx.fill();
    mctx.fillStyle = friend.state === 'chase' ? '#ff3b3b' : '#ff9800'; mctx.beginPath(); mctx.arc(friend.pos.x * s, friend.pos.z * s, 4, 0, 7); mctx.fill();
    mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(P.x * s, P.z * s, 3.5, 0, 7); mctx.fill();
    mctx.strokeStyle = '#fff'; mctx.beginPath(); mctx.moveTo(P.x * s, P.z * s); mctx.lineTo((P.x - Math.sin(P.yaw) * 0.8) * s, (P.z - Math.cos(P.yaw) * 0.8) * s); mctx.stroke();
  }

  // ======================= 루프 =======================
  let last = 0, frame = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts; frame++;
    if (G.state === 'play') {
      movePlayer(dt); checkTrash(); updateFriend(dt);
      if (G.hit && Math.hypot(P.x - WORLD.start.x, P.z - WORLD.start.z) < 0.9) escaped();
      const el = now() - G.startT; timerEl.firstChild.nodeValue = el.toFixed(2);
      btnHit.hidden = !canHit();
      if (frame % 3 === 0) {
        noiseBar.style.width = (noiseLevel * 100) + '%'; stamBar.style.width = P.stamina + '%'; stamText.textContent = Math.round(P.stamina) + '%';
        noiseText.textContent = noiseLevel < 0.15 ? '조용함' : noiseLevel < 0.5 ? '소리 남' : '시끄러움!'; drawMinimap();
      }
    } else if (G.state === 'over') { updateFriend(dt); }
    noiseLevel = Math.max(0, noiseLevel - 0.9 * dt);
    // 카메라
    const bobY = P.speed > 0 ? Math.sin(P.bobT) * (P.sneak ? 0.015 : 0.035) : 0, bobX = P.speed > 0 ? Math.cos(P.bobT * 0.5) * 0.012 : 0;
    camera.position.set(P.x + bobX, (P.sneak ? 1.38 : 1.58) + bobY, P.z);
    camera.rotation.set(0, 0, 0); camera.rotateY(P.yaw); camera.rotateX(P.pitch);
    WORLD.startRing.material.opacity = 0.35 + Math.sin(ts / 300) * 0.2; WORLD.startRing.scale.setScalar(G.hit ? 1.3 + Math.sin(ts / 200) * 0.1 : 1);
    renderer.render(scene, camera);
  }

  // ======================= 초기화 =======================
  function loadTextures() {
    const loader = new THREE.TextureLoader(); const names = { idle: 'friend_idle', phone: 'friend_phone', look: 'friend_look', hit: 'friend_hit', taunt: 'friend_taunt', chase0: 'friend_chase0', chase1: 'friend_chase1' };
    return Promise.all(Object.entries(names).map(([k, f]) => new Promise((res) => loader.load(`./assets/${f}.png`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; friend.tex[k] = t; res(); }, undefined, () => { console.warn('texture missing', f); res(); }))));
  }
  async function init() {
    const loading = $('#loading');
    if (!window.THREE) { loading.textContent = '3D 엔진을 불러오지 못했습니다 (vendor/three.min.js).'; return; }
    loading.textContent = '집 짓는 중…';
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
    const resize = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    window.addEventListener('resize', resize);
    buildTextures(); await loadTextures();
    if (!friend.tex.idle) { // 사진이 없으면 임시 스프라이트
      friend.tex.idle = friend.tex.phone = friend.tex.look = friend.tex.hit = friend.tex.taunt = friend.tex.chase0 = friend.tex.chase1 = makeTex(256, 512, (ctx, w, h) => { ctx.fillStyle = '#f3c9a6'; ctx.beginPath(); ctx.arc(128, 110, 80, 0, 7); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(40, 190, 176, 300); });
    }
    buildWorld(); buildNav(); resize(); initFirestore();
    camera.position.set(WORLD.start.x, 1.58, WORLD.start.z);
    loading.textContent = ''; requestAnimationFrame(loop);
    if (location.hash.includes('debug')) window.__engma = { P, G, friend, WORLD, punch, startGame, solids, trash, setStatus, bfs, stepAlong, NAV, now: () => now() - G.startT };
  }
  init();
})();
