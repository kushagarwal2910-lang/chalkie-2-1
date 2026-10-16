import { applyElkLayout } from '../lib/elk-spatial-layout.ts';
import { compileTeachingPlan } from '../lib/lesson-v2.ts';
import { boardTextLines, boardFontSize } from '../lib/teaching-layout.ts';

const planRealistic = {
  title: 'Pancreas and Islets',
  summary: 'Visual reference of islets and beta cells',
  teachingMode: 'reference',
  coverage: 'append',
  nodes: [
    { id: 'pancreas-img', label: 'Pancreas histology showing islets of Langerhans', kind: 'image', imageQuery: 'pancreas islets histology', regions: ['islet', 'acinar'] },
    { id: 'beta-cell-note', label: 'Beta cells make up ~70% of the islet and continuously synthesize insulin to regulate blood glucose levels.', kind: 'text', imageQuery: '', regions: [] },
    { id: 'alpha-cell-note', label: 'Alpha cells produce glucagon when glucose drops, mobilizing stored glycogen from the liver.', kind: 'text', imageQuery: '', regions: [] }
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

const lesson = compileTeachingPlan(planRealistic, 'Show pancreatic islets', []);
lesson.objects[0].image = {
  id: 'img-123', title: 'Histology', url: 'https://example.com/img.jpg', sourceUrl: 'https://example.com',
  author: 'Author', license: 'CC', licenseUrl: 'https://example.com', width: 800, height: 600, regions: []
};

const elkLaid = await applyElkLayout(lesson);
console.log('ELK LAID OUT OBJECTS:');
for (const o of elkLaid.objects) {
  const lines = boardTextLines(o);
  const fontSize = boardFontSize(o);
  const renderedH = o.shapeType === 'note' ? lines.length * fontSize * 1.35 + 20 : o.height;
  console.log(`  ${o.id}: y=${o.y}, elk_h=${o.height}, actual_rendered_h=${renderedH.toFixed(1)}, rendered_bottom=${(o.y + renderedH).toFixed(1)}`);
}

const beta = elkLaid.objects.find(o => o.id === 'beta-cell-note');
const alpha = elkLaid.objects.find(o => o.id === 'alpha-cell-note');
const betaLines = boardTextLines(beta);
const betaRenderedH = betaLines.length * boardFontSize(beta) * 1.35 + 20;
const betaBottom = beta.y + betaRenderedH;
console.log(`\nBeta bottom: ${betaBottom.toFixed(1)}, Alpha top: ${alpha.y}`);
if (betaBottom > alpha.y) {
  console.log(`❌ COLLISION! Beta text overflows into Alpha by ${(betaBottom - alpha.y).toFixed(1)}px!`);
} else {
  console.log('✓ No collision');
}
