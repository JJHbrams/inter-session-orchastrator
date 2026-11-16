import {createOfficeSprite} from './office-sprites.js';

const STORAGE_KEY = 'session-rooms.office.display.v1';
const ZONE_ACTION = {reading:'책 읽는 중', research:'자료 보는 중', coding:'만드는 중', terminal:'터미널 보는 중', synthesis:'생각 중', delegating:'정리 중', responding:'생각 중', none:'대기 중'};
const FALLBACK_ANCHORS = {door:[15,80], library:[26,43], development:[57,40], server:[86,53], table:[60,61]};
const activeStates = new Set(['queued', 'running']);
const attentionStates = new Set(['waiting', 'unknown', 'failed']);
const terminalStates = new Set(['completed', 'left']);

const clamp = (number, low, high) => Math.min(high, Math.max(low, number));
const hash = value => [...String(value)].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
const short = (agent) => attentionStates.has(agent.state) ? ({waiting:'확인 대기', unknown:'상태 확인', failed:'연결 확인'}[agent.state]) : terminalStates.has(agent.state) ? '자리로 돌아옴' : ZONE_ACTION[agent.activity] || '대기 중';
const parentSelection = agent => ({sessionId:agent.parentId ? null : agent.sessionId, membershipId:agent.parentId ? null : agent.membershipId, parentId:agent.parentId || null, id:agent.parentId || agent.id});

function targetFor(agent, index, anchors) {
 const zone = terminalStates.has(agent.state) && agent.kind === 'subagent' ? 'door' : attentionStates.has(agent.state) ? 'table' : agent.zone || 'table';
 const [baseX, baseY] = anchors[zone] || FALLBACK_ANCHORS[zone] || FALLBACK_ANCHORS.table;
 const seed = hash(agent.id); const column = index % 5; const row = Math.floor(index / 5);
 const wide = zone === 'table' ? 7.7 : 5.6;
 return {x:clamp(baseX + (column - 2) * wide + ((seed % 7) - 3) * .35, 5, 95), y:clamp(baseY + row * 6 + ((seed >> 3) % 5) * .4, 7, 92), zone};
}
const routeFor = (from, to) => {
 if (!from || from.zone === to.zone) return [to];
 const aisle = {foyer:{x:30,y:76}, back:{x:65,y:49}, front:{x:70,y:88}, right:{x:78,y:59}};
 const route = from.zone === 'door' || to.zone === 'door' ? [aisle.foyer] : [];
 if (['library','development'].includes(from.zone) && ['server','table'].includes(to.zone)) route.push(aisle.back);
 if (['server','development'].includes(from.zone) && ['library','table'].includes(to.zone)) route.push(aisle.right, aisle.back);
 if (to.zone === 'table') route.push(aisle.front);
 return [...route, to];
};

export function createAgentOffice({document, host, onSelect, storage = globalThis.localStorage, matchMedia = globalThis.matchMedia?.bind(globalThis)} = {}) {
 if (!document || !host) throw new Error('createAgentOffice requires document and host');
 const saved = (() => { try { return JSON.parse(storage?.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();
 let snapshot = {agents:[]}, roomId, online = true, destroyed = false, expanded = Boolean(saved.expanded), collapsed = Boolean(saved.collapsed), raf = 0, visible = !document.hidden;
 const journeys = new Map();
 const reduced = matchMedia?.('(prefers-reduced-motion: reduce)');
 const root = document.createElement('section'); root.className = 'agent-office'; root.dataset.expanded = String(expanded); root.dataset.collapsed = String(collapsed);
 root.setAttribute('aria-label', '에이전트 오피스');
 const header = document.createElement('header'); header.className = 'office-header';
 const title = document.createElement('div'); title.innerHTML = '<span class="office-pip"></span><strong>작업실</strong><small></small>';
 const controls = document.createElement('div'); controls.className = 'office-controls';
 const toggle = document.createElement('button'); toggle.type = 'button';
 const size = document.createElement('button'); size.type = 'button';
 controls.append(size, toggle); header.append(title, controls);
 const scene = document.createElement('div'); scene.className = 'office-scene'; scene.setAttribute('role', 'list');
 const background = document.createElement('img'); background.className = 'office-background'; background.src = '/assets/office/office-background.png'; background.alt = ''; background.draggable = false; scene.append(background);
 const overlay = document.createElement('div'); overlay.className = 'office-sprite-layer'; scene.append(overlay);
 const fallback = document.createElement('p'); fallback.className = 'office-empty'; fallback.textContent = '참여한 세션이 여기 나타나요.'; scene.append(fallback);
 root.append(header, scene); host.replaceChildren(root);
 const persist = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify({expanded, collapsed})); } catch {} };
 const updateControls = () => { root.dataset.expanded = String(expanded); root.dataset.collapsed = String(collapsed); toggle.textContent = collapsed ? '펼치기' : '접기'; toggle.setAttribute('aria-expanded', String(!collapsed)); size.textContent = expanded ? '작게' : '크게'; size.hidden = collapsed; };
 toggle.onclick = () => { collapsed = !collapsed; persist(); updateControls(); schedule(); };
 size.onclick = () => { expanded = !expanded; persist(); updateControls(); };
 const animate = () => { raf = 0; if (destroyed || collapsed || !visible || reduced?.matches) return; const now = performance.now();
  for (const [id, trip] of journeys) { const node = overlay.querySelector(`[data-agent-id="${CSS.escape(id)}"]`); if (!node) { journeys.delete(id); continue; } const point = trip.points[trip.index], fraction = Math.min(1,(now-trip.started)/360), x = trip.from.x+(point.x-trip.from.x)*fraction, y = trip.from.y+(point.y-trip.from.y)*fraction; node.style.transform = `translate(${x}%, ${y}%)`; if (fraction === 1) { trip.from=point; trip.index++; trip.started=now; if (trip.index===trip.points.length) journeys.delete(id); } }
  if (journeys.size) raf = requestAnimationFrame(animate); };
 const schedule = () => { if (!raf && journeys.size && !destroyed && !collapsed && visible && !reduced?.matches) raf = requestAnimationFrame(animate); };
 const onVisibility = () => { visible = !document.hidden; if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; } else schedule(); };
 document.addEventListener('visibilitychange', onVisibility);
 reduced?.addEventListener?.('change', schedule);
 function render() {
  if (destroyed) return; const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  title.querySelector('small').textContent = online ? `${agents.length}명 · ${agents.filter(a => activeStates.has(a.state)).length} 작업 중` : '연결 확인 중';
  root.dataset.online = String(online); fallback.hidden = agents.length > 0;
  const anchors = {...FALLBACK_ANCHORS, ...(snapshot.anchors || {})}; const active = new Set();
  agents.slice(0, 25).forEach((agent, index) => {
   active.add(agent.id); let node = overlay.querySelector(`[data-agent-id="${CSS.escape(agent.id)}"]`);
   const target = targetFor(agent, index, anchors);
   if (!node) { node = document.createElement('button'); node.type = 'button'; node.className = 'office-agent'; node.dataset.agentId = agent.id; node.setAttribute('role', 'listitem'); node.onclick = () => onSelect?.(parentSelection(agent)); overlay.append(node); }
   const prior = {x:Number(node.dataset.x), y:Number(node.dataset.y), zone:node.dataset.zone};
   node.dataset.x = String(target.x); node.dataset.y = String(target.y); node.dataset.state = agent.state; node.dataset.zone = target.zone; node.dataset.provider = agent.provider;
   node.classList.toggle('office-child', agent.kind === 'subagent'); node.classList.toggle('office-working', activeStates.has(agent.state)); node.classList.toggle('office-attention', attentionStates.has(agent.state)); node.classList.toggle('office-exiting', terminalStates.has(agent.state) && agent.kind === 'subagent');
   node.setAttribute('aria-label', `${agent.label || '이름 없는 세션'} · ${short(agent)}`); node.replaceChildren(createOfficeSprite(document, agent.provider), (() => { const label = document.createElement('span'); label.className = 'office-agent-label'; label.textContent = agent.label || '세션'; return label; })(), (() => { const detail = document.createElement('small'); detail.textContent = short(agent); return detail; })());
   if (Number.isFinite(prior.x) && !reduced?.matches && (prior.x !== target.x || prior.y !== target.y)) journeys.set(agent.id,{from:prior,points:routeFor(prior,target),index:0,started:performance.now()});
   else node.style.transform = `translate(${target.x}%, ${target.y}%)`;
  });
  overlay.querySelectorAll('.office-agent').forEach(node => { if (!active.has(node.dataset.agentId)) { journeys.delete(node.dataset.agentId); node.remove(); } }); schedule();
 }
 updateControls(); render();
 return {setSnapshot(next = {}) { snapshot = next; render(); }, setRoom(next) { roomId = next; snapshot = {agents:[]}; render(); }, setConnection(next) { online = Boolean(next); render(); }, destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVisibility); reduced?.removeEventListener?.('change', schedule); root.remove(); }};
}
