import { createApp } from "./app.js";
import { config } from "./config.js";
import { providerSummary } from "./search.js";

const server = createApp();

server.listen(config.port, config.host, () => {
  const summary = providerSummary();
  console.log(`SnapShop running on http://localhost:${config.port}`);
  console.log(`  Photo identification: ${summary.identify === "claude" ? `Claude (${config.claudeModel})` : "DEMO (set ANTHROPIC_API_KEY)"}`);
  for (const p of summary.providers) console.log(`  ${p.enabled ? "on " : "off"}  ${p.name}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
