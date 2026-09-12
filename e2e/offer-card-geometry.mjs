'use strict';

// Shared by the CI browser test and local in-app browser verification. This
// reads rendered geometry; no CSS declaration or hardcoded height can pass it.
export function offerCardGeometry() {
  const cards = [...document.querySelectorAll('#notary-open-list .nc-agenda-grid > .nc-card')];
  return cards.map(card => {
    const box = card.getBoundingClientRect();
    const actions = card.querySelector('.nc-card-actions');
    const footer = actions && actions.getBoundingClientRect();
    return {
      id: card.dataset.id, width: box.width, height: box.height,
      bottomInset: footer ? box.bottom - footer.bottom : null,
      overflow: card.scrollWidth > card.clientWidth + 1,
    };
  });
}

export function assertUniformOfferCards(cards) {
  if (cards.length < 2) throw new Error('Need at least two offers to compare');
  const spread = values => Math.max(...values) - Math.min(...values);
  for (const dimension of ['width', 'height']) {
    if (spread(cards.map(card => card[dimension])) > .75) {
      throw new Error('Offers have different ' + dimension + ': ' + JSON.stringify(cards));
    }
  }
  const insets = cards.map(card => card.bottomInset).filter(value => value != null);
  if (insets.length && spread(insets) > .75) throw new Error('Offer actions do not align at the foot: ' + JSON.stringify(cards));
  if (cards.some(card => card.overflow)) throw new Error('Offer content overflows: ' + JSON.stringify(cards));
}
