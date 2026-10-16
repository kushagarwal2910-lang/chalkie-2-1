import { groqFetch } from '../lib/groq-pool.ts';
import { VISION_MODEL } from '../lib/models.ts';
import { fetchCommonsImage } from '../lib/commons-fetch.ts';
import { imageCandidates } from '../lib/image-providers.ts';

async function testRealImage() {
  console.log('Searching for candidate images for "human eye diagram"...');
  let firstCandidate: any = null;
  for await (const cand of imageCandidates('human eye diagram')) {
    firstCandidate = cand;
    break;
  }
  if (!firstCandidate) {
    console.log('No candidate found!');
    return;
  }
  console.log('Found candidate:', firstCandidate.url);
  const { bytes, type } = await fetchCommonsImage(firstCandidate.url);
  console.log('Fetched bytes:', bytes.length, 'type:', type);

  const res = await groqFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      max_completion_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Inspect this visual reference for an educational lesson about human eye. Return JSON {"suitable":true,"description":"a diagram of an eye","regions":[{"label":"cornea","x":0.2,"y":0.3,"width":0.2,"height":0.2,"confidence":0.9}]}'
          },
          {
            type: 'image_url',
            image_url: { url: `data:${type};base64,${bytes.toString('base64')}` }
          }
        ]
      }]
    })
  });
  console.log('Groq status:', res.status);
  const json = await res.json() as any;
  console.log('Response content:', json.choices?.[0]?.message?.content);
}

testRealImage().catch(console.error);
