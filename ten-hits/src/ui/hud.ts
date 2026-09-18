import { POSE_IDS, REQUIRED_VALID_HITS, SHOE_IDS } from '../game/config';
import type { GameSnapshot, PoseId, ShoeId } from '../game/types';

export type ToggleName = 'sound' | 'vibration' | 'shake';

export interface HudSelection {
  pose: PoseId;
  shoe: ShoeId;
  power: number;
}

export interface HudHandlers {
  onStart?: (selection: HudSelection) => void;
  onRestart?: () => void;
  onToggle?: (name: ToggleName, enabled: boolean) => void;
}

export interface HudController {
  render(snapshot: GameSnapshot): void;
  setToggles(state: Record<ToggleName, boolean>): void;
  selection(): HudSelection;
  destroy(): void;
}

const POSE_LABELS: Record<PoseId, string> = {
  'standing-front': '서서 정면',
  'kneeling-front': '무릎 정면'
};

const SHOE_LABELS: Record<ShoeId, string> = {
  pump: '펌프스 pump',
  stiletto: '스틸레토 stiletto',
  platform: '플랫폼 platform'
};

const MOOD_LABELS: Record<GameSnapshot['angerMood'], string> = {
  calm: '침착',
  annoyed: '언짢음',
  irritated: '짜증',
  furious: '격노',
  seething: '폭발 직전'
};

const TOGGLE_LABELS: Record<ToggleName, string> = {
  sound: '소리',
  vibration: '진동',
  shake: '화면 흔들림'
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Builds the interface once and then only mutates attributes, so repeated
 * renders never churn the DOM. Damage is communicated with shape and color
 * classes; the HUD has no place to print a durability number.
 */
export function createHud(root: HTMLElement, handlers: HudHandlers): HudController {
  const layer = el('div', 'hud');

  // --- progress dots and mood --------------------------------------------
  const top = el('header', 'hud__top');
  const dotsWrap = el('div', 'hud__dots');
  dotsWrap.setAttribute('role', 'img');
  dotsWrap.setAttribute('aria-label', '유효 접촉 진행 상황');
  const dots: HTMLElement[] = [];
  for (let i = 0; i < REQUIRED_VALID_HITS; i += 1) {
    const dot = el('span', 'hud__dot');
    dot.setAttribute('data-hit-dot', String(i));
    dotsWrap.append(dot);
    dots.push(dot);
  }

  const anger = el('div', 'hud__anger');
  anger.setAttribute('data-anger', '');
  anger.setAttribute('data-mood', 'calm');
  const angerFace = el('div', 'hud__anger-face');
  const angerText = el('span', 'hud__anger-text');
  anger.append(angerFace, angerText);
  top.append(dotsWrap, anger);

  // --- proxy feedback panel ----------------------------------------------
  const proxyPanel = el('aside', 'hud__proxies');
  proxyPanel.setAttribute('aria-label', '충격 상태 표시');
  const proxyNodes = (['left', 'right'] as const).map((side) => {
    const node = el('div', 'hud__proxy');
    node.setAttribute('data-proxy', side);
    node.setAttribute('data-stage', 'normal');
    const shell = el('div', 'hud__proxy-shell');
    const crack = el('div', 'hud__proxy-crack');
    node.append(shell, crack);
    proxyPanel.append(node);
    return node;
  });

  // --- setup panel --------------------------------------------------------
  const setup = el('section', 'hud__setup');
  setup.setAttribute('data-setup-panel', '');

  const title = el('h1', 'hud__title');
  title.textContent = 'TEN HITS';
  const subtitle = el('p', 'hud__subtitle');
  subtitle.textContent = '열 번의 유효 접촉을 스쳐 넘기고 버티세요.';

  let selectedPose: PoseId = 'standing-front';
  let selectedShoe: ShoeId = 'pump';

  const poseGroup = el('div', 'hud__group');
  poseGroup.setAttribute('role', 'group');
  poseGroup.setAttribute('aria-label', '자세 선택');
  const poseButtons = POSE_IDS.map((id) => {
    const button = el('button', 'hud__chip');
    button.type = 'button';
    button.setAttribute('data-pose-option', id);
    button.textContent = POSE_LABELS[id];
    button.addEventListener('click', () => {
      selectedPose = id;
      syncChoices();
    });
    poseGroup.append(button);
    return button;
  });

  const shoeGroup = el('div', 'hud__group');
  shoeGroup.setAttribute('role', 'group');
  shoeGroup.setAttribute('aria-label', '신발 선택');
  const shoeButtons = SHOE_IDS.map((id) => {
    const button = el('button', 'hud__chip');
    button.type = 'button';
    button.setAttribute('data-shoe-option', id);
    button.textContent = SHOE_LABELS[id];
    button.addEventListener('click', () => {
      selectedShoe = id;
      syncChoices();
    });
    shoeGroup.append(button);
    return button;
  });

  const powerRow = el('div', 'hud__group hud__group--power');
  const powerLabel = el('label', 'hud__label');
  powerLabel.textContent = '강도';
  powerLabel.htmlFor = 'ten-hits-power';
  const power = el('input', 'hud__power');
  power.type = 'range';
  power.id = 'ten-hits-power';
  power.setAttribute('data-power-input', '');
  power.min = '1';
  power.max = '10';
  power.step = '1';
  power.value = '4';
  const powerValue = el('output', 'hud__power-value');
  powerValue.textContent = '4';
  power.addEventListener('input', () => {
    powerValue.textContent = power.value;
  });
  powerRow.append(powerLabel, power, powerValue);

  const toggleRow = el('div', 'hud__group hud__group--toggles');
  const toggleState: Record<ToggleName, boolean> = {
    sound: true,
    vibration: true,
    shake: true
  };
  const toggleButtons = (Object.keys(TOGGLE_LABELS) as ToggleName[]).map((name) => {
    const button = el('button', 'hud__toggle');
    button.type = 'button';
    button.setAttribute('data-toggle', name);
    button.setAttribute('aria-pressed', 'true');
    button.textContent = TOGGLE_LABELS[name];
    button.addEventListener('click', () => {
      toggleState[name] = !toggleState[name];
      button.setAttribute('aria-pressed', String(toggleState[name]));
      handlers.onToggle?.(name, toggleState[name]);
    });
    toggleRow.append(button);
    return button;
  });

  const startButton = el('button', 'hud__start');
  startButton.type = 'button';
  startButton.setAttribute('data-start', '');
  startButton.textContent = '시작';
  startButton.addEventListener('click', () => {
    handlers.onStart?.(currentSelection());
  });

  setup.append(title, subtitle, poseGroup, shoeGroup, powerRow, toggleRow, startButton);

  // --- result -------------------------------------------------------------
  const result = el('section', 'hud__result');
  result.setAttribute('data-result', '');
  result.setAttribute('data-outcome', 'in-progress');
  result.hidden = true;
  const resultTitle = el('h2', 'hud__result-title');
  const resultDetail = el('p', 'hud__result-detail');
  const retry = el('button', 'hud__start');
  retry.type = 'button';
  retry.setAttribute('data-retry', '');
  retry.textContent = '다시 도전';
  retry.addEventListener('click', () => handlers.onRestart?.());
  result.append(resultTitle, resultDetail, retry);

  const hint = el('p', 'hud__hint');
  hint.setAttribute('data-hint', '');
  hint.textContent = '한 손가락으로 끌어 피하고, 두 손가락으로 시점을 돌립니다.';

  layer.append(top, proxyPanel, setup, result, hint);
  root.append(layer);

  function currentSelection(): HudSelection {
    return {
      pose: selectedPose,
      shoe: selectedShoe,
      power: Number(power.value)
    };
  }

  function syncChoices(): void {
    poseButtons.forEach((button, index) => {
      const active = POSE_IDS[index] === selectedPose;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
    shoeButtons.forEach((button, index) => {
      const active = SHOE_IDS[index] === selectedShoe;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
  }
  syncChoices();

  let popTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPhase: GameSnapshot['phase'] = 'setup';

  return {
    render(snapshot: GameSnapshot): void {
      const playing = snapshot.phase !== 'setup';
      const finished = snapshot.phase === 'won' || snapshot.phase === 'lost';

      setup.hidden = playing;
      top.hidden = !playing;
      proxyPanel.hidden = !playing;
      hint.hidden = playing && snapshot.phase !== 'telegraph';

      dots.forEach((dot, index) => {
        dot.classList.toggle('is-filled', snapshot.hitDots[index] === true);
      });

      anger.setAttribute('data-mood', snapshot.angerMood);
      angerText.textContent = MOOD_LABELS[snapshot.angerMood];

      proxyNodes.forEach((node, index) => {
        const proxy = snapshot.proxies[index];
        if (!proxy) return;
        node.setAttribute('data-stage', proxy.stage);
        node.style.setProperty('--squash', proxy.squash.toFixed(3));
        node.style.setProperty('--crack', proxy.cracking.toFixed(3));
      });

      // A short enlargement marks the contact without printing anything.
      if (snapshot.phase === 'impact' && lastPhase !== 'impact') {
        proxyPanel.classList.add('is-popping');
        if (popTimer) clearTimeout(popTimer);
        popTimer = setTimeout(() => proxyPanel.classList.remove('is-popping'), 500);
      }
      lastPhase = snapshot.phase;

      result.hidden = !finished;
      if (finished) {
        result.setAttribute('data-outcome', snapshot.result);
        resultTitle.textContent =
          snapshot.result === 'survived' ? '버텨냈습니다' : '버티지 못했습니다';
        resultDetail.textContent = `${POSE_LABELS[snapshot.pose]} · ${SHOE_LABELS[snapshot.shoe]} · 강도 ${snapshot.power}`;
      }
    },

    setToggles(state: Record<ToggleName, boolean>): void {
      toggleButtons.forEach((button) => {
        const name = button.getAttribute('data-toggle') as ToggleName;
        toggleState[name] = state[name];
        button.setAttribute('aria-pressed', String(state[name]));
      });
    },

    selection: currentSelection,

    destroy(): void {
      if (popTimer) clearTimeout(popTimer);
      layer.remove();
    }
  };
}
