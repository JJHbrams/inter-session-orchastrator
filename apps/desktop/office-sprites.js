const svg = (document, name, paths) => {
 const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
 node.setAttribute('viewBox', '0 0 64 64'); node.setAttribute('aria-hidden', 'true'); node.classList.add('office-sprite-art', `office-sprite-${name}`);
 node.innerHTML = paths; return node;
};

// Deliberately mascot-like rather than humanoid: the colour and silhouette identify
// providers even at the small rendered size.
export function createOfficeSprite(document, provider = 'other') {
 const isClaude = provider === 'claude';
 const art = isClaude
  ? '<g class="sprite-limbs"><path d="M20 43c-8 1-10 8-13 12M44 43c8 1 10 8 13 12M25 51l-3 9M39 51l3 9"/></g><path class="sprite-body" d="M32 5l5 14 14-5-8 13 13 8-15 1 2 15-11-10-11 10 2-15-15-1 13-8-8-13 14 5z"/><circle class="sprite-eye" cx="25" cy="31" r="3"/><circle class="sprite-eye" cx="39" cy="31" r="3"/><path class="sprite-smile" d="M25 39q7 5 14 0"/>'
  : '<g class="sprite-limbs"><path d="M20 44c-8 2-10 8-13 11M44 44c8 2 10 8 13 11M25 50l-3 10M39 50l3 10"/></g><path class="sprite-body" d="M32 8c7-8 13 0 11 7 9-2 12 8 5 12 7 5 2 15-5 13 2 8-8 13-11 5-3 8-13 3-11-5-7 2-12-8-5-13 7-4 5-12 12-10 1-8 11-8 14-1z"/><path class="sprite-knot" d="M21 23c7-6 15 0 11 8-4 8-12 4-8-3 4-7 15-5 16 3 1 8-10 10-13 3"/><circle class="sprite-eye" cx="25" cy="39" r="2.7"/><circle class="sprite-eye" cx="39" cy="39" r="2.7"/><path class="sprite-smile" d="M26 46q6 4 12 0"/>';
 return svg(document, isClaude ? 'claude' : provider === 'codex' ? 'codex' : 'other', art);
}
