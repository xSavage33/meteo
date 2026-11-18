'use strict';

(() => {
  const deck = document.getElementById('deck');
  const slides = Array.from(deck.querySelectorAll('.slide'));
  const dots = document.getElementById('dots');
  const cnt = document.getElementById('cnt');
  const total = slides.length;
  const pad = (n) => String(n).padStart(2, '0');
  let i = 0;

  slides.forEach((s, k) => {
    const n = s.querySelector('.num');
    if (n) n.textContent = pad(k + 1) + ' / ' + pad(total);

    const d = document.createElement('button');
    d.setAttribute('aria-label', 'Ir a la diapositiva ' + (k + 1));
    d.addEventListener('click', (e) => { e.stopPropagation(); go(k); });
    dots.appendChild(d);
  });

  function go(k) {
    i = Math.max(0, Math.min(total - 1, k));
    slides.forEach((s, j) => s.classList.toggle('act', j === i));
    Array.from(dots.children).forEach((d, j) => d.classList.toggle('a', j === i));
    cnt.textContent = (i + 1) + ' / ' + total;
    history.replaceState(null, '', '#' + (i + 1));
  }

  deck.classList.add('on');

  // Clic en la diapositiva: tercio izquierdo retrocede, resto avanza.
  // Los enlaces (boton de demo) funcionan normalmente.
  deck.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const r = deck.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 3 ? i - 1 : i + 1);
  });

  document.getElementById('prev').addEventListener('click', () => go(i - 1));
  document.getElementById('next').addEventListener('click', () => go(i + 1));

  document.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(i + 1); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(i - 1); }
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(total - 1);
  });

  // Permite abrir directo una diapositiva: /presentacion/#13
  const inicial = parseInt(location.hash.replace('#', ''), 10);
  go(Number.isInteger(inicial) ? inicial - 1 : 0);
})();
