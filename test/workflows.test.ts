import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowDir = join(process.cwd(), ".github", "workflows");
const workflowFiles = ["ci.yml", "weather-collect.yml", "weather-metrics.yml", "database-backup.yml"];

describe("github workflows", () => {
  it("usa permisos mínimos y no hace commits ni pushes", () => {
    for (const file of workflowFiles) {
      const content = readWorkflow(file);
      expect(content).toContain("contents: read");
      expect(content).not.toMatch(/git\s+(commit|push)|create-pull-request|peter-evans/);
    }
  });

  it("no contiene valores literales de secretos ni URLs credentialed", () => {
    for (const file of workflowFiles) {
      const content = readWorkflow(file);
      expect(content).not.toContain("TURSO_AUTH_TOKEN=");
      expect(content).not.toContain("AEMET_API_KEY=");
      expect(content).not.toMatch(/libsql:\/\/[^\s$]+/);
    }
  });

  it("interpreta códigos degradados de collect y health como éxito operacional", () => {
    const collect = readWorkflow("weather-collect.yml");
    expect(collect).toContain('"$code" -eq 2');
    expect(collect).toContain('"$code" -eq 3');
  });

  it("mantiene weather-collect con schedule activo cada 3 horas", () => {
    const collect = readWorkflow("weather-collect.yml");
    expect(collect).toContain("workflow_dispatch:");
    expect(collect).toMatch(/^\s+schedule:/m);
    expect(collect).toContain('cron: "17 */3 * * *"');
  });

  it("no sube archivos de base de datos como artefactos", () => {
    for (const file of workflowFiles) {
      const content = readWorkflow(file);
      expect(content).not.toMatch(/path:\s*.*\.(db|sqlite|sqlite3)/);
    }
  });
});

function readWorkflow(file: string): string {
  return readFileSync(join(workflowDir, file), "utf8");
}
