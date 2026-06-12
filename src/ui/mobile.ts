// Mobile mode: touch detection + a phone-sized HUD. The desktop side-panel
// columns collapse into a tabbed bottom sheet (NOW / WEEK / DATA / EXPLORE) so
// every readout stays reachable without permanently covering the globe. Each
// tab carries a UI mode: picking NOW/WEEK/DATA pins the app to wall-clock now,
// EXPLORE reveals the timeline + transport. Layout rules live in hud.css under
// `body.mobile`.

import type { UiMode } from '../main';

export function isMobileDevice(): boolean {
  const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  // min of both screen dims so the answer is stable across rotation;
  // tablets wider than ~820px get the full desktop layout
  const small = Math.min(screen.width, screen.height) <= 820;
  return coarse && small;
}

const TABS: Array<{ id: string; label: string; mode: UiMode; panels: string[] }> = [
  { id: 'now', label: 'NOW', mode: 'now', panels: ['now-panel', 'next24-panel', 'history-panel'] },
  { id: 'week', label: 'WEEK', mode: 'now', panels: ['week-panel'] },
  { id: 'data', label: 'DATA', mode: 'now', panels: ['kp-panel', 'xray-panel', 'flares-panel'] },
  { id: 'xpl', label: 'EXPLORE', mode: 'explore', panels: ['scenario-panel', 'log-panel', 'cycle-panel'] },
];

export interface MobileDeps {
  setMode(m: UiMode): void;
  getMode(): UiMode;
}

export interface MobileUi {
  /** Keep the tab state consistent when the mode is changed from outside (boot, URL params). */
  syncMode(m: UiMode): void;
}

/** Rebuild the HUD for touch. No-op (returns null) on non-mobile devices. */
export function mountMobileUI(deps: MobileDeps): MobileUi | null {
  if (!isMobileDevice()) return null;
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
    // a tab carries a mode; closing the sheet leaves the mode unchanged
    const tab = TABS.find((t) => t.id === id);
    if (tab && deps.getMode() !== tab.mode) deps.setMode(tab.mode);
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

  return {
    syncMode(m: UiMode): void {
      const activeTab = TABS.find((t) => t.id === active);
      if (m === 'now') {
        // boot / return to now: lead with the verdict sheet
        if (!activeTab || activeTab.mode !== 'now') select('now');
      } else if (activeTab && activeTab.mode !== 'explore') {
        select(null); // explore from outside (e.g. ?scenario): show globe + timeline
      }
    },
  };
}
