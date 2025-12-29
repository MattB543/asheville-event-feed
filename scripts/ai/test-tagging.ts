import "../../lib/config/env";
import { generateEventTags } from "../../lib/ai/tagAndSummarize";

async function main() {
  const testEvent = {
    title: "Asheville Symphony: Masterworks 1",
    description: "Experience the power of the Asheville Symphony Orchestra in their season opener.",
    location: "Thomas Wolfe Auditorium",
    organizer: "Asheville Symphony",
    startDate: new Date(),
  };

  console.log("Testing tag generation for:", testEvent.title);
  const tags = await generateEventTags(testEvent);
  console.log("Generated Tags:", tags);
}

main().catch(console.error);
