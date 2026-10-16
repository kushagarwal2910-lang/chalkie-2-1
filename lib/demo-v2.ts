import { compileTeachingPlan } from "./lesson-v2";

export const demoLesson = compileTeachingPlan({
  title: "The water cycle · sample lesson", summary: "Sunlight powers evaporation. Cooling forms clouds, and precipitation returns water to the surface.", coverage: "append",
  nodes: [
    { id: "sunlight", label: "Sunlight warms water", kind: "ellipse", imageQuery: "", regions: [] },
    { id: "evaporation", label: "Evaporation", kind: "box", imageQuery: "", regions: [] },
    { id: "condensation", label: "Condensation", kind: "box", imageQuery: "", regions: [] },
    { id: "precipitation", label: "Precipitation", kind: "box", imageQuery: "", regions: [] },
  ],
  links: [{ from: "sunlight", to: "evaporation", label: "energy" }, { from: "evaporation", to: "condensation", label: "cooling" }, { from: "condensation", to: "precipitation", label: "droplets grow" }],
  steps: [
    { title: "Start with sunlight", narration: "Let's follow a drop of water. Sunlight warms water in lakes and oceans. Some of that energy helps liquid water become a gas.", targetIds: ["sunlight"] },
    { title: "Water enters the air", narration: "This change is evaporation. Water vapor mixes into the air. You cannot see the vapor itself, even though you can see the tiny droplets in mist.", targetIds: ["evaporation"] },
    { title: "Clouds form", narration: "As moist air cools, condensation forms tiny liquid droplets. Many of these droplets together form a cloud.", targetIds: ["condensation"] },
    { title: "Water returns", narration: "When cloud droplets or ice crystals grow large enough, precipitation falls. Rain and snow return water to the surface, and the cycle continues.", targetIds: ["precipitation"] },
  ],
}, "How does the water cycle work?", []);
demoLesson.id = "chalkie-v2-water-cycle-demo";
demoLesson.objects.forEach((o, i) => { o.x = i * 355; o.y = 120; });
