import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".putput");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  token: string;
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://putput.io";

export async function loadConfig(): Promise<Config | null> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof (parsed as Record<string, unknown>).token === "string"
    ) {
      const cfg = parsed as Record<string, unknown>;
      return {
        token: cfg.token as string,
        baseUrl:
          typeof cfg.baseUrl === "string"
            ? cfg.baseUrl
            : DEFAULT_BASE_URL,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function getDefaultBaseUrl(): string {
  return DEFAULT_BASE_URL;
}
