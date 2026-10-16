import { applyElkLayout, doBoxesOverlap } from '../lib/elk-spatial-layout.ts';
import { compileTeachingPlan } from '../lib/lesson-v2.ts';
import { boardTextLines, boardFontSize } from '../lib/teaching-layout.ts';

const modes = ['concept', 'sequence', 'reference', 'comparison', 'worked-example'];

for (const mode of modes) {
  console.log(`\n=================== TESTING MODE: ${mode} ===================`);
  const plan = {
    title: `Test ${mode}`,
    summary: `Testing ${mode} layout with ELK`,
    teachingMode: mode,
    coverage: 'append',
    nodes: mode === 'reference' ? [
      { id: 'ref-img', label: 'Primary anatomical reference photo of human brain', kind: 'image', imageQuery: 'brain anatomy', regions: ['cortex', 'cerebellum'] },
      { id: 'note-cortex', label: 'Cerebral cortex handles higher-order executive functions, planning, and sensory perception.', kind: 'text', imageQuery: '', regions: [] },
      { id: 'note-cerebellum', label: 'Cerebellum coordinates fine motor control, timing, and dynamic balance.', kind: 'text', imageQuery: '', regions: [] }
    ] : mode === 'comparison' ? [
      { id: 'dna-overview', label: 'Nucleic Acids Overview', kind: 'box', column: 'full', imageQuery: '', regions: [] },
      { id: 'dna-note', label: 'DNA uses double helix, deoxyribose, thymine, and remains strictly in nucleus.', kind: 'text', column: 'left', imageQuery: '', regions: [] },
      { id: 'rna-note', label: 'RNA uses single strand, ribose, uracil, and travels to ribosomes for translation.', kind: 'text', column: 'right', imageQuery: '', regions: [] }
    ] : [
      { id: 'stage-1', label: 'Stage 1: Input signal capture and analog-to-digital sampling at high frequency.', kind: 'box', imageQuery: '', regions: [] },
      { id: 'stage-2', label: 'Stage 2: Digital signal filtering using discrete Fourier transform algorithms.', kind: 'text', imageQuery: '', regions: [] },
      { id: 'stage-3', label: 'Stage 3: Output synthesis and transmission to speaker transducer.', kind: 'box', imageQuery: '', regions: [] }
    ],
    links: mode === 'comparison' ? [
      { from: 'dna-overview', to: 'dna-note', label: 'compares' },
      { from: 'dna-overview', to: 'rna-note', label: 'compares' }
    ] : mode === 'reference' ? [
      { from: 'ref-img', to: 'note-cortex', label: 'shows' },
      { from: 'ref-img', to: 'note-cerebellum', label: 'shows' }
    ] : [
      { from: 'stage-1', to: 'stage-2', label: 'flows to' },
      { from: 'stage-2', to: 'stage-3', label: 'then to' }
    ],
    steps: [
      { title: 'Step 1', narration: 'First part of explanation.', targetIds: mode === 'reference' ? ['ref-img'] : mode === 'comparison' ? ['dna-overview', 'dna-note'] : ['stage-1', 'stage-2'] },
      { title: 'Step 2', narration: 'Second part of explanation.', targetIds: mode === 'reference' ? ['note-cortex', 'note-cerebellum'] : mode === 'comparison' ? ['rna-note'] : ['stage-3'] }
    ]
  };

  const lesson = compileTeachingPlan(plan, `Explain ${mode}`, []);
  if (mode === 'reference') {
    lesson.objects[0].image = { id: 'brain-img', title: 'Brain', url: 'https://example.com/b.jpg', sourceUrl: 'https://example.com', author: 'A', license: 'CC', licenseUrl: 'https://example.com', width: 800, height: 600, regions: [] };
  }

  const laid = await applyElkLayout(lesson);
  console.log(`Objects (${laid.objects.length}):`);
  for (const o of laid.objects) {
    console.log(`  ${o.id} (${o.shapeType}): x=${Math.round(o.x)}, y=${Math.round(o.y)}, w=${Math.round(o.width)}, h=${Math.round(o.height)}`);
  }
  console.log(`Connections (${laid.connections.length}):`);
  for (const c of laid.connections) {
    console.log(`  ${c.id}: from=${c.from} to=${c.to} points=${JSON.stringify(c.points)}`);
  }

  // Check overlaps
  let overlaps = 0;
  for (let i = 0; i < laid.objects.length; i++) {
    for (let j = i + 1; j < laid.objects.length; j++) {
      const a = laid.objects[i];
      const b = laid.objects[j];
      if (doBoxesOverlap(a, b, 16)) {
        console.error(`  ❌ OVERLAP between ${a.id} and ${b.id}!`);
        overlaps++;
      }
    }
  }
  if (overlaps === 0) {
    console.log(`✔ ZERO OBJECT OVERLAPS for mode ${mode}`);
  }
}
