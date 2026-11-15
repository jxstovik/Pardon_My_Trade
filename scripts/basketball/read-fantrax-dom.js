// Pass this function to the supported browser tool's read-only evaluate API.
// Reads rendered draft-room DOM only. It does not fetch, mutate the page, or read app/session state.
export function readFantraxDraftDom() {
  const text = el => el?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const headers = [...document.querySelectorAll('.league-draft-board__header__item h4')].map(text);
  const columns = [...document.querySelectorAll('.league-draft-board__column')];
  const cells = columns.flatMap((column, columnIndex) => [...column.querySelectorAll('.league-draft-board__item')].map(item => ({
    column: columnIndex, label: text(item.querySelector('mark')), text: text(item),
    playerName: text(item.querySelector('.scorer__info__name')) || null,
    schoolText: text(item.querySelector('.scorer__info__positions')) || null
  })));
  const starting = [...document.querySelectorAll('h5')].some(el => text(el) === 'Starting');
  return {schemaVersion:1, pageUrl:location.href, capturedAt:new Date().toISOString(),
    teamNames:headers, phase:starting?'pre-draft':'unknown', clockSeconds:null, cells,
    limitations:['Rendered DOM only; live phase/clock and selected-cell identity selectors require venue-specific verification.']};
}
