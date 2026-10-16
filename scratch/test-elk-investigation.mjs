import { applyElkLayout } from '../lib/elk-spatial-layout.ts';
import { compileTeachingPlan } from '../lib/lesson-v2.ts';
import { layoutTeachingScene, boardTextLines, boardFontSize } from '../lib/teaching-layout.ts';

const plan = {
  title: 'Insulin Production',
  summary: 'How beta cells produce insulin',
  teachingMode: 'concept',
  coverage: 'append',
  nodes: [
    { id: 'islets', label: 'Islets of Langerhans', kind: 'box', imageQuery: '', regions: [] },
    { id: 'beta', label: 'Beta cells secrete insulin directly into capillaries in response to elevated blood glucose levels.', kind: 'text', imageQuery: '', regions: [] },
    { id: 'insulin', label: 'Insulin hormone', kind: 'box', imageQuery: '', regions: [] }
  ],
  links: [
    { from: 'islets', to: 'beta', label: 'contains' },
    { from: 'beta', to: 'insulin', label: 'secretes' }
  ],
  steps: [
    { title: 'Overview', narration: 'The islets of Langerhans contain beta cells.', targetIds: ['islets', 'beta'] },
    { title: 'Secretion', narration: 'Beta cells secrete insulin.', targetIds: ['insulin'] }
  ]
};

const lesson = compileTeachingPlan(plan, 'How does insulin work?', []);
console.log('--- COMPILED OBJECTS ---');
for (const o of lesson.objects) {
  const lines = boardTextLines(o);
  const fontSize = boardFontSize(o);
  const textH = lines.length * fontSize * 1.35 + 20;
  console.log(`${o.id} (${o.shapeType}): initial w=${o.width}, h=${o.height} | actual text lines=${lines.length}, needed height=${textH.toFixed(1)}`);
}

console.log('\n--- CURRENT layoutTeachingScene OUTPUT ---');
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
  console.log(`  connection ${c.id}: points=${JSON.stringify(c.points)} labelPos=${JSON.stringify(c.labelPosition)}`);
}
