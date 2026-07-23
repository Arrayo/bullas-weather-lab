import { accessSync, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStationIdFromArgs } from "./common.js";

const args = process.argv.slice(2);
const stationId = readStationIdFromArgs(args);
const scheduleArg = args.find((arg) => arg.startsWith("--schedule="));
const schedule = scheduleArg?.slice("--schedule=".length) ?? "7 */3 * * *";
if (!stationId) {
  console.error("Uso: pnpm cron:print --station=<indicativo> [--schedule=\"7 */3 * * *\"]");
  process.exit(1);
}
if (schedule.trim().split(/\s+/).length !== 5) {
  console.error("--schedule debe contener cinco campos cron básicos");
  process.exit(1);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pnpmPath = resolve(process.env.npm_execpath?.includes("pnpm") ? process.env.npm_execpath : "node_modules/.bin/pnpm");
const logsDir = resolve(projectRoot, "logs");
await mkdir(logsDir, { recursive: true });
accessSync(logsDir, constants.W_OK);
console.log(`${schedule} cd ${projectRoot} && ${pnpmPath} data:collect --station=${stationId} >> ${resolve(logsDir, "data-collect.log")} 2>&1`);
