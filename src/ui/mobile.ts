// Mobile mode: touch detection + a phone-sized HUD. The desktop side-panel
// columns collapse into a tabbed bottom sheet (DATA / LOG / SCENARIOS) so every
// readout stays reachable without permanently covering the globe. Layout rules
// live in hud.css under `body.mobile`.

export function isMobileDevice(): boolean {
  const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  // min of both screen dims so the answer is stable across rotation;
  // tablets wider than ~820px get the full desktop layout
  const small = Math.min(screen.width, screen.height) <= 820;
  return coarse && small;
}

const TABS: Array<{ id: string; label: string; panels: string[] }> = [
  { id: 'data', label: 'DATA', panels: ['kp-panel', 'xray-panel', 'flares-panel'] },
  { id: 'log', label: 'LOG', panels: ['log-panel', 'cycle-panel'] },
  { id: 'scn', label: 'SCENARIOS', panels: ['scenario-panel'] },
];

/** Rebuild the HUD for touch. No-op (returns false) on non-mobile devices. */
export function mountMobileUI(): boolean {
  if (!isMobileDevice()) return false;
  document.body.classList.add('mobile');

  const bottom = document.getElementById('bottom')!;
  const tabbar = document.createElement('div');
  tabbar.id = 'mobile-tabs';
  const sheet = document.createElement('div');
  sheet.id = 'mobile-sheet';

  let active: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  const select = (id: string | null) => {
    active = id;
    for (const tab of TABS) {
      const on = tab.id === id;
      buttons.get(tab.id)!.classList.toggle('active', on);
      for (const pid of tab.panels) {
        (document.getElementById(pid) as HTMLElement).style.display = on ? '' : 'none';
      }
    }
    sheet.classList.toggle('open', id !== null);
  };

  for (const tab of TABS) {
    const b = document.createElement('button');
    b.textContent = tab.label;
    b.addEventListener('click', () => select(active === tab.id ? null : tab.id));
    buttons.set(tab.id, b);
    tabbar.appendChild(b);
    for (const pid of tab.panels) sheet.appendChild(document.getElementById(pid)!);
  }

  bottom.prepend(sheet);
  bottom.prepend(tabbar);
  select(null);

  // launching a scenario should reveal the globe again
  document.getElementById('scenario-buttons')!.addEventListener('click', (e) => {
    if (e.target instanceof HTMLButtonElement) select(null);
  });

  return true;
}
