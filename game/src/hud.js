// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score,
// bomb progress, prompts, killfeed, buy menu and overlays. It never touches
// the simulation; main.js pushes values in, and every setter caches its last
// value so the DOM is only written when something changed.
export function createHud(onPlay, onBuy) {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const playBtn = el('play');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const vignette = el('vignette');
  const whiteflash = el('whiteflash');
  const healthNum = el('health-num');
  const healthFill = el('health-fill');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const nadeInd = el('nade-ind');
  const moneyEl = el('money');
  const timerEl = el('timer');
  const scoreV = el('score-v');
  const scoreS = el('score-s');
  const roundNum = el('round-num');
  const bombWrap = el('bomb-wrap');
  const bombLabel = el('bomb-label');
  const bombFill = el('bomb-fill');
  const promptEl = el('prompt');
  const feedEl = el('feed');
  const announceEl = el('announce');
  const carryEl = el('carry');
  const buyEl = el('buy');
  const buyMoney = el('buy-money');
  const buyMsg = el('buy-msg');
  const deadBanner = el('dead-banner');
  const feedLines = [];
  for (let i = 0; i < 6; i += 1) {
    const line = document.createElement('div');
    feedEl.appendChild(line);
    feedLines.push(line);
  }

  let last = {};
  let hitTimer = 0;
  let announceTimer = 0;
  let feedKey = '';

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  const COPY = {
    start: ['DUSKLINE', 'Duskline Yard, 19:40. Vanguard attacks, Sentinels hold. Plant the charge at Depot or Crane — or drop every defender. First to 5 rounds takes the yard.'],
    paused: ['Paused', 'Click to resume the round.'],
  };

  playBtn.addEventListener('click', onPlay);
  buyEl.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => onBuy(btn.dataset.buy));
  });

  return {
    setHealth(hp) {
      setText(healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      const pct = `${Math.max(0, hp)}%`;
      if (last.hppct !== pct) { last.hppct = pct; healthFill.style.width = pct; }
      healthFill.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, name, grenade) {
      if (grenade) {
        setText(ammoMag, 'mag', '1');
        setText(ammoReserve, 'res', '');
        setText(weaponName, 'wn', name);
      } else {
        setText(ammoMag, 'mag', String(mag));
        setText(ammoReserve, 'res', `/ ${reserve}`);
        setText(weaponName, 'wn', name);
      }
      ammoMag.classList.toggle('empty', !grenade && mag === 0);
    },
    setNades(frags, smokes) {
      setText(nadeInd, 'nades', `FRAG ${frags} · SMOKE ${smokes}`);
    },
    setMoney(m) { setText(moneyEl, 'money', `$${m}`); },
    setTimer(text, danger) {
      setText(timerEl, 'timer', text);
      timerEl.classList.toggle('danger', !!danger);
    },
    setScore(v, s, round) {
      setText(scoreV, 'sv', String(v));
      setText(scoreS, 'ss', String(s));
      setText(roundNum, 'round', `ROUND ${round}`);
    },
    setBomb(mode, frac, label) {
      const key = `${mode}|${label}|${Math.round(frac * 40)}`;
      if (last.bomb === key) return;
      last.bomb = key;
      bombWrap.hidden = mode === 'none';
      bombLabel.textContent = label;
      bombFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      bombFill.className = mode;
    },
    setPrompt(text) {
      setText(promptEl, 'prompt', text || '');
      promptEl.hidden = !text;
    },
    setCarry(has) {
      setText(carryEl, 'carry', has ? '◉ CHARGE' : '');
      carryEl.hidden = !has;
    },
    setDead(dead) { deadBanner.hidden = !dead; },
    setGap(px) {
      const v = `${px.toFixed(1)}px`;
      if (last.gap === v) return;
      last.gap = v;
      crosshair.style.setProperty('--cg', v);
    },
    hitMarker(killed, holdMs = 110) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 160);
    },
    blastFlash() {
      whiteflash.classList.add('on');
      setTimeout(() => whiteflash.classList.remove('on'), 220);
    },
    announce(text) {
      announceEl.textContent = text;
      announceEl.classList.add('on');
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => announceEl.classList.remove('on'), 2600);
    },
    setFeed(feed) {
      const key = feed.map((f) => f.text).join('|');
      if (key === feedKey) return;
      feedKey = key;
      for (let i = 0; i < feedLines.length; i += 1) {
        const entry = feed[feed.length - feedLines.length + i];
        feedLines[i].textContent = entry ? entry.text : '';
        feedLines[i].className = entry && entry.good ? 'good' : '';
      }
    },
    showBuy(show, money, owned) {
      buyEl.hidden = !show;
      if (!show) return;
      buyMoney.textContent = `$${money}`;
      buyEl.querySelectorAll('[data-buy]').forEach((btn) => {
        const id = btn.dataset.buy;
        btn.disabled = money < Number(btn.dataset.price) || owned.includes(id);
      });
    },
    setBuyMsg(msg) { buyMsg.textContent = msg; },
    showOverlay(mode, data) {
      if (mode === 'start' || mode === 'paused') {
        title.textContent = COPY[mode][0];
        copy.textContent = COPY[mode][1];
        playBtn.textContent = mode === 'start' ? 'Click to play' : 'Click to resume';
      } else if (mode === 'round') {
        title.textContent = 'Round over';
        copy.textContent = `${data.text}  Vanguard ${data.v} — ${data.s} Sentinels. Next round starts shortly.`;
        playBtn.textContent = 'Click to continue';
      } else if (mode === 'match') {
        title.textContent = data.winner === 'van' ? 'Vanguard take the yard' : 'Sentinels hold the yard';
        copy.textContent = `Final score: Vanguard ${data.v} — ${data.s} Sentinels. You scored ${data.kills} eliminations.`;
        playBtn.textContent = 'Play again';
      }
      overlay.hidden = false;
      playBtn.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    overlayVisible() { return !overlay.hidden; },
  };
}
