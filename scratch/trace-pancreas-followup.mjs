
import { groqFetch } from "../lib/groq-pool.ts";
import { TEACHER_PROMPT, schemaForTeaching } from "../lib/lesson-v2.ts";
import { GROQ_MODEL } from "../lib/groq.ts";
import { imageCandidates } from "../lib/image-providers.ts";

async function testPancreasFollowup() {
  const question = "can you map me out visually how pancreas and kidneys work together";
  const existing = [
    { id: "pancreas-anatomy", label: "Pancreas structure and lobules", hasImage: true, inspection: "Pancreas anatomy diagram showing exocrine and endocrine tissue", regions: ["head", "tail", "pancreatic duct"] }
  ];
  const previousSummary = "The human pancreas functions as both an exocrine gland producing digestive enzymes and an endocrine gland releasing insulin and glucagon.";

  console.log("Calling Groq with follow-up...");
  const response = await groqFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: schemaForTeaching(true) },
      messages: [
        { role: "system", content: TEACHER_PROMPT },
        { role: "user", content: JSON.stringify({ question, evidence: "The pancreas produces insulin and digestive enzymes. The kidneys filter blood, clear metabolites, and are regulated by hormones in fluid balance.", existing, previousSummary }) }
      ]
    })
  });

  const body = await response.json();
  const content = body.choices?.[0]?.message?.content;
  console.log("Raw LLM output:\n", content);

  const parsed = JSON.parse(content);
  const imageNodes = parsed.nodes.filter(n => n.kind === "image");
  console.log(`Image nodes returned: ${imageNodes.length}`);
  for (const img of imageNodes) {
    console.log(`- Query: "${img.imageQuery}", ID: ${img.id}`);
    console.log("  Searching imageCandidates...");
    let count = 0;
    for await (const c of imageCandidates(img.imageQuery)) {
      console.log(`    Found [${c.title}]: ${c.url}`);
      if (++count >= 3) break;
    }
  }
}

testPancreasFollowup().catch(console.error);
