import { groqFetch } from '../lib/groq-pool.ts';
import { VISION_MODEL } from '../lib/models.ts';

// 50x50 red square PNG base64
const png50x50 = 'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAALklEQVR42u3PMQEAAAgEID/516mDfe0mIEfa5N0qKioqKioqKioqKioqKioqvqkFh9s7sQyHnYoAAAAASUVORK5CYII=';

async function testVision() {
  console.log('Testing vision model:', VISION_MODEL);
  const res = await groqFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      max_completion_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What color is this image?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png50x50 } }
        ]
      }]
    })
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}
testVision().catch(console.error);
