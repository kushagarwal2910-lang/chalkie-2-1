import test from 'node:test';
import assert from 'node:assert/strict';
import { applyElkLayout, doBoxesOverlap } from '../lib/elk-spatial-layout.ts';
import { compileTeachingPlan } from '../lib/lesson-v2.ts';
import { mergeFollowUpLesson } from '../lib/follow-up.ts';
import { routeIntersectsBox } from '../lib/connector-routing.ts';

test('Zero overlaps across all teaching modes with realistic text notes & images', async () => {
  const modes = ['concept', 'sequence', 'reference', 'comparison', 'worked-example'];

  for (const mode of modes) {
    const raw = {
      title: `Zero overlap test for ${mode}`,
      summary: `Testing realistic multi-line text and arrow routing for ${mode}`,
      teachingMode: mode,
      coverage: 'append',
      nodes: [
        {
          id: `${mode}-node-1`,
          label: mode === 'reference'
            ? 'Diagram of Cellular Respiration in Mitochondria'
            : 'Initial phase: Glucose phosphorylation and preparatory stage of glycolysis yielding glyceraldehyde 3-phosphate',
          kind: mode === 'reference' ? 'image' : 'box',
          imageQuery: mode === 'reference' ? 'mitochondria respiration' : '',
          regions: mode === 'reference' ? ['matrix', 'cristae'] : []
        },
        {
          id: `${mode}-node-2`,
          label: 'Intermediate step: Hexokinase uses ATP to transfer a phosphate group to glucose, producing glucose 6-phosphate.',
          kind: 'text',
          imageQuery: '',
          regions: []
        },
        {
          id: `${mode}-node-3`,
          label: 'Final outcome: Pyruvate dehydrogenase complex converts pyruvate into acetyl-CoA, producing NADH and releasing CO2.',
          kind: 'box',
          imageQuery: '',
          regions: []
        }
      ],
      links: [
        { from: `${mode}-node-1`, to: `${mode}-node-2`, label: 'initiates reaction' },
        { from: `${mode}-node-2`, to: `${mode}-node-3`, label: 'subsequent conversion' }
      ],
      steps: [
        { title: 'Step 1', narration: 'First part of process.', targetIds: [`${mode}-node-1`] },
        { title: 'Step 2', narration: 'Second part of process.', targetIds: [`${mode}-node-2`, `${mode}-node-3`] }
      ]
    };

    const lesson = compileTeachingPlan(raw, `Explain ${mode}`, []);
    if (mode === 'reference') {
      lesson.objects[0].image = {
        id: 'mito-img',
        title: 'Mitochondria',
        url: 'https://example.com/mito.png',
        sourceUrl: 'https://example.com',
        author: 'Bio',
        license: 'CC',
        licenseUrl: 'https://example.com',
        width: 800,
        height: 600,
        regions: []
      };
    }

    const laid = await applyElkLayout(lesson);

    // Verify no node-to-node overlaps with minimum 16px padding
    for (let i = 0; i < laid.objects.length; i++) {
      for (let j = i + 1; j < laid.objects.length; j++) {
        const a = laid.objects[i];
        const b = laid.objects[j];
        assert.ok(
          !doBoxesOverlap(a, b, 16),
          `Mode ${mode}: Overlap detected between ${a.id} [${a.x},${a.y},${a.width},${a.height}] and ${b.id} [${b.x},${b.y},${b.width},${b.height}]`
        );
      }
    }

    // Verify arrow routes do not cut through non-endpoint objects
    for (const conn of laid.connections) {
      if (conn.points && conn.points.length >= 2) {
        for (const obj of laid.objects) {
          if (obj.id === conn.from || obj.id === conn.to) continue;
          assert.ok(
            !routeIntersectsBox(conn.points, obj),
            `Mode ${mode}: Connection ${conn.id} cuts through obstacle object ${obj.id}!`
          );
        }
      }
    }
  }
});

test('Follow-up merge creates zero overlaps and pre-routes bridge cross-connections', async () => {
  const baseRaw = {
    title: 'Base Lesson',
    summary: 'Base concept',
    teachingMode: 'concept',
    coverage: 'append',
    nodes: [
      { id: 'base-1', label: 'Primary Concept Alpha with descriptive explanation paragraph', kind: 'box', imageQuery: '', regions: [] },
      { id: 'base-2', label: 'Detailed Note Beta highlighting kinetic reaction parameters and rate limiting constants', kind: 'text', imageQuery: '', regions: [] }
    ],
    links: [{ from: 'base-1', to: 'base-2', label: 'regulates' }],
    steps: [{ title: 'Overview', narration: 'Base explanation', targetIds: ['base-1', 'base-2'] }]
  };
  const baseLesson = compileTeachingPlan(baseRaw, 'Explain Alpha', []);
  const laidBase = await applyElkLayout(baseLesson);

  const followRaw = {
    id: 'follow-1',
    teachingMode: 'concept',
    title: 'Follow-up on Feedback',
    answer: 'Feedback loop regulation mechanism',
    coverage: 'append',
    visualStrategy: 'System extension',
    targetIds: ['base-2'],
    objects: [
      { id: 'follow-note', shapeType: 'note', role: 'detail', label: 'Feedback inhibitor binding allosteric site to downregulate enzyme activity', x: 0, y: 0, width: 280, height: 160, parts: [] }
    ],
    connections: [
      { id: 'bridge-link', from: 'base-2', to: 'follow-note', label: 'inhibits' }
    ],
    segments: [{ id: 'seg-1', title: 'Feedback', narration: 'Explaining feedback.', targetIds: ['follow-note'] }]
  };

  const merged = mergeFollowUpLesson(laidBase, followRaw);

  // Check no overlaps between all merged objects
  for (let i = 0; i < merged.lesson.objects.length; i++) {
    for (let j = i + 1; j < merged.lesson.objects.length; j++) {
      const a = merged.lesson.objects[i];
      const b = merged.lesson.objects[j];
      assert.ok(
        !doBoxesOverlap(a, b, 16),
        `Merged follow-up overlap between ${a.id} and ${b.id}`
      );
    }
  }

  // Check bridge cross-connection has valid non-overlapping points
  const bridgeConn = merged.lesson.connections.find(c => c.id.includes('bridge'));
  assert.ok(bridgeConn, 'Bridge cross-connection should be created');
  assert.ok(bridgeConn.points && bridgeConn.points.length >= 2, 'Bridge connection should have routed points');
  for (const obj of merged.lesson.objects) {
    if (obj.id === bridgeConn.from || obj.id === bridgeConn.to) continue;
    assert.ok(
      !routeIntersectsBox(bridgeConn.points, obj),
      `Bridge connection intersects obstacle ${obj.id}`
    );
  }
});
