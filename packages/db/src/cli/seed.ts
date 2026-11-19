import { createDatabase } from "../database.js";
import { runSeed } from "../seed/index.js";
import { describeUrl, runCli, targetUrl } from "./shared.js";

await runCli(async () => {
  const { url, variable } = targetUrl(process.argv.slice(2));
  console.warn(`Seeding ${describeUrl(url)} (${variable})…`);
  const handle = createDatabase({ url, maxConnections: 1, applicationName: "fleettrust-seed" });
  try {
    for (const { step, upserted } of await runSeed(handle.db)) {
      console.warn(`  ${step}: ${upserted} rows ensured`);
    }
  } finally {
    await handle.close();
  }
});
