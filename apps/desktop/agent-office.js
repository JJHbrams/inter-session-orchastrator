import {createOfficePixiScene} from './office-pixi-scene.js';

const DISPLAY_KEY = 'session-rooms.office.display.v1';
const readPreferences = storage => { try { return JSON.parse(storage?.getItem(DISPLAY_KEY) || '{}'); } catch { return {}; } };

export function createAgentOffice({document, host, onSelect, storage = globalThis.localStorage, matchMedia = globalThis.matchMedia?.bind(globalThis), sceneFactory = createOfficePixiScene, loadPixi} = {}) {
  if (!document || !host) throw Error('createAgentOffice requires document and host');
  const saved = readPreferences(storage);
  let expanded = !!saved.expanded, collapsed = !!saved.collapsed, visible = !document.hidden, connected = true, destroyed = false, queued = [], sceneReady = false;
  const reducedMotion = matchMedia?.('(prefers-reduced-motion: reduce)');
  const root = document.createElement('section'); root.className = 'agent-office'; root.setAttribute('aria-label', '에이전트 오피스');
  const header = document.createElement('header'); header.className = 'office-header';
  const title = document.createElement('div'); title.innerHTML = '<span class="office-pip"></span><strong>작업실</strong><small>0명</small>';
  const status = title.querySelector('small'), controls = document.createElement('div'); controls.className = 'office-controls';
  const cards = document.createElement('button'); cards.type = 'button'; cards.textContent = '세션 카드';
  const size = document.createElement('button'); size.type = 'button';
  const toggle = document.createElement('button'); toggle.type = 'button'; controls.append(cards, size, toggle); header.append(title, controls);
  const scene = document.createElement('div'); scene.className = 'office-scene'; scene.setAttribute('role', 'group');
  const artboard = document.createElement('div'); artboard.className = 'office-artboard';
  const empty = document.createElement('p'); empty.className = 'office-empty'; empty.textContent = '참여한 세션이 여기 나타나요.'; scene.append(artboard, empty); root.append(header, scene); host.replaceChildren(root);
  const persist = () => { try { storage?.setItem(DISPLAY_KEY, JSON.stringify({expanded, collapsed})); } catch {} };
  const presentation = () => ({collapsed, expanded, visible, reducedMotion: !!reducedMotion?.matches});
  const setHeader = ({visibleCount = 0, workingCount = 0, error} = {}) => { status.textContent = !connected ? '연결 확인 중' : error ? '표시 오류' : `${visibleCount}명${workingCount ? ` · ${workingCount} 작업 중` : ''}`; };
  const renderShell = () => { root.dataset.expanded = String(expanded); root.dataset.collapsed = String(collapsed); root.dataset.online = String(connected); toggle.textContent = collapsed ? '펼치기' : '접기'; toggle.setAttribute('aria-expanded', String(!collapsed)); size.textContent = expanded ? '작게' : '크게'; size.hidden = collapsed; cards.setAttribute('aria-pressed', String(!!host.closest('.workspace')?.classList.contains('office-cards-visible'))); };
  let sceneController;
  const dispatch = (method, ...args) => { if (destroyed) return; if (!sceneReady) { queued.push([method, args]); return; } sceneController?.[method]?.(...args); };
  const onStatus = next => { if (destroyed) return; const info = next || {}; empty.hidden = !info.error && (info.visibleCount || 0) > 0; empty.textContent = info.error ? '작업실을 표시할 수 없어요.' : '참여한 세션이 여기 나타나요.'; setHeader(info); };
  const applyPresentation = () => dispatch('setPresentation', presentation());
  const onVisibilityChange = () => { visible = !document.hidden; applyPresentation(); };
  const onReducedMotionChange = () => applyPresentation();
  cards.onclick = () => { const workspace = host.closest('.workspace'); if (workspace) cards.setAttribute('aria-pressed', String(workspace.classList.toggle('office-cards-visible'))); };
  toggle.onclick = () => { collapsed = !collapsed; persist(); renderShell(); applyPresentation(); };
  size.onclick = () => { expanded = !expanded; persist(); renderShell(); applyPresentation(); };
  document.addEventListener('visibilitychange', onVisibilityChange); reducedMotion?.addEventListener?.('change', onReducedMotionChange); renderShell();
  try { sceneController = sceneFactory({document, host: artboard, onSelect, onStatus, loadPixi}); } catch (error) { onStatus({error}); }
  applyPresentation();
  const readyPromise = Promise.resolve(sceneController?.readyPromise).then(() => { if (destroyed || !sceneController) return; sceneReady = true; const pending = queued; queued = []; pending.forEach(([method, args]) => sceneController?.[method]?.(...args)); }).catch(error => onStatus({error}));
  return {readyPromise, setSnapshot(next = {}) { const count = Array.isArray(next.agents) ? next.agents.length : 0; if (!count) onStatus({visibleCount: 0, workingCount: 0}); dispatch('setSnapshot', next); }, setRoom(id) { onStatus({visibleCount: 0, workingCount: 0}); dispatch('setRoom', id); }, setConnection(next) { connected = !!next; setHeader(); dispatch('setConnection', connected); applyPresentation(); }, destroy() { if (destroyed) return; destroyed = true; queued = []; document.removeEventListener('visibilitychange', onVisibilityChange); reducedMotion?.removeEventListener?.('change', onReducedMotionChange); sceneController?.destroy?.(); root.remove(); }};
}
