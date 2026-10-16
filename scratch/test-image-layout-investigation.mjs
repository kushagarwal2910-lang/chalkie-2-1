import { applyElkLayout } from '../lib/elk-spatial-layout.ts';
import { compileTeachingPlan } from '../lib/lesson-v2.ts';
import { layoutTeachingScene, boardTextLines, boardFontSize } from '../lib/teaching-layout.ts';

const planWithImage = {
  title: 'Pancreas and Islets',
  summary: 'Visual reference of islets and beta cells',
  teachingMode: 'reference',
  coverage: 'append',
  nodes: [
    { id: 'pancreas-img', label: 'Pancreas histology showing islets of Langerhans', kind: 'image', imageQuery: 'pancreas islets histology', regions: ['islet', 'acinar'] },
    { id: 'beta-cell-note', label: 'Beta cells make up about 70% of the islet and synthesize insulin.', kind: 'text', imageQuery: '', regions: [] },
    { id: 'alpha-cell-note', label: 'Alpha cells produce glucagon to raise blood glucose.', kind: 'text', imageQuery: '', regions: [] }
  ],
  links: [
    { from: 'pancreas-img', to: 'beta-cell-note', label: 'details' },
    { from: 'pancreas-img', to: 'alpha-cell-note', label: 'contrasts' }
  ],
  steps: [
    { title: 'Histology', narration: 'Look at the pancreatic histology.', targetIds: ['pancreas-img'] },
    { title: 'Endocrine cells', narration: 'Inside are beta and alpha cells.', targetIds: ['beta-cell-note', 'alpha-cell-note'] }
  ]
};

const lesson = compileTeachingPlan(planWithImage, 'Show pancreatic islets', []);
// Simulate attached image asset
lesson.objects[0].image = {
  id: 'img-123',
  title: 'Histology',
  url: 'https://example.com/img.jpg',
  sourceUrl: 'https://example.com',
  author: 'Author',
  license: 'CC',
  licenseUrl: 'https://example.com',
  width: 800,
  height: 600,
  regions: []
};

console.log('--- COMPILED OBJECTS ---');
for (const o of lesson.objects) {
  console.log(`${o.id} (${o.shapeType}): initial w=${o.width}, h=${o.height}`);
}

console.log('\n--- layoutTeachingScene OUTPUT ---');
const teachingLaid = layoutTeachingScene(lesson);
for (const o of teachingLaid.objects) {
  console.log(`  ${o.id}: x=${o.x}, y=${o.y}, w=${o.width}, h=${o.height}`);
}
for (const c of teachingLaid.connections) {
  console.log(`  connection ${c.id}: from=${c.from} to=${c.to} points=${JSON.stringify(c.points)}`);
}

console.log('\n--- applyElkLayout OUTPUT ---');
const elkLaid = await applyElkLayout(lesson);
for (const o of elkLaid.objects) {
  console.log(`  ${o.id}: x=${o.x}, y=${o.y}, w=${o.width}, h=${o.height}`);
}
for (const c of elkLaid.connections) {
  console.log(`  connection ${c.id}: from=${c.from} to=${c.to} points=${JSON.stringify(c.points)} labelPos=${JSON.stringify(c.labelPosition)}`);
}
