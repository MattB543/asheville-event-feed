// Buncombe gazetteer prototype: towns, neighborhoods, landmarks/institutions that pin a story to Buncombe.
const TERMS = [
  'asheville', 'avl', 'buncombe', 'black mountain', 'weaverville', 'woodfin', 'montreat',
  'biltmore forest', 'biltmore village', 'biltmore park', 'biltmore estate', 'swannanoa',
  'fairview', 'candler', 'leicester', 'arden', 'enka', 'barnardsville', 'alexander',
  'west asheville', 'montford', 'kenilworth', 'haw creek', 'oakley', 'shiloh',
  'river arts district', 'south slope', 'north fork', 'bee tree', 'unca', 'unc asheville',
  'a-b tech', 'ab tech', 'mission hospital', 'mission health', 'french broad', 'beaver lake',
  'haywood road', 'tunnel road', 'hendersonville road', 'patton avenue', 'merrimon',
  'reynolds mountain', 'riceville', 'royal pines', 'skyland', 'beaverdam', 'burton street',
  'deaverview', 'pisgah view', 'erwin high', 'owen high', 'reynolds high', 'north buncombe',
  't.c. roberson',
];
const rx = new RegExp('\\b(' + TERMS.map((t) => t.replace(/[.]/g, '\\.')).join('|') + ')\\b', 'i');
module.exports = {
  hit: (s) => {
    const m = (s || '').match(rx);
    return m ? m[1] : null;
  },
};
