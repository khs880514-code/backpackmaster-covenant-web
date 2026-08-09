(() => {
  "use strict";

  const LABELS = {
    sword: "검",
    rapier: "레이피어",
    mace: "메이스",
    greatsword: "대검",
    spear: "창",
    halberd: "할버드",
    lance: "랜스",
    hammer: "해머",
    great_hammer: "그레이트 해머",
    shortbow: "숏보우",
    crossbow: "크로스보우",
    throwing_dagger: "투척 단검",
    short_wand: "숏 완드",
    round_shield: "라운드 실드",
    kite_shield: "카이트 실드",
    tower_shield: "타워 실드",
    staff: "스태프",
    orb_focus: "오브 포커스",
    spellbook: "마도서",
    relic_censer: "성유 향로",
    coil_launcher: "코일 런처",
    turret_pack: "터렛 팩",
    bolt_sentry: "볼트 센트리",
    bombard_turret: "봄바드 터렛",
    arc_coil_turret: "아크 코일 터렛",
    saw_turret: "쏘우 터렛",
    trap_satchel: "트랩 새철",
    snare_bow: "스네어 보우",
  };

  const CATEGORY_LABELS = {
    melee: "근접",
    shield: "방패",
    ranged: "원거리",
    magic: "마법",
    deployable: "설치형",
  };

  const MELEE_EVIDENCE = new Set([
    "sword", "rapier", "mace", "greatsword", "spear",
    "halberd", "lance", "hammer", "great_hammer",
  ]);

  const COLORS = {
    bg: "#080d14",
    panel: "#0b121d",
    grid: "rgba(70, 95, 128, 0.19)",
    border: "#26384f",
    text: "#edf5ff",
    muted: "#88a0bd",
    gold: "#ffd56a",
    cyan: "#47d7ff",
    pink: "#ff82db",
    green: "#55efa0",
    orange: "#ff9d3d",
    outside: "#4d6079",
    hit: "rgba(255, 145, 56, 0.12)",
  };

  const state = {
    data: null,
    cases: new Map(),
    category: "all",
    selectedWeapon: "sword",
    formation: "side",
    progress: 0,
    playing: true,
    speed: 1,
    rangeScale: 2,
    showTrail: true,
    showHit: true,
    showLabels: true,
    lateRetarget: false,
    view: "focus",
    matrixSearch: "",
    lastFrameTime: 0,
  };

  const elements = {};
  const imageCache = new Map();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const keyFor = (weaponId, axis) => `${weaponId}:${axis}`;
  const labelFor = (weaponId) => LABELS[weaponId] ?? weaponId.replaceAll("_", " ").toUpperCase();
  const format = (value, digits = 1) => Number(value ?? 0).toFixed(digits);

  function collectElements() {
    for (const id of [
      "data-status", "weapon-count", "category-select", "weapon-select", "formation-select",
      "timeline", "progress-readout", "play-btn", "reset-btn", "speed-select", "range-scale",
      "range-output", "trail-toggle", "hit-toggle", "label-toggle", "retarget-toggle",
      "fullscreen-btn", "weapon-summary", "orbit-stage", "axis-diff", "matrix-search",
      "matrix-grid", "evidence-grid", "evidence-empty", "focus-view", "matrix-view", "evidence-view",
    ]) {
      elements[id] = document.getElementById(id);
    }
  }

  async function loadData() {
    const response = await fetch("./data/orbit_cases.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`orbit data request failed: ${response.status}`);
    const data = await response.json();
    if (data.schema !== "bg2.orbit_qa_site.v1" || data.weapon_order?.length !== 28 || data.cases?.length !== 56) {
      throw new Error("orbit data contract mismatch");
    }
    state.data = data;
    state.cases = new Map(data.cases.map((row) => [keyFor(row.weapon_id, row.axis), row]));
    elements["data-status"].textContent = `실런타임 데이터 · ${data.cases.length} CASES`;
    elements["weapon-count"].textContent = `${data.weapon_order.length}종`;
    rebuildWeaponOptions();
    updateAllText();
    renderEvidence();
    renderMatrix(true);
  }

  function rebuildWeaponOptions() {
    const order = state.data?.weapon_order ?? [];
    const filtered = order.filter((weaponId) => {
      if (state.category === "all") return true;
      return state.cases.get(keyFor(weaponId, "horizontal"))?.category === state.category;
    });
    if (!filtered.includes(state.selectedWeapon)) state.selectedWeapon = filtered[0] ?? order[0] ?? "sword";
    elements["weapon-select"].replaceChildren(...filtered.map((weaponId) => {
      const option = document.createElement("option");
      option.value = weaponId;
      option.textContent = `${labelFor(weaponId)} · ${weaponId.toUpperCase()}`;
      return option;
    }));
    elements["weapon-select"].value = state.selectedWeapon;
  }

  function currentPair(weaponId = state.selectedWeapon) {
    return {
      horizontal: state.cases.get(keyFor(weaponId, "horizontal")),
      vertical: state.cases.get(keyFor(weaponId, "vertical")),
    };
  }

  function bindControls() {
    elements["category-select"].addEventListener("change", (event) => {
      state.category = event.target.value;
      rebuildWeaponOptions();
      resetProgress();
      updateAllText();
      renderEvidence();
      renderMatrix(true);
    });
    elements["weapon-select"].addEventListener("change", (event) => selectWeapon(event.target.value));
    elements["formation-select"].addEventListener("change", (event) => {
      state.formation = event.target.value;
      updateAllText();
    });
    elements.timeline.addEventListener("input", (event) => {
      state.progress = Number(event.target.value);
      state.playing = false;
      syncPlayButton();
      updateProgressText();
      render();
    });
    elements["play-btn"].addEventListener("click", togglePlay);
    elements["reset-btn"].addEventListener("click", resetProgress);
    elements["speed-select"].addEventListener("change", (event) => { state.speed = Number(event.target.value); });
    elements["range-scale"].addEventListener("input", (event) => {
      state.rangeScale = Number(event.target.value);
      elements["range-output"].textContent = `×${format(state.rangeScale, 2)}`;
      render();
    });
    elements["trail-toggle"].addEventListener("change", (event) => { state.showTrail = event.target.checked; render(); });
    elements["hit-toggle"].addEventListener("change", (event) => { state.showHit = event.target.checked; render(); });
    elements["label-toggle"].addEventListener("change", (event) => { state.showLabels = event.target.checked; render(); });
    elements["retarget-toggle"].addEventListener("change", (event) => { state.lateRetarget = event.target.checked; render(); });
    elements["fullscreen-btn"].addEventListener("click", toggleFullscreen);
    elements["matrix-search"].addEventListener("input", (event) => {
      state.matrixSearch = event.target.value.trim().toLowerCase();
      renderMatrix(true);
    });
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    document.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space") { event.preventDefault(); togglePlay(); }
      if (event.key.toLowerCase() === "r") resetProgress();
      if (event.key.toLowerCase() === "f") toggleFullscreen();
      if (event.key === "ArrowRight") stepWeapon(1);
      if (event.key === "ArrowLeft") stepWeapon(-1);
    });
    document.addEventListener("fullscreenchange", resizeForFullscreen);
  }

  function selectWeapon(weaponId) {
    if (!state.data?.weapon_order.includes(weaponId)) return;
    state.selectedWeapon = weaponId;
    if (![...elements["weapon-select"].options].some((option) => option.value === weaponId)) {
      state.category = "all";
      elements["category-select"].value = "all";
      rebuildWeaponOptions();
    }
    elements["weapon-select"].value = weaponId;
    resetProgress();
    updateAllText();
    renderEvidence();
    render();
  }

  function stepWeapon(direction) {
    const options = [...elements["weapon-select"].options].map((option) => option.value);
    if (!options.length) return;
    const index = options.indexOf(state.selectedWeapon);
    selectWeapon(options[(index + direction + options.length) % options.length]);
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    for (const name of ["focus", "matrix", "evidence"]) {
      elements[`${name}-view`].classList.toggle("active", name === view);
    }
    if (view === "matrix") renderMatrix(true);
    if (view === "evidence") renderEvidence();
    render();
  }

  function togglePlay() {
    state.playing = !state.playing;
    if (state.playing && state.progress >= 0.999) state.progress = 0;
    syncPlayButton();
  }

  function syncPlayButton() {
    elements["play-btn"].innerHTML = state.playing ? `일시정지 <kbd>Space</kbd>` : `재생 <kbd>Space</kbd>`;
  }

  function resetProgress() {
    state.progress = 0;
    elements.timeline.value = "0";
    updateProgressText();
    render();
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  function resizeForFullscreen() {
    elements["fullscreen-btn"].innerHTML = document.fullscreenElement ? `전체화면 종료 <kbd>F</kbd>` : `전체화면 <kbd>F</kbd>`;
    render();
  }

  function updateProgressText() {
    const pct = Math.round(state.progress * 100);
    elements.timeline.value = String(state.progress);
    elements["progress-readout"].textContent = `${pct}%`;
  }

  function updateAllText() {
    if (!state.data) return;
    const { horizontal, vertical } = currentPair();
    if (!horizontal || !vertical) return;
    const identity = horizontal.identity ?? {};
    const chips = statusChips(horizontal.combo);
    elements["weapon-summary"].innerHTML = `
      <div class="summary-row">
        <h2>${labelFor(state.selectedWeapon)}</h2>
        <span class="chip">${CATEGORY_LABELS[horizontal.category] ?? horizontal.category}</span>
        <span class="chip">${horizontal.combo.orbit_archetype}</span>
        ${chips.map((chip) => `<span class="chip ${chip.kind}">${chip.label}</span>`).join("")}
        <p>${identity.fantasy ?? "실제 런타임 액션 데이터를 가로/세로로 비교합니다."}</p>
      </div>`;
    elements["axis-diff"].innerHTML = [
      ["사거리 H → V", `${format(horizontal.combo.range)} → ${format(vertical.combo.range)} (${signedPct(horizontal.combo.range, vertical.combo.range)})`],
      ["피해 H → V", `${format(horizontal.combo.damage, 2)} → ${format(vertical.combo.damage, 2)} (${signedPct(horizontal.combo.damage, vertical.combo.damage)})`],
      ["쿨다운 H → V", `${format(horizontal.combo.cooldown, 2)}s → ${format(vertical.combo.cooldown, 2)}s`],
      ["발사/표적 수 H → V", `${countIdentity(horizontal.combo)} → ${countIdentity(vertical.combo)}`],
    ].map(([title, value]) => `<div class="delta-card"><span>${title}</span><strong>${value}</strong></div>`).join("");
    updateProgressText();
  }

  function signedPct(left, right) {
    const a = Number(left ?? 0);
    const b = Number(right ?? 0);
    if (!a) return "—";
    const value = ((b / a) - 1) * 100;
    return `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
  }

  function countIdentity(combo) {
    if (combo.projectile_count != null) return `${combo.projectile_count}발`;
    if (combo.target_cap > 0) return `${combo.target_cap}표적`;
    return "궤적 전체";
  }

  function statusChips(combo) {
    const chips = [];
    if (combo.bleed_damage_mul > 0) {
      const ticks = Math.floor(combo.bleed_duration / combo.bleed_tick_interval + 0.0001);
      chips.push({ kind: "bleed", label: `출혈 ${Math.round(combo.bleed_damage_mul * 100)}% × ${ticks}` });
    }
    if (combo.slow_pct > 0) chips.push({ kind: "slow", label: `둔화 ${combo.slow_pct}% · ${combo.slow_seconds}s` });
    if (combo.shield_flight_path) chips.push({ kind: "shield", label: shieldPathLabel(combo.shield_flight_path) });
    return chips;
  }

  function shieldPathLabel(path) {
    return {
      round_arc: "원호 튕김",
      kite_weave: "S자 직조",
      tower_battering: "중량 돌진",
    }[path] ?? path;
  }

  function formationPoints(name, depth) {
    if (name === "single") return [[depth * 0.72, 0]];
    if (name === "line") return [0.25, 0.4, 0.55, 0.7, 0.85, 1].map((ratio) => [depth * ratio, 0]);
    if (name === "side") {
      return [[0.42,-0.42],[0.58,-0.36],[0.74,-0.30],[0.88,-0.22],[0.42,0.42],[0.58,0.36],[0.74,0.30],[0.88,0.22]]
        .map(([x, y]) => [x * depth, y * depth]);
    }
    if (name === "semicircle") {
      return [-75,-60,-45,-30,-15,0,15,30,45,60,75,90].map((degrees) => {
        const angle = degrees * Math.PI / 180;
        return [Math.cos(angle) * depth * 0.7, Math.sin(angle) * depth * 0.7];
      });
    }
    const points = [];
    for (const radius of [0.36, 0.58, 0.8]) {
      for (const degrees of [-70,-42,-14,14,42,70]) {
        const angle = degrees * Math.PI / 180;
        points.push([Math.cos(angle) * depth * radius, Math.sin(angle) * depth * radius]);
      }
    }
    return points;
  }

  function buildGeometry(row, rangeScale, formation, targetDepth = null) {
    const combo = row.combo;
    const range = Math.max(Number(combo.range ?? combo.reach ?? 100) * rangeScale, 20);
    const formationDepth = targetDepth ?? range;
    const hitRadius = Number(combo.trajectory?.hit?.radius ?? combo.hit_radius ?? 9) * Math.max(1, rangeScale * 0.72);
    const samples = combo.trajectory?.samples;
    if (Array.isArray(samples) && samples.length >= 2) {
      return {
        paths: [samples.map((sample) => [sample.position[0] * range, sample.position[1] * range])],
        hitRadius,
      };
    }
    if (combo.orbit_archetype === "shield_ricochet") {
      return shieldGeometry(combo, range, formation, formationDepth);
    }
    if (row.category === "deployable") {
      return deployableGeometry(combo, range);
    }
    if (combo.orbit_archetype === "bow_crossbow") {
      return projectileGeometry(combo, range, false);
    }
    if (combo.orbit_archetype === "magic_cast") {
      return projectileGeometry(combo, range, true);
    }
    if (combo.orbit_archetype === "throwing_return") {
      return throwingGeometry(combo, range);
    }
    return { paths: [[[0, 0], [range, 0]]], hitRadius };
  }

  function projectileGeometry(combo, range, curved) {
    const count = clamp(Number(combo.projectile_count ?? 1), 1, 7);
    const spreadDegrees = Number(combo.spread ?? (count > 1 ? 18 : 0));
    const paths = [];
    for (let index = 0; index < count; index++) {
      const ratio = count === 1 ? 0 : index / (count - 1) - 0.5;
      const angle = ratio * spreadDegrees * Math.PI / 180;
      const end = [Math.cos(angle) * range, Math.sin(angle) * range];
      if (!curved) {
        paths.push([[0, 0], end]);
      } else {
        const bend = (index % 2 ? 1 : -1) * range * (0.12 + Math.abs(ratio) * 0.08);
        paths.push(sampleQuadratic([0, 0], [range * 0.46, bend], end, 24));
      }
    }
    return { paths, hitRadius: Math.max(5, Number(combo.projectile_radius ?? 6)) };
  }

  function throwingGeometry(combo, range) {
    const count = clamp(Number(combo.projectile_count ?? 1), 1, 5);
    const spreadDegrees = Number(combo.spread ?? 18);
    const paths = [];
    for (let index = 0; index < count; index++) {
      const ratio = count === 1 ? 0 : index / (count - 1) - 0.5;
      const angle = ratio * spreadDegrees * Math.PI / 180;
      const out = [Math.cos(angle) * range, Math.sin(angle) * range];
      const side = (index % 2 ? -1 : 1) * range * 0.26;
      const outbound = sampleQuadratic([0, 0], [range * 0.52, side], out, 18);
      const inbound = sampleQuadratic(out, [range * 0.42, -side], [0, 0], 18).slice(1);
      paths.push(outbound.concat(inbound));
    }
    return { paths, hitRadius: Math.max(6, Number(combo.projectile_radius ?? 7)) };
  }

  function deployableGeometry(combo, range) {
    const count = clamp(Number(combo.projectile_count ?? combo.target_cap ?? 2), 1, 6);
    const paths = [];
    for (let index = 0; index < count; index++) {
      const ratio = count === 1 ? 0 : index / (count - 1) - 0.5;
      const end = [range * (0.62 + Math.abs(ratio) * 0.18), ratio * range * 0.82];
      paths.push(sampleQuadratic([0, 0], [range * 0.28, ratio * range * 0.2 - 20], end, 18));
    }
    return { paths, hitRadius: Math.max(10, Number(combo.area_radius ?? combo.splash_radius ?? 14)), deployable: true };
  }

  function shieldGeometry(combo, range, formation, targetDepth) {
    const targets = formationPoints(formation, targetDepth).slice(0, Math.max(1, Number(combo.target_cap ?? 1)));
    const path = [[0, 0]];
    let start = [0, 0];
    let sign = 1;
    for (const target of targets) {
      path.push(...sampleShieldSegment(combo.shield_flight_path, start, target, Number(combo.curve_height ?? 24), sign, 18).slice(1));
      start = target;
      sign *= -1;
    }
    path.push(...sampleShieldSegment(combo.shield_flight_path, start, [0, 0], Number(combo.curve_height ?? 24), sign, 22).slice(1));
    return { paths: [path], hitRadius: Math.max(8, Number(combo.projectile_radius ?? 11)) };
  }

  function sampleShieldSegment(mode, start, end, curveHeight, sign, steps) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy) || 1;
    const side = [-dy / length, dx / length];
    const amplitude = Math.min(length * 0.25, Math.max(curveHeight, 0)) * sign;
    const points = [];
    for (let index = 0; index <= steps; index++) {
      const raw = index / steps;
      const t = ["kite_weave", "tower_battering"].includes(mode) ? raw * raw : ease(raw);
      const lateral = mode === "kite_weave"
        ? Math.sin(Math.PI * 2 * t) * amplitude
        : Math.sin(Math.PI * t) * amplitude * (mode === "tower_battering" ? 0.16 : 1);
      points.push([lerp(start[0], end[0], t) + side[0] * lateral, lerp(start[1], end[1], t) + side[1] * lateral]);
    }
    return points;
  }

  function sampleQuadratic(start, control, end, steps) {
    const points = [];
    for (let index = 0; index <= steps; index++) {
      const t = index / steps;
      const inv = 1 - t;
      points.push([
        inv * inv * start[0] + 2 * inv * t * control[0] + t * t * end[0],
        inv * inv * start[1] + 2 * inv * t * control[1] + t * t * end[1],
      ]);
    }
    return points;
  }

  function pathLength(path) {
    let length = 0;
    for (let index = 1; index < path.length; index++) {
      length += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
    }
    return length;
  }

  function pointAt(path, progress) {
    if (!path?.length) return [0, 0];
    if (path.length === 1) return path[0];
    const total = pathLength(path);
    let remaining = clamp(progress, 0, 1) * total;
    for (let index = 1; index < path.length; index++) {
      const start = path[index - 1];
      const end = path[index];
      const segment = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (remaining <= segment) {
        const t = segment ? remaining / segment : 0;
        return [lerp(start[0], end[0], t), lerp(start[1], end[1], t)];
      }
      remaining -= segment;
    }
    return path[path.length - 1];
  }

  function partialPath(path, progress) {
    if (!path?.length) return [];
    const total = pathLength(path);
    let remaining = clamp(progress, 0, 1) * total;
    const result = [path[0]];
    for (let index = 1; index < path.length; index++) {
      const start = path[index - 1];
      const end = path[index];
      const segment = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (remaining >= segment) {
        result.push(end);
        remaining -= segment;
        continue;
      }
      const t = segment ? remaining / segment : 0;
      result.push([lerp(start[0], end[0], t), lerp(start[1], end[1], t)]);
      break;
    }
    return result;
  }

  function distanceToPath(point, path) {
    let best = Infinity;
    for (let index = 1; index < path.length; index++) {
      best = Math.min(best, distanceToSegment(point, path[index - 1], path[index]));
    }
    return best;
  }

  function distanceToSegment(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared, 0, 1) : 0;
    return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t));
  }

  function render() {
    if (!state.data) return;
    if (state.view === "focus") renderFocus();
    if (state.view === "matrix") renderMatrix(false);
  }

  function renderFocus() {
    const canvas = elements["orbit-stage"];
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const pair = currentPair();
    const targetDepth = clamp(Math.max(pair.horizontal.combo.range, pair.vertical.combo.range) * 0.9, 100, 180);
    const panels = [
      { row: pair.horizontal, scale: 1, targetDepth, x: 16, y: 18, w: 616, h: 384, title: "가로 · 기본 ×1.00", color: COLORS.cyan },
      { row: pair.vertical, scale: 1, targetDepth, x: 648, y: 18, w: 616, h: 384, title: "세로 · 기본 ×1.00", color: COLORS.pink },
      { row: pair.horizontal, scale: state.rangeScale, targetDepth, x: 16, y: 418, w: 616, h: 384, title: `가로 · 확대 ×${format(state.rangeScale, 2)}`, color: COLORS.cyan },
      { row: pair.vertical, scale: state.rangeScale, targetDepth, x: 648, y: 418, w: 616, h: 384, title: `세로 · 확대 ×${format(state.rangeScale, 2)}`, color: COLORS.pink },
    ];
    const pixelsPerUnit = fitPixelsPerUnit(panels, true, 1.75);
    for (const panel of panels) drawPanel(ctx, panel, pixelsPerUnit, state.progress, state.formation, true);
  }

  function drawPanel(ctx, panel, pixelsPerUnit, progress, formation, detailed) {
    const { row, scale, targetDepth, x, y, w, h, title, color } = panel;
    const combo = row.combo;
    ctx.save();
    roundedRect(ctx, x, y, w, h, 9);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let gx = x + 24; gx < x + w; gx += 44) drawLine(ctx, [[gx, y + 48], [gx, y + h]]);
    for (let gy = y + 58; gy < y + h; gy += 44) drawLine(ctx, [[x, gy], [x + w, gy]]);

    ctx.fillStyle = color;
    ctx.font = detailed ? "700 16px system-ui" : "700 11px system-ui";
    ctx.fillText(title, x + 14, y + (detailed ? 24 : 17));
    ctx.fillStyle = COLORS.muted;
    ctx.font = detailed ? "11px ui-monospace, monospace" : "9px ui-monospace, monospace";
    const metrics = `DMG ${format(combo.damage, 2)}  CD ${format(combo.cooldown, 2)}  RANGE ${format(combo.range * scale)}  ${combo.orbit_archetype}`;
    ctx.fillText(metrics, x + 14, y + (detailed ? 41 : 31));

    const center = [x + w * 0.32, y + h * 0.57];
    const depth = targetDepth ?? Math.max(Number(combo.range ?? 100), 84);
    const geometry = buildGeometry(row, scale, formation, depth);
    const targets = formationPoints(formation, depth);
    const transform = ([px, py]) => [center[0] + px * pixelsPerUnit, center[1] + py * pixelsPerUnit];
    const localPaths = geometry.paths;
    const transformedPaths = localPaths.map((path) => path.map(transform));

    if (state.showHit) {
      for (const path of transformedPaths) {
        ctx.strokeStyle = COLORS.hit;
        ctx.lineWidth = Math.max(3, geometry.hitRadius * 2 * pixelsPerUnit);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        drawLine(ctx, path);
      }
    }
    if (state.showTrail) {
      for (const path of transformedPaths) {
        ctx.strokeStyle = "rgba(110, 155, 207, 0.30)";
        ctx.lineWidth = detailed ? 2 : 1;
        drawLine(ctx, path);
      }
    }

    for (const path of transformedPaths) {
      ctx.strokeStyle = color;
      ctx.lineWidth = detailed ? 3 : 1.5;
      drawLine(ctx, partialPath(path, progress));
    }

    const predicted = new Set();
    const live = new Set();
    targets.forEach((target, index) => {
      const predictedHit = localPaths.some((path) => distanceToPath(target, path) <= geometry.hitRadius + 9);
      const liveHit = localPaths.some((path) => distanceToPath(target, partialPath(path, progress)) <= geometry.hitRadius + 9);
      if (predictedHit) predicted.add(index);
      if (liveHit) live.add(index);
      const screen = transform(target);
      const fill = liveHit ? COLORS.green : predictedHit ? COLORS.orange : COLORS.outside;
      ctx.beginPath();
      ctx.arc(screen[0], screen[1], detailed ? 8 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (detailed && state.showLabels) {
        ctx.fillStyle = COLORS.text;
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(String(index + 1), screen[0] + 10, screen[1] - 7);
      }
    });

    drawPlayer(ctx, center, detailed ? 56 : 32);
    const primary = transformedPaths[0] ?? [center];
    const weaponPoint = pointAt(primary, progress);
    drawWeapon(ctx, row.weapon_texture, weaponPoint, color, detailed ? 28 : 16, geometry.deployable);

    if (state.lateRetarget && progress >= 0.85) {
      const marker = transform([depth * 0.55, -depth * 0.65]);
      ctx.strokeStyle = COLORS.pink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(marker[0], marker[1], detailed ? 11 : 6, 0, Math.PI * 2);
      ctx.stroke();
      if (detailed) {
        ctx.fillStyle = COLORS.pink;
        ctx.font = "700 10px system-ui";
        ctx.fillText("RETARGET B", marker[0] + 14, marker[1] - 5);
      }
    }

    if (detailed && state.showLabels) {
      const chipLabels = statusChips(combo).map((chip) => chip.label);
      ctx.fillStyle = COLORS.muted;
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(`LIVE ${live.size} / PRED ${predicted.size} / TARGETS ${targets.length}`, x + 14, y + h - 28);
      ctx.fillText(chipLabels.length ? chipLabels.join("  ·  ") : countIdentity(combo), x + 14, y + h - 12);
    }
    ctx.restore();
  }

  function fitPixelsPerUnit(panels, detailed, maximum) {
    let fitted = maximum;
    for (const panel of panels) {
      const depth = panel.targetDepth ?? Math.max(Number(panel.row.combo.range ?? 100), 84);
      const geometry = buildGeometry(panel.row, panel.scale, state.formation, depth);
      const points = geometry.paths.flat().concat(formationPoints(state.formation, depth));
      if (!points.length) continue;
      const minX = Math.min(...points.map((point) => point[0])) - geometry.hitRadius;
      const maxX = Math.max(...points.map((point) => point[0])) + geometry.hitRadius;
      const minY = Math.min(...points.map((point) => point[1])) - geometry.hitRadius;
      const maxY = Math.max(...points.map((point) => point[1])) + geometry.hitRadius;
      const left = panel.w * 0.32 - 14;
      const right = panel.w * 0.68 - 14;
      const top = panel.h * 0.57 - (detailed ? 58 : 38);
      const bottom = panel.h * 0.43 - (detailed ? 26 : 14);
      if (minX < 0) fitted = Math.min(fitted, left / -minX);
      if (maxX > 0) fitted = Math.min(fitted, right / maxX);
      if (minY < 0) fitted = Math.min(fitted, top / -minY);
      if (maxY > 0) fitted = Math.min(fitted, bottom / maxY);
    }
    return clamp(fitted, 0.18, maximum);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function drawLine(ctx, points) {
    if (!points?.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
    ctx.stroke();
  }

  function getImage(url) {
    if (!url) return null;
    if (imageCache.has(url)) return imageCache.get(url);
    const image = new Image();
    image.onload = () => render();
    image.onerror = () => imageCache.set(url, false);
    image.src = url;
    imageCache.set(url, image);
    return image;
  }

  function drawPlayer(ctx, center, size) {
    const image = getImage("./project/assets/characters/class_runtime_production_20260710/rogue/runtime/idle_8dir.png");
    if (image && image.complete && image.naturalWidth) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(image, 0, 96 * 3, 96, 96, center[0] - size / 2, center[1] - size * 0.72, size, size);
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.arc(center[0], center[1], size * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.gold;
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255, 213, 106, 0.70)";
    ctx.lineWidth = 1;
    drawLine(ctx, [[center[0] - 8, center[1]], [center[0] + 8, center[1]]]);
    drawLine(ctx, [[center[0], center[1] - 8], [center[0], center[1] + 8]]);
  }

  function drawWeapon(ctx, url, point, color, size, deployable) {
    const image = getImage(url);
    if (image && image.complete && image.naturalWidth) {
      const ratio = Math.min(size / image.naturalWidth, (size * 1.8) / image.naturalHeight);
      const width = image.naturalWidth * ratio;
      const height = image.naturalHeight * ratio;
      ctx.drawImage(image, point[0] - width / 2, point[1] - height / 2, width, height);
      return;
    }
    ctx.save();
    ctx.translate(point[0], point[1]);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = deployable ? COLORS.orange : color;
    ctx.fillRect(-size * 0.32, -size * 0.32, size * 0.64, size * 0.64);
    ctx.restore();
  }

  function renderMatrix(rebuild) {
    if (!state.data || state.view !== "matrix" && !rebuild) return;
    const filtered = state.data.weapon_order.filter((weaponId) => {
      const row = state.cases.get(keyFor(weaponId, "horizontal"));
      const categoryMatch = state.category === "all" || row.category === state.category;
      const text = `${weaponId} ${labelFor(weaponId)}`.toLowerCase();
      return categoryMatch && text.includes(state.matrixSearch);
    });
    if (rebuild) {
      elements["matrix-grid"].replaceChildren(...filtered.map((weaponId) => {
        const pair = currentPair(weaponId);
        const card = document.createElement("article");
        card.className = "matrix-card";
        card.dataset.weapon = weaponId;
        card.innerHTML = `
          <header><h3>${labelFor(weaponId)}</h3><span>${CATEGORY_LABELS[pair.horizontal.category]}</span></header>
          <canvas width="420" height="190" aria-label="${labelFor(weaponId)} 가로 세로 비교"></canvas>
          <div class="matrix-metrics">
            <div>H · ${format(pair.horizontal.combo.range)} · ${format(pair.horizontal.combo.damage, 2)} DMG</div>
            <div>V · ${format(pair.vertical.combo.range)} · ${format(pair.vertical.combo.damage, 2)} DMG</div>
          </div>`;
        card.addEventListener("click", () => {
          selectWeapon(weaponId);
          setView("focus");
        });
        return card;
      }));
    }
    for (const card of elements["matrix-grid"].querySelectorAll(".matrix-card")) {
      const weaponId = card.dataset.weapon;
      const pair = currentPair(weaponId);
      const canvas = card.querySelector("canvas");
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const targetDepth = clamp(Math.max(pair.horizontal.combo.range, pair.vertical.combo.range) * 0.9, 90, 160);
      const panels = [
        { row: pair.horizontal, scale: 1, targetDepth, x: 6, y: 6, w: 201, h: 178, title: "H", color: COLORS.cyan },
        { row: pair.vertical, scale: 1, targetDepth, x: 213, y: 6, w: 201, h: 178, title: "V", color: COLORS.pink },
      ];
      const ppu = fitPixelsPerUnit(panels, false, 1.05);
      drawPanel(ctx, panels[0], ppu, state.progress, state.formation, false);
      drawPanel(ctx, panels[1], ppu, state.progress, state.formation, false);
    }
  }

  function renderEvidence() {
    if (!state.data) return;
    const available = MELEE_EVIDENCE.has(state.selectedWeapon);
    elements["evidence-empty"].hidden = available;
    elements["evidence-grid"].hidden = !available;
    if (!available) {
      elements["evidence-grid"].replaceChildren();
      return;
    }
    const cards = [];
    for (const axis of ["horizontal", "vertical"]) {
      for (const variant of ["base", "range_x2"]) {
        const card = document.createElement("article");
        card.className = "evidence-card";
        const label = `${axis === "horizontal" ? "가로" : "세로"} · ${variant === "base" ? "기본" : "사거리 ×2"}`;
        const url = `./evidence/${state.selectedWeapon}_${axis}_${variant}_30fps.png`;
        card.innerHTML = `<header>${label}</header><img src="${url}" alt="${label} Godot 실런타임 캡처">`;
        const image = card.querySelector("img");
        image.addEventListener("error", () => {
          const message = document.createElement("div");
          message.className = "missing-evidence";
          message.textContent = "로컬 Godot 캡처가 없습니다.";
          image.replaceWith(message);
        });
        cards.push(card);
      }
    }
    elements["evidence-grid"].replaceChildren(...cards);
  }

  function advance(seconds) {
    if (!state.playing) return;
    const pair = currentPair();
    const duration = Math.max(pair.horizontal?.combo.life ?? 0.3, pair.vertical?.combo.life ?? 0.3, 0.18);
    state.progress += seconds * state.speed / duration;
    if (state.progress >= 1) state.progress %= 1;
    updateProgressText();
  }

  function frame(timestamp) {
    const delta = state.lastFrameTime ? Math.min((timestamp - state.lastFrameTime) / 1000, 0.05) : 0;
    state.lastFrameTime = timestamp;
    advance(delta);
    render();
    requestAnimationFrame(frame);
  }

  function renderGameToText() {
    if (!state.data) return JSON.stringify({ mode: "loading" });
    const pair = currentPair();
    const targetDepth = clamp(Math.max(pair.horizontal.combo.range, pair.vertical.combo.range) * 0.9, 100, 180);
    const summarize = (row, scale) => {
      const geometry = buildGeometry(row, scale, state.formation, targetDepth);
      const targets = formationPoints(state.formation, targetDepth);
      const predicted = targets.filter((target) => geometry.paths.some((path) => distanceToPath(target, path) <= geometry.hitRadius + 9)).length;
      const live = targets.filter((target) => geometry.paths.some((path) => distanceToPath(target, partialPath(path, state.progress)) <= geometry.hitRadius + 9)).length;
      return {
        axis: row.axis,
        scale,
        archetype: row.combo.orbit_archetype,
        range: Number((row.combo.range * scale).toFixed(2)),
        damage: Number(row.combo.damage.toFixed(3)),
        cooldown: Number(row.combo.cooldown.toFixed(3)),
        progress: Number(state.progress.toFixed(3)),
        liveHits: live,
        predictedHits: predicted,
        status: statusChips(row.combo).map((chip) => chip.label),
      };
    };
    return JSON.stringify({
      mode: state.view,
      coordinateSystem: "origin top-left; +x right; +y down; player anchor is inside each panel",
      selectedWeapon: state.selectedWeapon,
      selectedLabel: labelFor(state.selectedWeapon),
      category: state.category,
      formation: state.formation,
      playing: state.playing,
      speed: state.speed,
      rangeScale: state.rangeScale,
      overlays: { trail: state.showTrail, hit: state.showHit, labels: state.showLabels, lateRetarget: state.lateRetarget },
      compare: [
        summarize(pair.horizontal, 1),
        summarize(pair.vertical, 1),
        summarize(pair.horizontal, state.rangeScale),
        summarize(pair.vertical, state.rangeScale),
      ],
      matrixVisibleCount: [...elements["matrix-grid"].querySelectorAll(".matrix-card")].length,
      totalWeapons: state.data.weapon_order.length,
    });
  }

  window.render_game_to_text = renderGameToText;
  window.advanceTime = (milliseconds) => {
    const wasPlaying = state.playing;
    state.playing = true;
    advance(Math.max(0, milliseconds) / 1000);
    state.playing = false;
    syncPlayButton();
    render();
    return { wasPlaying, progress: state.progress };
  };

  async function boot() {
    collectElements();
    bindControls();
    syncPlayButton();
    try {
      await loadData();
      render();
      requestAnimationFrame(frame);
    } catch (error) {
      console.error(error);
      elements["data-status"].textContent = "데이터 오류";
      elements["data-status"].style.color = "#ff657a";
    }
  }

  boot();
})();
