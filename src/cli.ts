#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { basename, join, relative } from "node:path";
import { loadConfig, saveConfig, getDefaultBaseUrl } from "./config.js";
import type { Config } from "./config.js";
import {
  createGuestToken,
  presign,
  uploadToR2,
  confirm,
  listFiles,
  deleteFile,
  uploadFromUrl,
  getActivity,
  getProjects,
  exportData,
  ApiError,
} from "./api.js";
import type { PresignOptions } from "./api.js";

// ─── Helpers ───

const isTTY = process.stdout.isTTY === true;

function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function useJson(flags: Record<string, string | boolean>): boolean {
  if ("json" in flags) return true;
  return !isTTY;
}

function output(data: unknown, humanFn: () => string, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    process.stdout.write(humanFn() + "\n");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    txt: "text/plain",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    zip: "application/zip",
    gz: "application/gzip",
    tar: "application/x-tar",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    csv: "text/csv",
    xml: "application/xml",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    ts: "text/typescript",
    md: "text/markdown",
    yaml: "text/yaml",
    yml: "text/yaml",
    toml: "application/toml",
    wasm: "application/wasm",
  };
  return (ext && map[ext]) ?? "application/octet-stream";
}

async function requireConfig(): Promise<Config> {
  const config = await loadConfig();
  if (!config) {
    process.stderr.write(
      "No config found. Run `putput init --guest` to create a token.\n",
    );
    process.exit(1);
  }
  return config;
}

function die(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

/** Extract common upload options from CLI flags. */
function extractUploadOptions(flags: Record<string, string | boolean>): PresignOptions {
  const opts: PresignOptions = {};
  if ("private" in flags) opts.visibility = "private";
  if (typeof flags.prefix === "string") opts.prefix = flags.prefix;
  if (typeof flags.metadata === "string") {
    try {
      opts.metadata = JSON.parse(flags.metadata) as Record<string, string>;
    } catch {
      die("--metadata must be a valid JSON object");
    }
  }
  if (typeof flags.tags === "string") {
    opts.tags = flags.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (typeof flags.expires === "string") opts.expires_at = flags.expires;
  return opts;
}

// ─── Commands ───

async function cmdInit(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);

  if (!("guest" in flags)) {
    die("Usage: putput init --guest");
  }

  const baseUrl =
    typeof flags.url === "string" ? flags.url : getDefaultBaseUrl();

  const existing = await loadConfig();
  if (existing) {
    die(
      `Config already exists with token ${existing.token.slice(0, 12)}... — delete ~/.putput/config.json to reset.`,
    );
  }

  const result = await createGuestToken(baseUrl);

  await saveConfig({ token: result.token, baseUrl });

  output(result, () => {
    return [
      `Token: ${result.token}`,
      `Claim URL: ${result.claim_url}`,
      `Storage: ${formatBytes(result.limits.storage_bytes)}`,
      `Max file size: ${formatBytes(result.limits.max_file_size_bytes)}`,
      "",
      "Saved to ~/.putput/config.json",
      "You can now run: putput upload <file>",
    ].join("\n");
  }, json);
}

async function cmdUpload(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  const filePath = positional[0];
  if (!filePath) {
    die("Usage: putput upload <file>");
  }

  // Read file
  let fileBytes: Uint8Array;
  let fileSize: number;
  try {
    const fileStat = await stat(filePath);
    fileSize = fileStat.size;
    fileBytes = new Uint8Array(await readFile(filePath));
  } catch {
    return die(`Cannot read file: ${filePath}`);
  }

  const filename = basename(filePath);
  const contentType =
    typeof flags.type === "string" ? flags.type : guessContentType(filename);
  const uploadOpts = extractUploadOptions(flags);

  // Step 1: Presign
  if (!json) process.stderr.write("Presigning...\n");
  const presignResult = await presign(config, filename, contentType, fileSize, uploadOpts);

  // Step 2: Upload to R2
  if (!json) process.stderr.write("Uploading...\n");
  await uploadToR2(presignResult.presigned_url, fileBytes, contentType);

  // Step 3: Confirm
  if (!json) process.stderr.write("Confirming...\n");
  const confirmResult = await confirm(config, presignResult.upload_id);

  output(confirmResult.file, () => {
    const lines = [
      `Uploaded: ${confirmResult.file.original_name}`,
      `URL: ${confirmResult.file.public_url ?? "(private)"}`,
      `ID: ${confirmResult.file.id}`,
      `Size: ${formatBytes(confirmResult.file.size_bytes)}`,
      `Type: ${confirmResult.file.content_type}`,
    ];
    if (confirmResult.file.short_url) {
      lines.push(`Short URL: ${confirmResult.file.short_url}`);
    }
    return lines.join("\n");
  }, json);
}

async function cmdUploadUrl(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  const url = positional[0];
  if (!url) {
    die("Usage: putput upload-url <url>");
  }

  const uploadOpts = extractUploadOptions(flags);
  const extraOpts: Record<string, unknown> = { ...uploadOpts };
  if (typeof flags.filename === "string") extraOpts.filename = flags.filename;
  if (typeof flags.type === "string") extraOpts.content_type = flags.type;

  if (!json) process.stderr.write("Uploading from URL...\n");
  const result = await uploadFromUrl(config, url, extraOpts as Parameters<typeof uploadFromUrl>[2]);

  output(result.file, () => {
    const lines = [
      `Uploaded: ${result.file.original_name}`,
      `URL: ${result.file.public_url ?? "(private)"}`,
      `ID: ${result.file.id}`,
      `Size: ${formatBytes(result.file.size_bytes)}`,
    ];
    if (result.file.short_url) {
      lines.push(`Short URL: ${result.file.short_url}`);
    }
    return lines.join("\n");
  }, json);
}

async function cmdLs(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  const limit = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : undefined;
  const cursor = typeof flags.cursor === "string" ? flags.cursor : undefined;
  const prefix = typeof flags.prefix === "string" ? flags.prefix : undefined;
  const projectId = typeof flags["project-id"] === "string" ? flags["project-id"] : undefined;
  const tag = typeof flags.tag === "string" ? flags.tag : undefined;

  const result = await listFiles(config, cursor, limit, { prefix, project_id: projectId, tag });

  output(result, () => {
    if (result.files.length === 0) {
      return "No files found.";
    }
    const lines = result.files.map((f) => {
      const size = formatBytes(f.size_bytes).padStart(10);
      const date = f.created_at.slice(0, 10);
      return `${f.id}  ${size}  ${date}  ${f.original_name}`;
    });
    if (result.has_more && result.cursor) {
      lines.push(`\n... more files. Use --cursor ${result.cursor}`);
    }
    return lines.join("\n");
  }, json);
}

async function cmdRm(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  const fileId = positional[0];
  if (!fileId) {
    die("Usage: putput rm <file-id>");
  }

  await deleteFile(config, fileId);

  output({ deleted: fileId }, () => `Deleted: ${fileId}`, json);
}

async function cmdToken(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  output(
    { token: config.token, baseUrl: config.baseUrl },
    () => {
      return [
        `Token: ${config.token}`,
        `Base URL: ${config.baseUrl}`,
        `Config: ~/.putput/config.json`,
      ].join("\n");
    },
    json,
  );
}

async function cmdActivity(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  const limit = typeof flags.limit === "string" ? parseInt(flags.limit, 10) : undefined;
  const cursor = typeof flags.cursor === "string" ? flags.cursor : undefined;

  const result = await getActivity(config, cursor, limit);

  output(result, () => {
    if (result.activity.length === 0) {
      return "No activity found.";
    }
    const lines = result.activity.map((a) => {
      const date = a.created_at.slice(0, 19).replace("T", " ");
      const resource = a.resource_id ? ` (${a.resource_id})` : "";
      return `${date}  ${a.action}${resource}`;
    });
    if (result.has_more && result.cursor) {
      lines.push(`\n... more activity. Use --cursor ${result.cursor}`);
    }
    return lines.join("\n");
  }, json);
}

async function cmdProjects(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();

  const result = await getProjects(config);

  output(result, () => {
    if (result.projects.length === 0) {
      return "No projects found.";
    }
    return result.projects.map((p) => `${p.id}  ${p.name}  ${p.created_at.slice(0, 10)}`).join("\n");
  }, json);
}

async function cmdExport(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const config = await requireConfig();
  const result = await exportData(config);
  // Export always outputs JSON
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

// Skip patterns for watch mode
const WATCH_SKIP_PATTERNS = [
  /\/\./,           // dotfiles and dot-directories
  /node_modules/,
  /\.git/,
  /\.DS_Store/,
];

function shouldSkipPath(filePath: string): boolean {
  return WATCH_SKIP_PATTERNS.some((p) => p.test(filePath));
}

async function cmdWatch(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const json = useJson(flags);
  const config = await requireConfig();
  const dir = positional[0] as string | undefined;
  if (!dir) {
    die("Usage: putput watch <directory>");
    return;
  }
  const watchDir: string = dir;

  // Verify directory exists
  try {
    const s = await stat(watchDir);
    if (!s.isDirectory()) die(`Not a directory: ${watchDir}`);
  } catch {
    die(`Cannot access directory: ${watchDir}`);
  }

  const uploadOpts = extractUploadOptions(flags);

  process.stderr.write(`[watch] Watching ${watchDir} for changes...\n`);
  process.stderr.write(`[watch] Press Ctrl+C to stop\n`);

  // Debounce map: filename -> timeout
  const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  const DEBOUNCE_MS = 500;

  async function uploadFile(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return;

      const fileBytes = new Uint8Array(await readFile(filePath));
      const filename = basename(filePath);
      const contentType = guessContentType(filename);

      const presignResult = await presign(config, filename, contentType, fileStat.size, uploadOpts);
      await uploadToR2(presignResult.presigned_url, fileBytes, contentType);
      const confirmResult = await confirm(config, presignResult.upload_id);

      const relPath = relative(watchDir, filePath);
      if (json) {
        process.stdout.write(JSON.stringify({ event: "uploaded", path: relPath, file: confirmResult.file }) + "\n");
      } else {
        process.stderr.write(
          `[watch] Uploaded: ${relPath} → ${confirmResult.file.public_url ?? confirmResult.file.short_url ?? confirmResult.file.id}\n`,
        );
      }
    } catch (err) {
      const relPath = relative(watchDir, filePath);
      const msg = err instanceof Error ? err.message : String(err);
      if (json) {
        process.stdout.write(JSON.stringify({ event: "error", path: relPath, error: { message: msg } }) + "\n");
      } else {
        process.stderr.write(`[watch] Failed: ${relPath} — ${msg}\n`);
      }
    }
  }

  const watcher = watch(watchDir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const fullPath = join(watchDir, filename);

    if (shouldSkipPath(fullPath)) return;

    // Debounce
    const existing = debounceMap.get(fullPath);
    if (existing) clearTimeout(existing);

    debounceMap.set(
      fullPath,
      setTimeout(() => {
        debounceMap.delete(fullPath);
        uploadFile(fullPath);
      }, DEBOUNCE_MS),
    );
  });

  // Keep process alive
  process.on("SIGINT", () => {
    watcher.close();
    process.stderr.write("\n[watch] Stopped.\n");
    process.exit(0);
  });
}

function printHelp(): void {
  process.stdout.write(
    [
      "putput — Dead-simple file uploads",
      "",
      "Usage:",
      "  putput init --guest           Create a guest token and save config",
      "  putput upload <file>          Upload a file (3-step presigned flow)",
      "  putput upload-url <url>       Upload a file from a URL",
      "  putput ls                     List your files",
      "  putput rm <id>                Delete a file",
      "  putput token                  Show current token and config",
      "  putput watch <directory>      Watch a directory and auto-upload on changes",
      "  putput activity               List recent activity",
      "  putput projects               List projects",
      "  putput export                 Export all account data as JSON",
      "  putput help                   Show this help",
      "",
      "Upload flags:",
      "  --private                     Upload as private file",
      "  --prefix <path>               Set path prefix for organization",
      "  --metadata <json>             JSON object of key-value metadata",
      "  --tags <tag1,tag2>            Comma-separated tags",
      "  --expires <iso-datetime>      Set file expiry",
      "  --type <content-type>         Override content type",
      "",
      "List flags:",
      "  --prefix <path>               Filter by prefix",
      "  --project-id <id>             Filter by project",
      "  --tag <tag>                   Filter by tag",
      "  --cursor <cursor>             Pagination cursor",
      "  --limit <n>                   Max results",
      "",
      "General flags:",
      "  --json                        Output JSON (default when piped)",
      "  --url <base-url>              Override base URL (init only)",
      "",
      "Config: ~/.putput/config.json",
      "Docs: https://putput.io/docs",
      "",
    ].join("\n"),
  );
}

// ─── Main ───

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv);

  if ("help" in flags || "h" in flags || command === "help" || !command) {
    printHelp();
    return;
  }

  if ("version" in flags || "v" in flags || command === "version") {
    process.stdout.write("0.0.1\n");
    return;
  }

  try {
    switch (command) {
      case "init":
        await cmdInit(flags);
        break;
      case "upload":
        await cmdUpload(positional, flags);
        break;
      case "upload-url":
        await cmdUploadUrl(positional, flags);
        break;
      case "ls":
      case "list":
        await cmdLs(flags);
        break;
      case "rm":
      case "delete":
        await cmdRm(positional, flags);
        break;
      case "token":
        await cmdToken(flags);
        break;
      case "watch":
        await cmdWatch(positional, flags);
        break;
      case "activity":
        await cmdActivity(flags);
        break;
      case "projects":
        await cmdProjects(flags);
        break;
      case "export":
        await cmdExport(flags);
        break;
      default:
        die(`Unknown command: ${command}. Run 'putput help' for usage.`);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      const json = useJson(flags);
      if (json) {
        process.stdout.write(
          JSON.stringify(
            { error: { code: err.code, message: err.message, hint: err.hint } },
            null,
            2,
          ) + "\n",
        );
      } else {
        process.stderr.write(`Error: ${err.code}\n`);
        if (err.hint) process.stderr.write(`Hint: ${err.hint}\n`);
      }
      process.exit(1);
    }
    throw err;
  }
}

main();
