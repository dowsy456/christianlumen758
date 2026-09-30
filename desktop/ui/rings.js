'use strict';
const cards = new Map(), host = document.getElementById('rings');
let layoutFrame = 0;
const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    window.ringPopup.layout([...cards].filter(([, card]) => !card.leaving).map(([id, card]) => ({ id, bounds: rect(card.root), buttons: [...card.root.querySelectorAll('button')].map(rect) })));
  });
}
window.ringPopup.onHover(({ id, button }) => {
  for (const [key, card] of cards) card.root.classList.toggle('pointer-through', key === id && !button);
});
window.addEventListener('mousemove', event => window.ringPopup.pointer({ x: event.clientX, y: event.clientY }));
window.addEventListener('resize', scheduleLayout);
host.addEventListener('scroll', scheduleLayout, { passive: true });
host.addEventListener('animationend', scheduleLayout);
new ResizeObserver(scheduleLayout).observe(host);
// Both reference controls use the same solid, horizontal telephone receiver.
const PHONE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.2 12.2c5.4-5.2 14.2-5.2 19.6 0a1.3 1.3 0 0 1 0 1.8l-2 2a1.2 1.2 0 0 1-1.7 0l-2.5-2.3a1.2 1.2 0 0 1-.3-1.2l.3-1a12.2 12.2 0 0 0-7.2 0l.3 1a1.2 1.2 0 0 1-.3 1.2L5.9 16a1.2 1.2 0 0 1-1.7 0l-2-2a1.3 1.3 0 0 1 0-1.8Z"/></svg>';
window.ringPopup.onState(({ rings = [] }) => {
  const wanted = new Set(rings.map(ring => ring.id));
  for (const [id, card] of cards) if (!wanted.has(id) && !card.leaving) {
    card.leaving = true; card.root.classList.add('leaving');
    card.timer = setTimeout(() => { if (card.leaving) { card.root.remove(); cards.delete(id); scheduleLayout(); } }, 200);
  }
  for (const ring of rings) {
    let card = cards.get(ring.id);
    if (!card) {
      const root = document.createElement('section'); root.className = 'ring';
      const name = document.createElement('div'); name.className = 'name';
      const icon = document.createElement('div'); icon.className = 'room-icon';
      const controls = document.createElement('div'); controls.className = 'controls';
      for (const [action, title] of [['decline', 'Decline Call'], ['join', 'Join Call']]) {
        const button = document.createElement('button'); button.className = `control ${action}`; button.type = 'button'; button.title = title; button.setAttribute('aria-label', title); button.innerHTML = PHONE;
        button.addEventListener('click', async () => {
          if (card?.leaving || root.dataset.answering) return;
          root.dataset.answering = action;
          try {
            const accepted = await window.ringPopup.command({ action, id: ring.id, roomId: ring.roomId });
            if (!accepted) button.title = 'This call is no longer available.';
          }
          catch { button.title = 'Unable to answer. Please try again.'; }
          finally { delete root.dataset.answering; }
        }); controls.appendChild(button);
      }
      root.append(name, icon, controls); host.appendChild(root); card = { root, name, icon }; cards.set(ring.id, card);
    }
    clearTimeout(card.timer); card.leaving = false; card.root.classList.remove('leaving');
    card.name.textContent = ring.roomName; card.name.title = ring.roomName;
    if (card.image !== ring.roomIcon) {
      card.image = ring.roomIcon; card.icon.replaceChildren();
      if (ring.roomIcon) { const image = document.createElement('img'); image.alt = ''; image.src = ring.roomIcon; card.icon.appendChild(image); } else card.icon.textContent = ring.roomName.slice(0, 1).toUpperCase();
    }
    const image = card.icon.querySelector('img'), transform = ring.roomIconTransform || {};
    if (image) image.style.transform = `translate(${(transform.x || 0) * 100}%, ${(transform.y || 0) * 100}%) scale(${transform.scale || 1})`;
  }
  scheduleLayout();
});
