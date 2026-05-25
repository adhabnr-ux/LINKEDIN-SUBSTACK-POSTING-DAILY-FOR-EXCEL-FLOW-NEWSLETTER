// Stick Brawler — original 2D stickman fighter
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('start-btn');
  const hpFill = document.getElementById('hp-fill');
  const stamFill = document.getElementById('stam-fill');
  const waveEl = document.getElementById('wave');
  const scoreEl = document.getElementById('score');
  const messageEl = document.getElementById('message');

  // ----- Canvas sizing -----
  const VIEW = { w: 0, h: 0, scale: 1 };
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    VIEW.w = window.innerWidth;
    VIEW.h = window.innerHeight;
    canvas.width = VIEW.w * dpr;
    canvas.height = VIEW.h * dpr;
    canvas.style.width = VIEW.w + 'px';
    canvas.style.height = VIEW.h + 'px';
    VIEW.scale = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ----- Audio (WebAudio synth, no external assets) -----
  let audioCtx = null;
  function ac() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
  function blip(freq, dur = 0.08, type = 'square', gain = 0.06) {
    try {
      const c = ac();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), c.currentTime + dur);
      g.gain.setValueAtTime(gain, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur);
    } catch (e) {}
  }
  const SFX = {
    punch: () => blip(220, 0.07, 'square', 0.08),
    kick:  () => blip(140, 0.10, 'sawtooth', 0.09),
    hit:   () => blip(90, 0.12, 'square', 0.12),
    block: () => blip(440, 0.05, 'triangle', 0.06),
    jump:  () => blip(520, 0.08, 'triangle', 0.05),
    dash:  () => blip(680, 0.06, 'sine', 0.05),
    ko:    () => { blip(180, 0.18, 'sawtooth', 0.12); setTimeout(() => blip(90, 0.22, 'square', 0.12), 90); },
    wave:  () => { blip(660, 0.1, 'triangle', 0.08); setTimeout(() => blip(880, 0.15, 'triangle', 0.08), 110); },
  };

  // ----- Input -----
  const keys = new Set();
  const keyMap = {
    'KeyA': 'left', 'ArrowLeft': 'left',
    'KeyD': 'right', 'ArrowRight': 'right',
    'KeyW': 'jump', 'ArrowUp': 'jump', 'Space': 'jump',
    'KeyJ': 'punch',
    'KeyK': 'kick',
    'KeyL': 'block', 'ArrowDown': 'block',
    'ShiftLeft': 'dash', 'ShiftRight': 'dash',
  };
  const pressed = { left:false, right:false, jump:false, punch:false, kick:false, block:false, dash:false };
  const justPressed = { jump:false, punch:false, kick:false, dash:false };

  window.addEventListener('keydown', e => {
    const a = keyMap[e.code]; if (!a) return;
    if (!pressed[a]) justPressed[a] = true;
    pressed[a] = true;
    keys.add(e.code);
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    const a = keyMap[e.code]; if (!a) return;
    pressed[a] = false;
    keys.delete(e.code);
  });

  // Touch buttons
  document.querySelectorAll('#touch-controls .btn').forEach(btn => {
    const key = btn.dataset.key;
    const a = keyMap[key];
    const down = (e) => {
      e.preventDefault();
      if (!pressed[a]) justPressed[a] = true;
      pressed[a] = true;
      btn.classList.add('pressed');
    };
    const up = (e) => {
      e.preventDefault();
      pressed[a] = false;
      btn.classList.remove('pressed');
    };
    btn.addEventListener('touchstart', down, { passive:false });
    btn.addEventListener('touchend', up);
    btn.addEventListener('touchcancel', up);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
  });

  // ----- World -----
  const world = {
    groundY: () => VIEW.h - 80,
    gravity: 1800,
    friction: 0.82,
  };

  // ----- Entities -----
  class Fighter {
    constructor(opts) {
      this.x = opts.x;
      this.y = world.groundY();
      this.vx = 0;
      this.vy = 0;
      this.facing = opts.facing || 1;
      this.hp = opts.hp ?? 100;
      this.maxHp = this.hp;
      this.stam = 100;
      this.maxStam = 100;
      this.height = opts.height || 96;
      this.speed = opts.speed || 220;
      this.color = opts.color || '#e6edf3';
      this.isPlayer = !!opts.isPlayer;
      this.type = opts.type || 'thug';
      this.state = 'idle'; // idle, walk, jump, punch, kick, block, hit, ko
      this.stateTimer = 0;
      this.attackDamage = opts.damage || 8;
      this.attackReach = opts.reach || 56;
      this.attackArc = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.hitCooldown = 0;
      this.blockHeld = false;
      this.dashCd = 0;
      this.invuln = 0;
      this.knockback = 0;
      this.ai = opts.ai || null;
      this.aiTimer = 0;
      this.dead = false;
      this.bobPhase = Math.random() * Math.PI * 2;
    }

    get grounded() { return this.y >= world.groundY() - 0.01 && this.vy >= 0; }

    canAct() { return !this.dead && this.state !== 'hit' && this.state !== 'ko' && this.stateTimer <= 0; }

    startAttack(kind) {
      if (!this.canAct()) return false;
      const cost = kind === 'kick' ? 18 : 12;
      if (this.stam < cost) return false;
      this.stam -= cost;
      this.state = kind;
      this.stateTimer = kind === 'kick' ? 0.32 : 0.22;
      this.attackArc = 0;
      this.hasHitThisAttack = false;
      if (this.isPlayer) (kind === 'kick' ? SFX.kick : SFX.punch)();
      return true;
    }

    block(active) {
      if (this.dead) return;
      this.blockHeld = active && this.grounded;
      if (this.blockHeld && this.state !== 'block') {
        this.state = 'block';
        this.stateTimer = 0;
      } else if (!this.blockHeld && this.state === 'block') {
        this.state = 'idle';
      }
    }

    dash() {
      if (this.dashCd > 0 || !this.grounded || !this.canAct() || this.stam < 25) return;
      this.dashCd = 0.6;
      this.stam -= 25;
      this.invuln = 0.18;
      this.vx = 620 * this.facing;
      if (this.isPlayer) SFX.dash();
    }

    jump() {
      if (!this.grounded || !this.canAct()) return;
      this.vy = -720;
      this.state = 'jump';
      if (this.isPlayer) SFX.jump();
    }

    takeHit(damage, fromX, attacker) {
      if (this.dead || this.invuln > 0) return;
      const dir = this.x < fromX ? -1 : 1;
      // Block reduces damage and prevents stagger
      if (this.state === 'block' && Math.sign(fromX - this.x) === this.facing) {
        this.hp -= damage * 0.2;
        this.knockback = 90 * dir;
        this.invuln = 0.15;
        SFX.block();
        spawnSparks(this.x + 24 * -dir, this.y - this.height * 0.6, dir, '#4bd1ff');
        return;
      }
      this.hp -= damage;
      this.invuln = 0.25;
      this.state = 'hit';
      this.stateTimer = 0.22;
      this.vx = 260 * dir;
      this.vy = -180;
      this.combo = 0;
      spawnSparks(this.x, this.y - this.height * 0.6, dir, '#ff4b5c');
      if (this.isPlayer) SFX.hit();
      else SFX.hit();
      if (attacker && attacker.isPlayer) {
        attacker.combo++;
        attacker.comboTimer = 1.4;
        addScore(10 + attacker.combo * 4);
      }
      if (this.hp <= 0) this.die();
    }

    die() {
      this.hp = 0;
      this.dead = true;
      this.state = 'ko';
      this.vy = -260;
      this.vx = (this.x < (player ? player.x : 0) ? -1 : 1) * 120;
      SFX.ko();
      if (!this.isPlayer) addScore(50);
    }

    update(dt) {
      // Timers
      this.stateTimer = Math.max(0, this.stateTimer - dt);
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.invuln = Math.max(0, this.invuln - dt);
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer <= 0) this.combo = 0;
      this.bobPhase += dt * 6;

      // Stamina regen
      if (!this.dead) this.stam = Math.min(this.maxStam, this.stam + dt * (this.state === 'block' ? 10 : 22));

      // AI
      if (this.ai) this.runAI(dt);

      // Apply movement intentions only if able to control
      if (this.canAct() && !this.dead) {
        const wantsLeft = this.isPlayer ? pressed.left : this.aiMove === -1;
        const wantsRight = this.isPlayer ? pressed.right : this.aiMove === 1;
        if (this.state !== 'block') {
          if (wantsLeft && !wantsRight) { this.vx = -this.speed; this.facing = -1; }
          else if (wantsRight && !wantsLeft) { this.vx = this.speed; this.facing = 1; }
          else if (this.grounded) { this.vx *= world.friction; if (Math.abs(this.vx) < 8) this.vx = 0; }
          if (this.grounded) {
            if (Math.abs(this.vx) > 20) this.state = 'walk';
            else this.state = 'idle';
          }
        } else {
          this.vx *= 0.4;
        }
      }

      // Gravity
      this.vy += world.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.knockback) {
        this.x += this.knockback * dt;
        this.knockback *= 0.9;
        if (Math.abs(this.knockback) < 4) this.knockback = 0;
      }

      // Ground clamp
      if (this.y >= world.groundY()) {
        this.y = world.groundY();
        this.vy = 0;
        if (this.state === 'jump') this.state = 'idle';
        if (this.state === 'hit' && this.stateTimer <= 0 && !this.dead) this.state = 'idle';
        if (this.dead && Math.abs(this.vx) < 5) { /* stay down */ }
      }

      // Bounds
      this.x = Math.max(40, Math.min(VIEW.w - 40, this.x));

      // Attack hit detection
      if ((this.state === 'punch' || this.state === 'kick') && !this.hasHitThisAttack) {
        const tProgress = 1 - (this.stateTimer / (this.state === 'kick' ? 0.32 : 0.22));
        this.attackArc = tProgress;
        if (tProgress > 0.25 && tProgress < 0.75) {
          const reach = this.state === 'kick' ? this.attackReach + 14 : this.attackReach;
          const hx = this.x + this.facing * reach * 0.6;
          for (const e of entities) {
            if (e === this || e.dead || e.invuln > 0) continue;
            // Only hit opposing side
            if (e.isPlayer === this.isPlayer) continue;
            const dx = e.x - this.x;
            if (Math.sign(dx) !== this.facing && Math.abs(dx) > 10) continue;
            if (Math.abs(e.x - hx) < 38 && Math.abs(e.y - this.y) < this.height) {
              e.takeHit(this.state === 'kick' ? this.attackDamage + 4 : this.attackDamage, this.x, this);
              this.hasHitThisAttack = true;
              shake(6, 0.18);
              break;
            }
          }
        }
      }
    }

    runAI(dt) {
      this.aiTimer -= dt;
      this.aiMove = 0;
      if (!player || player.dead) return;
      const dx = player.x - this.x;
      const dist = Math.abs(dx);
      this.facing = dx >= 0 ? 1 : -1;

      if (this.dead) return;

      // Maintain attack range
      const desired = 52;
      if (dist > desired + 16) this.aiMove = Math.sign(dx);
      else if (dist < desired - 16) this.aiMove = -Math.sign(dx);

      // Random aggression
      if (this.aiTimer <= 0 && this.canAct()) {
        this.aiTimer = 0.5 + Math.random() * 0.8;
        if (dist < 70) {
          const r = Math.random();
          if (r < 0.55) this.startAttack('punch');
          else if (r < 0.8) this.startAttack('kick');
          else if (r < 0.92 && this.grounded) this.jump();
        } else if (dist > 200 && Math.random() < 0.25) {
          this.dash();
        }
      }
    }

    draw() {
      const x = Math.round(this.x);
      const y = Math.round(this.y);
      const c = ctx;
      c.save();
      c.translate(x, y);
      c.scale(this.facing, 1);
      if (this.invuln > 0 && Math.floor(this.invuln * 24) % 2 === 0) c.globalAlpha = 0.55;

      drawStick(c, this);
      c.restore();

      // shadow
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, world.groundY() + 4, 26, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ----- Stickman rendering -----
  function drawStick(c, f) {
    const col = f.dead ? '#7a8492' : f.color;
    c.lineWidth = 4.5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = col;
    c.fillStyle = col;

    const H = f.height;
    const bob = f.grounded && (f.state === 'walk') ? Math.sin(f.bobPhase) * 2.5 : 0;

    // Body anchor points (drawn in local space, facing right)
    const hipY = -H * 0.45 + bob;
    const headY = -H + bob;
    const headR = 11;

    // Stance offsets
    let leftLegA = 0, rightLegA = 0;
    let leftArmA = 0, rightArmA = 0;
    let torsoLean = 0;

    if (f.state === 'walk') {
      leftLegA = Math.sin(f.bobPhase) * 0.45;
      rightLegA = -leftLegA;
      leftArmA = -leftLegA * 0.6;
      rightArmA = -rightLegA * 0.6;
    } else if (f.state === 'jump' || !f.grounded) {
      leftLegA = -0.4; rightLegA = 0.4;
      leftArmA = -1.0; rightArmA = -1.2;
    } else if (f.state === 'block') {
      torsoLean = -0.1;
      leftArmA = -1.4; rightArmA = -1.2;
    } else if (f.state === 'hit') {
      torsoLean = -0.3 + Math.sin(f.bobPhase * 3) * 0.05;
      leftArmA = 1.2; rightArmA = 1.4;
    } else if (f.state === 'ko') {
      torsoLean = -1.4;
      leftArmA = 1.6; rightArmA = 1.5;
      leftLegA = 0.7; rightLegA = -0.4;
    }

    // Punch/Kick override one arm/leg
    let punchExt = 0, kickExt = 0;
    if (f.state === 'punch') {
      const t = f.attackArc;
      punchExt = Math.sin(Math.min(1, t) * Math.PI) * 28;
      rightArmA = -1.55;
    }
    if (f.state === 'kick') {
      const t = f.attackArc;
      kickExt = Math.sin(Math.min(1, t) * Math.PI) * 32;
      rightLegA = -1.0;
    }

    // Torso
    const torsoTopX = Math.sin(torsoLean) * 8;
    const torsoTopY = hipY - H * 0.35 + Math.cos(torsoLean) * (-2);
    c.beginPath();
    c.moveTo(0, hipY);
    c.lineTo(torsoTopX, torsoTopY);
    c.stroke();

    // Head
    c.beginPath();
    c.arc(torsoTopX, headY + 6, headR, 0, Math.PI * 2);
    c.stroke();

    // Face hint (eye)
    if (!f.dead) {
      c.beginPath();
      c.fillStyle = col;
      c.arc(torsoTopX + 4, headY + 4, 1.6, 0, Math.PI * 2);
      c.fill();
    }

    // Arms (from shoulder near torso top)
    const shoulderY = torsoTopY + 6;
    drawLimb(c, torsoTopX, shoulderY, leftArmA - 1.2, H * 0.32, 0);
    drawLimb(c, torsoTopX, shoulderY, rightArmA - 1.2, H * 0.32 + punchExt, 0);

    // Legs from hip
    drawLimb(c, 0, hipY, leftLegA + 1.55, H * 0.45, 0);
    drawLimb(c, 0, hipY, rightLegA + 1.55, H * 0.45 + kickExt, 0);

    // Weapon glow on combo
    if (f.isPlayer && f.combo >= 3 && (f.state === 'punch' || f.state === 'kick')) {
      c.save();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#ffd86b';
      c.lineWidth = 8;
      c.beginPath();
      c.arc(0, hipY - H * 0.2, 22 + f.combo * 2, -0.6, 0.6);
      c.stroke();
      c.restore();
    }
  }

  function drawLimb(c, x, y, angle, length, bendBias) {
    // Simple straight line limb; angle is measured from upward direction in local space
    const dx = Math.sin(angle) * length;
    const dy = Math.cos(angle) * length;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + dx, y + dy);
    c.stroke();
  }

  // ----- Particles -----
  const particles = [];
  function spawnSparks(x, y, dir, color) {
    for (let i = 0; i < 10; i++) {
      particles.push({
        x, y,
        vx: (Math.random() * 200 + 80) * dir + (Math.random() - 0.5) * 80,
        vy: -Math.random() * 240 - 40,
        life: 0.35 + Math.random() * 0.25,
        max: 0.6,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 800 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ----- Camera shake -----
  let shakeAmt = 0, shakeTime = 0;
  function shake(a, t) { shakeAmt = Math.max(shakeAmt, a); shakeTime = Math.max(shakeTime, t); }

  // ----- Score / Wave -----
  let score = 0;
  let wave = 1;
  let waveInProgress = false;
  function addScore(n) { score += n; scoreEl.textContent = score; }
  function setWave(n) { wave = n; waveEl.textContent = wave; }
  function setMessage(text, ms = 1400) {
    messageEl.textContent = text;
    messageEl.classList.add('show');
    clearTimeout(messageEl._t);
    messageEl._t = setTimeout(() => messageEl.classList.remove('show'), ms);
  }

  // ----- Entities -----
  const entities = [];
  let player = null;

  function startGame() {
    entities.length = 0;
    particles.length = 0;
    score = 0; addScore(0);
    setWave(1);
    player = new Fighter({
      x: VIEW.w * 0.3,
      isPlayer: true,
      color: '#e6edf3',
      hp: 120,
      speed: 280,
      damage: 12,
      reach: 60,
    });
    entities.push(player);
    waveInProgress = false;
    overlay.classList.remove('active');
    setMessage('WAVE 1', 1000);
    SFX.wave();
    spawnWave(1);
  }

  function spawnWave(n) {
    waveInProgress = true;
    const count = Math.min(2 + n, 6);
    for (let i = 0; i < count; i++) {
      const fromLeft = Math.random() < 0.5;
      const baseHp = 30 + n * 8;
      const enemy = new Fighter({
        x: fromLeft ? -40 - i * 50 : VIEW.w + 40 + i * 50,
        facing: fromLeft ? 1 : -1,
        isPlayer: false,
        color: pickEnemyColor(n),
        hp: baseHp,
        speed: 130 + Math.min(80, n * 8),
        damage: 6 + Math.min(10, Math.floor(n / 2)),
        reach: 52,
        ai: true,
        type: 'thug',
      });
      entities.push(enemy);
    }
  }
  function pickEnemyColor(n) {
    const palette = ['#ff4b5c', '#ffb04b', '#9a6bff', '#4bd1ff', '#6effae'];
    return palette[(n - 1) % palette.length];
  }

  function checkWaveEnd() {
    if (!waveInProgress) return;
    const enemiesLeft = entities.some(e => !e.isPlayer && !e.dead);
    if (!enemiesLeft) {
      waveInProgress = false;
      setMessage(`WAVE ${wave} CLEAR`, 1200);
      addScore(100 + wave * 25);
      setTimeout(() => {
        if (player.dead) return;
        setWave(wave + 1);
        // Heal a little between waves
        player.hp = Math.min(player.maxHp, player.hp + 25);
        SFX.wave();
        setMessage(`WAVE ${wave}`, 900);
        setTimeout(() => spawnWave(wave), 700);
      }, 1500);
    }
  }

  function gameOver() {
    overlay.classList.add('active');
    overlay.querySelector('.card').innerHTML = `
      <h1>DEFEATED</h1>
      <p class="tag">You reached wave ${wave}</p>
      <p style="font-size:32px;color:#ffd86b;font-weight:800;margin:18px 0;">${score}</p>
      <button id="start-btn">RETRY</button>
    `;
    document.getElementById('start-btn').addEventListener('click', startGame);
  }

  // ----- Background -----
  function drawBackground() {
    // Distant city silhouette
    const gy = world.groundY();
    ctx.fillStyle = '#0e1320';
    ctx.fillRect(0, gy - 220, VIEW.w, 220);

    // Buildings (deterministic-ish based on width)
    const seed = 1234;
    let x = 0;
    let i = 0;
    while (x < VIEW.w + 60) {
      const w = 40 + ((seed * (i + 1)) % 60);
      const h = 80 + ((seed * (i + 3)) % 140);
      ctx.fillStyle = i % 2 === 0 ? '#161e2f' : '#1a2440';
      ctx.fillRect(x, gy - h, w, h);
      // windows
      ctx.fillStyle = '#3a4a7a';
      for (let wy = gy - h + 12; wy < gy - 8; wy += 14) {
        for (let wx = x + 6; wx < x + w - 6; wx += 12) {
          if ((wx + wy + i) % 3 === 0) ctx.fillRect(wx, wy, 4, 5);
        }
      }
      x += w + 4;
      i++;
    }

    // Ground
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, gy, VIEW.w, VIEW.h - gy);
    // Ground line
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(VIEW.w, gy + 0.5);
    ctx.stroke();

    // Stars
    ctx.fillStyle = '#ffffff55';
    for (let s = 0; s < 50; s++) {
      const sx = (s * 137) % VIEW.w;
      const sy = (s * 53) % (gy - 240);
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  // ----- Main loop -----
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    // Handle one-shot inputs
    if (player && !player.dead) {
      if (justPressed.jump) player.jump();
      if (justPressed.punch) player.startAttack('punch');
      if (justPressed.kick) player.startAttack('kick');
      if (justPressed.dash) player.dash();
      player.block(pressed.block);
    }
    for (const k in justPressed) justPressed[k] = false;

    // Update
    for (const e of entities) e.update(dt);
    // Remove fully dead enemies after delay
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.dead && !e.isPlayer) {
        e.deadTimer = (e.deadTimer || 0) + dt;
        if (e.deadTimer > 1.8) entities.splice(i, 1);
      }
    }

    updateParticles(dt);
    checkWaveEnd();

    if (player && player.dead && !overlay.classList.contains('active')) {
      player.deadTimer = (player.deadTimer || 0) + dt;
      if (player.deadTimer > 1.6) gameOver();
    }

    // Shake
    let sx = 0, sy = 0;
    if (shakeTime > 0) {
      shakeTime -= dt;
      sx = (Math.random() - 0.5) * shakeAmt;
      sy = (Math.random() - 0.5) * shakeAmt;
      shakeAmt *= 0.9;
      if (shakeTime <= 0) shakeAmt = 0;
    }

    // Draw
    ctx.clearRect(0, 0, VIEW.w, VIEW.h);
    ctx.save();
    ctx.translate(sx, sy);
    drawBackground();
    // Draw entities sorted by y for layering
    const order = [...entities].sort((a, b) => a.y - b.y);
    for (const e of order) e.draw();
    drawParticles();
    ctx.restore();

    // HUD
    if (player) {
      hpFill.style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
      stamFill.style.width = Math.max(0, (player.stam / player.maxStam) * 100) + '%';
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Start
  startBtn.addEventListener('click', () => {
    ac(); // unlock audio
    startGame();
  });

  // Replace start button binding on retry overlays
  overlay.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'start-btn') startGame();
  });
})();
