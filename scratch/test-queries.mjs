import { searchImageProvider, imageSearchQueries } from "../lib/image-providers.ts";

const testQueries = [
  "human heart diagram anatomy",
  "human heart anatomy",
  "human heart",
  "chloroplast diagram structure",
  "chloroplast diagram",
  "retina layers diagram",
  "human retina anatomy diagram",
  "falcon 9 rocket stage separation",
  "photosynthesis light reaction diagram",
];

for (const q of testQueries) {
  const variations = imageSearchQueries(q);
  console.log(`\nQuery: "${q}", Variations:`, variations);
  for (const v of variations) {
    try {
      const results = await searchImageProvider("commons", v);
      console.log(`  Commons for "${v}": ${results.length} results`);
      if (results[0]) console.log(`     Sample: ${results[0].title}`);
    } catch (e) {
      console.log(`  Commons for "${v}": ERROR ${e.message}`);
    }
  }
}
