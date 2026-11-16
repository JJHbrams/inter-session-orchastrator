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
  : '<g class="sprite-limbs"><path d="M20 45c-8 2-10 8-13 11M44 45c8 2 10 8 13 11M25 51l-3 9M39 51l3 9"/></g><g class="sprite-rosette"><path d="M32 31c-9-12-20-2-13 7 7 9 20 0 13-7z"/><path transform="rotate(60 32 31)" d="M32 31c-9-12-20-2-13 7 7 9 20 0 13-7z"/><path transform="rotate(120 32 31)" d="M32 31c-9-12-20-2-13 7 7 9 20 0 13-7z"/><path transform="rotate(180 32 31)" d="M32 31c-9-12-20-2-13 7 7 9 20 0 13-7z"/><path transform="rotate(240 32 31)" d="M32 31c-9-12-20-2-13 7 7 9 20 0 13-7z"/><path transform="rotate(300 32 31)" d="M32 31c-9-12-20-2-13 7 7 9 20 0 13-7z"/></g><circle class="sprite-eye" cx="27" cy="34" r="2.5"/><circle class="sprite-eye" cx="37" cy="34" r="2.5"/><path class="sprite-smile" d="M27 40q5 4 10 0"/>';
 return svg(document, isClaude ? 'claude' : provider === 'codex' ? 'codex' : 'other', art);
}
