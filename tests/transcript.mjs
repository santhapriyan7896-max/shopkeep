// Prints every demo conversation so you can read what the assistant says.
// Run: node tests/transcript.mjs
import "../catalog.js";
import "../validate.js";
import "../bot.js";
import "../scenarios.js";

const strip = (t) => t.replace(/\*\*/g, "");
for (const sc of globalThis.AW33_SCENARIOS) {
  const state = globalThis.AW33Bot.newState();
  console.log(`\n════════ ${sc.label} ════════`);
  for (const step of sc.steps.filter((st) => st.text)) {
    console.log(`\n👤 ${step.share ? "[shared post: " + step.share + "] " : ""}${step.text}`);
    const r = globalThis.AW33Bot.reply(state, { text: step.text, sharedProductId: step.share });
    for (const m of r.messages) {
      console.log("🤖 " + strip(m.text).replace(/\n/g, "\n   "));
      if (m.chips) console.log("   [" + m.chips.join("] [") + "]");
    }
    for (const e of r.events) console.log("   📋 EVENT", JSON.stringify(e));
  }
}
