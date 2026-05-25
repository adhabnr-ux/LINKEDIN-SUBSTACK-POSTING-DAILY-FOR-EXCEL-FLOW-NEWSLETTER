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
    sword: () => { blip(880, 0.06, 'triangle', 0.07); setTimeout(() => blip(440, 0.08, 'sawtooth', 0.06), 30); },
    hit:   () => blip(90, 0.12, 'square', 0.12),
    block: () => blip(440, 0.05, 'triangle', 0.06),
    jump:  () => blip(520, 0.08, 'triangle', 0.05),
    dash:  () => blip(680, 0.06, 'sine', 0.05),
    pickup:() => { blip(720, 0.06, 'triangle', 0.08); setTimeout(() => blip(960, 0.1, 'triangle', 0.07), 60); },
    heal:  () => { blip(520, 0.08, 'sine', 0.08); setTimeout(() => blip(780, 0.12, 'sine', 0.07), 80); },
    ko:    () => { blip(180, 0.18, 'sawtooth', 0.12); setTimeout(() => blip(90, 0.22, 'square', 0.12), 90); },
    wave:  () => { blip(660, 0.1, 'triangle', 0.08); setTimeout(() => blip(880, 0.15, 'triangle', 0.08), 110); },
    boss:  () => { blip(110, 0.3, 'sawtooth', 0.14); setTimeout(() => blip(80, 0.4, 'square', 0.14), 150); },
  };

  const pressed = { left:false, right:false, jump:false, punch:false, kick:false, block:false, dash:false };
  const justPressed = { jump:false, punch:false, kick:false, dash:false };
  const keyMap = {
    'KeyA': 'left', 'ArrowLeft': 'left',
    'KeyD': 'right', 'ArrowRight': 'right',
    'KeyW': 'jump', 'ArrowUp': 'jump', 'Space': 'jump',
    'KeyJ': 'punch',
    'KeyK': 'kick',
    'KeyL': 'block', 'ArrowDown': 'block',
    'ShiftLeft': 'dash', 'ShiftRight': 'dash',
  };
  window.addEventListener('keydown', e => {
    const a = keyMap[e.code]; if (!a) return;
    if (!pressed[a]) justPressed[a] = true;
    pressed[a] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    const a = keyMap[e.code]; if (!a) return;
    pressed[a] = false;
  });
  document.querySelectorAll('#touch-controls .btn').forEach(btn => {
    const key = btn.dataset.key;
    const a = keyMap[key];
    const down = (e) => { e.preventDefault(); if (!pressed[a]) justPressed[a] = true; pressed[a] = true; btn.classList.add('pressed'); };
    const up   = (e) => { e.preventDefault(); pressed[a] = false; btn.classList.remove('pressed'); };
    btn.addEventListener('touchstart', down, { passive:false });
    btn.addEventListener('touchend', up);
    btn.addEventListener('touchcancel', up);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
  });

  const world = {
    groundY: () => VIEW.h - 80,
    gravity: 1800,
    friction: 0.82,
  };

  // ----- Pickups -----
  const pickups = [];
  function spawnPickup(x, kind) {
    pickups.push({
      x, y: world.groundY() - 16,
      vy: -300, vx: (Math.random() - 0.5) * 120,
      kind, // 'heart' | 'sword'
      grounded: false,
      life: 12,
      bob: 0,
    });
  }
  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.life -= dt;
      p.bob += dt * 4;
      if (!p.grounded) {
        p.vy += world.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y >= world.groundY() - 16) {
          p.y = world.groundY() - 16;
          p.vy = 0; p.vx = 0;
          p.grounded = true;
        }
      }
      if (p.life <= 0) { pickups.splice(i, 1); continue; }
      if (player && !player.dead) {
        if (Math.abs(p.x - player.x) < 36 && Math.abs(p.y - (player.y - player.height * 0.4)) < 60) {
          if (p.kind === 'heart') {
            player.hp = Math.min(player.maxHp, player.hp + 30);
            SFX.heal();
          } else if (p.kind === 'sword') {
            player.weapon = { kind: 'sword', dur: 18 };
            SFX.pickup();
          }
          pickups.splice(i, 1);
        }
      }
    }
  }
  function drawPickups() {
    for (const p of pickups) {
      const blink = p.life < 3 && Math.floor(p.life * 8) % 2 === 0;
      if (blink) continue;
      const yy = p.y + (p.grounded ? Math.sin(p.bob) * 3 : 0);
      ctx.save();
      ctx.translate(p.x, yy);
      if (p.kind === 'heart') {
        ctx.fillStyle = '#ff4b6e';
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.bezierCurveTo(12, -6, 6, -14, 0, -6);
        ctx.bezierCurveTo(-6, -14, -12, -6, 0, 6);
        ctx.fill();
        ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1; ctx.stroke();
      } else if (p.kind === 'sword') {
        ctx.strokeStyle = '#dfe7f5'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(14, 0); ctx.stroke();
        ctx.strokeStyle = '#7a8492'; ctx.beginPath();
        ctx.moveTo(-14, -6); ctx.lineTo(-14, 6); ctx.stroke();
        ctx.fillStyle = '#5a4429';
        ctx.fillRect(-18, -2, 6, 4);
      }
      ctx.restore();
    }
  }

  // ----- Fighter -----
  class Fighter {
    constructor(opts) {
      this.x = opts.x;
      this.y = world.groundY();
      this.vx = 0; this.vy = 0;
      this.facing = opts.facing || 1;
      this.hp = opts.hp ?? 100;
      this.maxHp = this.hp;
      this.stam = 100; this.maxStam = 100;
      this.height = opts.height || 96;
      this.speed = opts.speed || 220;
      this.color = opts.color || '#e6edf3';
      this.isPlayer = !!opts.isPlayer;
      this.type = opts.type || 'thug';
      this.boss = !!opts.boss;
      this.state = 'idle';
      this.stateTimer = 0;
      this.attackDamage = opts.damage || 8;
      this.attackReach = opts.reach || 56;
      this.attackArc = 0;
      this.combo = 0; this.comboTimer = 0;
      this.dashCd = 0; this.invuln = 0;
      this.knockback = 0;
      this.ai = opts.ai || null;
      this.aiTimer = 0;
      this.dead = false;
      this.bobPhase = Math.random() * Math.PI * 2;
      this.weapon = opts.weapon || null;
      this.dropChance = opts.dropChance ?? 0.18;
    }

    get grounded() { return this.y >= world.groundY() - 0.01 && this.vy >= 0; }
    canAct() { return !this.dead && this.state !== 'hit' && this.state !== 'ko' && this.stateTimer <= 0; }

    startAttack(kind) {
      if (!this.canAct()) return false;
      const cost = kind === 'kick' ? 18 : 12;
      if (this.stam < cost) return false;
      this.stam -= cost;
      this.state = kind;
      const hasSword = this.weapon && this.weapon.kind === 'sword';
      this.stateTimer = kind === 'kick' ? 0.32 : (hasSword ? 0.28 : 0.22);
      this.attackArc = 0;
      this.hasHitThisAttack = false;
      if (this.isPlayer) {
        if (hasSword && kind === 'punch') SFX.sword();
        else if (kind === 'kick') SFX.kick();
        else SFX.punch();
      }
      return true;
    }
    block(active) {
      if (this.dead) return;
      this.blockHeld = active && this.grounded;
      if (this.blockHeld && this.state !== 'block') { this.state = 'block'; this.stateTimer = 0; }
      else if (!this.blockHeld && this.state === 'block') this.state = 'idle';
    }
    dash() {
      if (this.dashCd > 0 || !this.grounded || !this.canAct() || this.stam < 25) return;
      this.dashCd = 0.6; this.stam -= 25; this.invuln = 0.18;
      this.vx = 620 * this.facing;
      if (this.isPlayer) SFX.dash();
    }
    jump() {
      if (!this.grounded || !this.canAct()) return;
      this.vy = -720; this.state = 'jump';
      if (this.isPlayer) SFX.jump();
    }
    takeHit(damage, fromX, attacker) {
      if (this.dead || this.invuln > 0) return;
      const dir = this.x < fromX ? -1 : 1;
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
      this.state = 'hit'; this.stateTimer = 0.22;
      this.vx = 260 * dir; this.vy = -180;
      this.combo = 0;
      spawnSparks(this.x, this.y - this.height * 0.6, dir, '#ff4b5c');
      SFX.hit();
      if (attacker && attacker.isPlayer) {
        attacker.combo++;
        attacker.comboTimer = 1.4;
        addScore(10 + attacker.combo * 4);
      }
      if (this.hp <= 0) this.die();
    }
    die() {
      this.hp = 0; this.dead = true; this.state = 'ko';
      this.vy = -260;
      this.vx = (this.x < (player ? player.x : 0) ? -1 : 1) * 120;
      SFX.ko();
      if (!this.isPlayer) {
        addScore(this.boss ? 500 : 50);
        // Drop chance
        if (this.boss) {
          spawnPickup(this.x, 'sword');
          spawnPickup(this.x + 20, 'heart');
        } else if (Math.random() < this.dropChance) {
          spawnPickup(this.x, Math.random() < 0.7 ? 'heart' : 'sword');
        }
      }
    }
    update(dt) {
      this.stateTimer = Math.max(0, this.stateTimer - dt);
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.invuln = Math.max(0, this.invuln - dt);
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer <= 0) this.combo = 0;
      this.bobPhase += dt * 6;

      if (this.weapon) {
        // Weapon decays only on use (decrement on attack land)
      }

      if (!this.dead) this.stam = Math.min(this.maxStam, this.stam + dt * (this.state === 'block' ? 10 : 22));

      if (this.ai) this.runAI(dt);

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

      this.vy += world.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.knockback) {
        this.x += this.knockback * dt;
        this.knockback *= 0.9;
        if (Math.abs(this.knockback) < 4) this.knockback = 0;
      }

      if (this.y >= world.groundY()) {
        this.y = world.groundY(); this.vy = 0;
        if (this.state === 'jump') this.state = 'idle';
        if (this.state === 'hit' && this.stateTimer <= 0 && !this.dead) this.state = 'idle';
      }
      this.x = Math.max(40, Math.min(VIEW.w - 40, this.x));

      if ((this.state === 'punch' || this.state === 'kick') && !this.hasHitThisAttack) {
        const dur = this.state === 'kick' ? 0.32 : (this.weapon && this.weapon.kind === 'sword' ? 0.28 : 0.22);
        const tProgress = 1 - (this.stateTimer / dur);
        this.attackArc = tProgress;
        if (tProgress > 0.22 && tProgress < 0.78) {
          let reach = this.state === 'kick' ? this.attackReach + 14 : this.attackReach;
          if (this.weapon && this.weapon.kind === 'sword' && this.state === 'punch') reach += 36;
          const hx = this.x + this.facing * reach * 0.6;
          for (const e of entities) {
            if (e === this || e.dead || e.invuln > 0) continue;
            if (e.isPlayer === this.isPlayer) continue;
            const dx = e.x - this.x;
            if (Math.sign(dx) !== this.facing && Math.abs(dx) > 10) continue;
            const heightFactor = this.state === 'kick' ? this.height : this.height * 0.9;
            if (Math.abs(e.x - hx) < 42 && Math.abs(e.y - this.y) < heightFactor) {
              let dmg = this.state === 'kick' ? this.attackDamage + 4 : this.attackDamage;
              if (this.weapon && this.weapon.kind === 'sword' && this.state === 'punch') dmg += 12;
              e.takeHit(dmg, this.x, this);
              this.hasHitThisAttack = true;
              shake(this.boss ? 10 : 6, this.boss ? 0.25 : 0.18);
              if (this.weapon && this.weapon.kind === 'sword') {
                this.weapon.dur--;
                if (this.weapon.dur <= 0) this.weapon = null;
              }
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

      const aggression = this.type === 'ninja' ? 1.4 : (this.type === 'brute' ? 0.7 : (this.boss ? 1.2 : 1.0));
      const desired = this.type === 'brute' ? 60 : 52;
      if (dist > desired + 16) this.aiMove = Math.sign(dx);
      else if (dist < desired - 16) this.aiMove = -Math.sign(dx);

      if (this.aiTimer <= 0 && this.canAct()) {
        this.aiTimer = (0.5 + Math.random() * 0.8) / aggression;
        if (dist < (this.type === 'brute' ? 80 : 70)) {
          const r = Math.random();
          if (this.type === 'brute') {
            if (r < 0.7) this.startAttack('kick');
            else this.startAttack('punch');
          } else if (this.type === 'ninja') {
            if (r < 0.4) this.startAttack('punch');
            else if (r < 0.75) this.startAttack('kick');
            else if (r < 0.9 && this.grounded) this.jump();
          } else {
            if (r < 0.55) this.startAttack('punch');
            else if (r < 0.8) this.startAttack('kick');
            else if (r < 0.92 && this.grounded) this.jump();
          }
        } else if (dist > 200) {
          if (this.type === 'ninja' && Math.random() < 0.5) this.dash();
          else if (Math.random() < 0.25) this.dash();
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

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, world.groundY() + 4, this.boss ? 38 : 26, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Enemy HP bar above head
      if (!this.isPlayer && !this.dead) {
        const w = this.boss ? 80 : 40;
        const hpRatio = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = '#0008';
        ctx.fillRect(x - w / 2, y - this.height - 18, w, 4);
        ctx.fillStyle = this.boss ? '#ffd86b' : '#ff4b5c';
        ctx.fillRect(x - w / 2, y - this.height - 18, w * hpRatio, 4);
        if (this.boss) {
          ctx.fillStyle = '#ffd86b';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('BOSS', x, y - this.height - 24);
        }
      }
    }
  }

  function drawStick(c, f) {
    const col = f.dead ? '#7a8492' : f.color;
    const scale = f.boss ? 1.35 : 1;
    c.lineWidth = (f.boss ? 6 : 4.5);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = col;
    c.fillStyle = col;

    const H = f.height * scale;
    const bob = f.grounded && f.state === 'walk' ? Math.sin(f.bobPhase) * 2.5 : 0;
    const hipY = -H * 0.45 + bob;
    const headR = 11 * scale;

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

    const torsoTopX = Math.sin(torsoLean) * 8;
    const torsoTopY = hipY - H * 0.35 + Math.cos(torsoLean) * (-2);
    c.beginPath();
    c.moveTo(0, hipY);
    c.lineTo(torsoTopX, torsoTopY);
    c.stroke();

    c.beginPath();
    c.arc(torsoTopX, hipY - H * 0.35 - headR + 4, headR, 0, Math.PI * 2);
    c.stroke();

    if (!f.dead) {
      c.beginPath();
      c.fillStyle = col;
      c.arc(torsoTopX + 4, hipY - H * 0.35 - headR + 2, 1.8, 0, Math.PI * 2);
      c.fill();
    }

    const shoulderY = torsoTopY + 6;
    drawLimb(c, torsoTopX, shoulderY, leftArmA - 1.2, H * 0.32, 0);
    const rightArmLen = H * 0.32 + punchExt;
    drawLimb(c, torsoTopX, shoulderY, rightArmA - 1.2, rightArmLen, 0);

    // Sword in right hand
    if (f.weapon && f.weapon.kind === 'sword' && (f.state === 'punch' || f.state === 'idle' || f.state === 'walk' || f.state === 'jump' || f.state === 'block')) {
      const ang = rightArmA - 1.2;
      const handX = torsoTopX + Math.sin(ang) * rightArmLen;
      const handY = shoulderY + Math.cos(ang) * rightArmLen;
      c.save();
      c.translate(handX, handY);
      // angle blade outward
      const bladeAng = f.state === 'punch' ? ang + 0.2 : ang + 0.6;
      c.rotate(bladeAng);
      c.strokeStyle = '#dfe7f5';
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(28, 0); c.stroke();
      c.strokeStyle = '#7a8492';
      c.beginPath(); c.moveTo(-1, -5); c.lineTo(-1, 5); c.stroke();
      c.restore();
    }

    drawLimb(c, 0, hipY, leftLegA + 1.55, H * 0.45, 0);
    drawLimb(c, 0, hipY, rightLegA + 1.55, H * 0.45 + kickExt, 0);

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
  function drawLimb(c, x, y, angle, length) {
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
      p.x += p.vx * dt; p.y += p.vy * dt;
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

  let shakeAmt = 0, shakeTime = 0;
  function shake(a, t) { shakeAmt = Math.max(shakeAmt, a); shakeTime = Math.max(shakeTime, t); }

  let score = 0, wave = 1;
  let waveInProgress = false;
  function addScore(n) { score += n; scoreEl.textContent = score; }
  function setWave(n) { wave = n; waveEl.textContent = wave; }
  function setMessage(text, ms = 1400, color) {
    messageEl.textContent = text;
    if (color) messageEl.style.color = color; else messageEl.style.color = '';
    messageEl.classList.add('show');
    clearTimeout(messageEl._t);
    messageEl._t = setTimeout(() => messageEl.classList.remove('show'), ms);
  }

  const entities = [];
  let player = null;

  function startGame() {
    entities.length = 0;
    particles.length = 0;
    pickups.length = 0;
    score = 0; addScore(0);
    setWave(1);
    player = new Fighter({
      x: VIEW.w * 0.3,
      isPlayer: true,
      color: '#e6edf3',
      hp: 130,
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
    const isBoss = n % 5 === 0;
    if (isBoss) {
      setMessage('BOSS', 1400, '#ff4b5c');
      SFX.boss();
      entities.push(new Fighter({
        x: VIEW.w + 60,
        facing: -1,
        isPlayer: false,
        color: '#ff4b5c',
        hp: 140 + n * 12,
        speed: 160,
        damage: 14 + Math.floor(n / 2),
        reach: 64,
        height: 96,
        ai: true,
        boss: true,
        type: 'brute',
      }));
      const adds = Math.min(2, Math.floor(n / 5));
      for (let i = 0; i < adds; i++) {
        entities.push(makeEnemy(n, i, true));
      }
      return;
    }
    const count = Math.min(2 + n, 6);
    for (let i = 0; i < count; i++) {
      entities.push(makeEnemy(n, i, false));
    }
  }
  function makeEnemy(n, i, fromBossWave) {
    const r = Math.random();
    let type = 'thug';
    if (n >= 2 && r > 0.85) type = 'brute';
    else if (n >= 3 && r > 0.6) type = 'ninja';
    const fromLeft = Math.random() < 0.5;
    const baseHp = 30 + n * 8;
    const opts = {
      x: fromLeft ? -40 - i * 50 : VIEW.w + 40 + i * 50,
      facing: fromLeft ? 1 : -1,
      isPlayer: false,
      ai: true,
      type,
      hp: baseHp,
      speed: 130 + Math.min(80, n * 8),
      damage: 6 + Math.min(10, Math.floor(n / 2)),
      reach: 52,
      color: '#ff4b5c',
    };
    if (type === 'brute') {
      opts.hp = baseHp * 1.7; opts.damage += 4; opts.speed = 100; opts.color = '#9a6bff'; opts.reach = 58;
    } else if (type === 'ninja') {
      opts.hp = baseHp * 0.7; opts.speed = 220; opts.color = '#4bd1ff'; opts.damage += 2;
    } else {
      opts.color = ['#ff4b5c', '#ffb04b', '#6effae'][i % 3];
    }
    return new Fighter(opts);
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
        player.hp = Math.min(player.maxHp, player.hp + 20);
        SFX.wave();
        const next = wave;
        if (next % 5 === 0) setMessage('BOSS APPROACHES', 1200, '#ff4b5c');
        else setMessage(`WAVE ${next}`, 900);
        setTimeout(() => spawnWave(next), 800);
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
  }

  function drawBackground() {
    const gy = world.groundY();
    ctx.fillStyle = '#0e1320';
    ctx.fillRect(0, gy - 240, VIEW.w, 240);

    const seed = 1234;
    let x = 0, i = 0;
    while (x < VIEW.w + 60) {
      const w = 40 + ((seed * (i + 1)) % 60);
      const h = 80 + ((seed * (i + 3)) % 140);
      ctx.fillStyle = i % 2 === 0 ? '#161e2f' : '#1a2440';
      ctx.fillRect(x, gy - h, w, h);
      ctx.fillStyle = '#3a4a7a';
      for (let wy = gy - h + 12; wy < gy - 8; wy += 14) {
        for (let wx = x + 6; wx < x + w - 6; wx += 12) {
          if ((wx + wy + i) % 3 === 0) ctx.fillRect(wx, wy, 4, 5);
        }
      }
      x += w + 4; i++;
    }

    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, gy, VIEW.w, VIEW.h - gy);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5); ctx.lineTo(VIEW.w, gy + 0.5);
    ctx.stroke();

    ctx.fillStyle = '#ffffff55';
    for (let s = 0; s < 60; s++) {
      const sx = (s * 137) % VIEW.w;
      const sy = (s * 53) % (gy - 240);
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  function drawWeaponBadge() {
    if (!player || !player.weapon) return;
    const x = 12, y = 56;
    ctx.save();
    ctx.fillStyle = '#11161fcc';
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, 96, 26, 6) : ctx.rect(x, y, 96, 26);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dfe7f5';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('SWORD', x + 10, y + 17);
    ctx.fillStyle = '#ffd86b';
    ctx.fillText(`x${player.weapon.dur}`, x + 64, y + 17);
    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (player && !player.dead) {
      if (justPressed.jump) player.jump();
      if (justPressed.punch) player.startAttack('punch');
      if (justPressed.kick) player.startAttack('kick');
      if (justPressed.dash) player.dash();
      player.block(pressed.block);
    }
    for (const k in justPressed) justPressed[k] = false;

    for (const e of entities) e.update(dt);
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.dead && !e.isPlayer) {
        e.deadTimer = (e.deadTimer || 0) + dt;
        if (e.deadTimer > 1.8) entities.splice(i, 1);
      }
    }
    updatePickups(dt);
    updateParticles(dt);
    checkWaveEnd();

    if (player && player.dead && !overlay.classList.contains('active')) {
      player.deadTimer = (player.deadTimer || 0) + dt;
      if (player.deadTimer > 1.6) gameOver();
    }

    let sx = 0, sy = 0;
    if (shakeTime > 0) {
      shakeTime -= dt;
      sx = (Math.random() - 0.5) * shakeAmt;
      sy = (Math.random() - 0.5) * shakeAmt;
      shakeAmt *= 0.9;
      if (shakeTime <= 0) shakeAmt = 0;
    }

    ctx.clearRect(0, 0, VIEW.w, VIEW.h);
    ctx.save();
    ctx.translate(sx, sy);
    drawBackground();
    drawPickups();
    const order = [...entities].sort((a, b) => a.y - b.y);
    for (const e of order) e.draw();
    drawParticles();
    ctx.restore();

    drawWeaponBadge();

    if (player) {
      hpFill.style.width = Math.max(0, (player.hp / player.maxHp) * 100) + '%';
      stamFill.style.width = Math.max(0, (player.stam / player.maxStam) * 100) + '%';
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  startBtn.addEventListener('click', () => { ac(); startGame(); });
  overlay.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'start-btn') { ac(); startGame(); }
  });
})();
