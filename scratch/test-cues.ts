import { computeTargetPositions } from '../lib/target-matcher.ts';

const objects: any[] = [
  {
    id: 'imgEye',
    label: 'Human eye diagram',
    image: {
      regions: [
        { label: 'cornea', x: 0.08, y: 0.4, width: 0.08, height: 0.15, confidence: 0.95 },
        { label: 'lens', x: 0.15, y: 0.42, width: 0.1, height: 0.15, confidence: 0.95 },
        { label: 'sclera', x: 0.1, y: 0.6, width: 0.3, height: 0.2, confidence: 0.9 },
        { label: 'optic nerve', x: 0.82, y: 0.4, width: 0.15, height: 0.15, confidence: 0.95 }
      ]
    }
  },
  { id: 'boxCornea', label: 'Cornea – transparent front window' },
  { id: 'boxConjunctiva', label: 'Conjunctiva – lubricating membrane' }
];

const narration = "Notice how the clear cornea and lubricating conjunctiva form the eye's front window, letting light pass while protecting the inner structures.";
const cues = computeTargetPositions(narration, ['imgEye', 'boxCornea', 'boxConjunctiva'], objects);
console.log('Cues generated:', cues);
