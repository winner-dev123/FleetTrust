import { runMigrations } from "../database.js";
import { describeUrl, runCli, targetUrl } from "./shared.js";

await runCli(async () => {
  const { url, variable } = targetUrl(process.argv.slice(2));
  console.warn(`Applying migrations to ${describeUrl(url)} (${variable})…`);
  await runMigrations(url);
  console.warn("Migrations up to date.");
});
