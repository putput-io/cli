import type { Config } from "./config.js";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    hint?: string;
  };
}

export interface GuestTokenResponse {
  token: string;
  claim_url: string;
  limits: {
    storage_bytes: number;
    max_file_size_bytes: number;
    max_files: number;
    expires_at: string;
  };
}

export interface PresignResponse {
  upload_id: string;
  presigned_url: string;
  public_name: string;
  expires_at: string;
}

export interface ConfirmResponse {
  file: FileItem;
}

export interface FileItem {
  id: string;
  original_name: string;
  public_name: string;
  public_url: string | null;
  content_type: string;
  size_bytes: number;
  visibility: string;
  short_url: string | null;
  download_count: number;
  created_at: string;
}

export interface FileListResponse {
  files: FileItem[];
  cursor: string | null;
  has_more: boolean;
}

export interface PresignOptions {
  visibility?: string;
  prefix?: string;
  metadata?: Record<string, string>;
  tags?: string[];
  expires_at?: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  resource_id: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface ActivityResponse {
  activity: ActivityItem[];
  cursor: string | null;
  has_more: boolean;
}

export interface ProjectItem {
  id: string;
  name: string;
  created_at: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public hint?: string,
  ) {
    super(`${code}: ${hint ?? "unknown error"}`);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    let hint: string | undefined;
    try {
      const body = (await res.json()) as ApiErrorBody;
      code = body.error.code;
      hint = body.error.hint ?? body.error.message;
    } catch {
      hint = res.statusText;
    }
    throw new ApiError(res.status, code, hint);
  }
  return (await res.json()) as T;
}

export async function createGuestToken(
  baseUrl: string,
): Promise<GuestTokenResponse> {
  const res = await fetch(`${baseUrl}/api/v1/auth/guest`, {
    method: "POST",
  });
  return handleResponse<GuestTokenResponse>(res);
}

export async function presign(
  config: Config,
  filename: string,
  contentType: string,
  sizeBytes: number,
  options?: PresignOptions,
): Promise<PresignResponse> {
  const body: Record<string, unknown> = {
    filename,
    content_type: contentType,
    size_bytes: sizeBytes,
  };
  if (options?.visibility) body.visibility = options.visibility;
  if (options?.prefix) body.prefix = options.prefix;
  if (options?.metadata) body.metadata = options.metadata;
  if (options?.tags) body.tags = options.tags;
  if (options?.expires_at) body.expires_at = options.expires_at;

  const res = await fetch(`${config.baseUrl}/api/v1/upload/presign`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return handleResponse<PresignResponse>(res);
}

export async function uploadToR2(
  presignedUrl: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const res = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    throw new ApiError(res.status, "R2_UPLOAD_FAILED", `R2 returned ${res.status}`);
  }
}

export async function confirm(
  config: Config,
  uploadId: string,
): Promise<ConfirmResponse> {
  const res = await fetch(`${config.baseUrl}/api/v1/upload/confirm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ upload_id: uploadId }),
  });
  return handleResponse<ConfirmResponse>(res);
}

export async function listFiles(
  config: Config,
  cursor?: string,
  limit?: number,
  options?: { prefix?: string; project_id?: string; tag?: string },
): Promise<FileListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  if (options?.prefix) params.set("prefix", options.prefix);
  if (options?.project_id) params.set("project_id", options.project_id);
  if (options?.tag) params.set("tag", options.tag);
  const qs = params.toString();
  const url = `${config.baseUrl}/api/v1/files${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  return handleResponse<FileListResponse>(res);
}

export async function deleteFile(
  config: Config,
  fileId: string,
): Promise<void> {
  const res = await fetch(`${config.baseUrl}/api/v1/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) {
    await handleResponse<never>(res);
  }
}

export async function uploadFromUrl(
  config: Config,
  url: string,
  options?: PresignOptions & { filename?: string; content_type?: string },
): Promise<ConfirmResponse> {
  const body: Record<string, unknown> = { url };
  if (options?.filename) body.filename = options.filename;
  if (options?.content_type) body.content_type = options.content_type;
  if (options?.visibility) body.visibility = options.visibility;
  if (options?.prefix) body.prefix = options.prefix;
  if (options?.metadata) body.metadata = options.metadata;
  if (options?.tags) body.tags = options.tags;
  if (options?.expires_at) body.expires_at = options.expires_at;

  const res = await fetch(`${config.baseUrl}/api/v1/upload/url`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return handleResponse<ConfirmResponse>(res);
}

export async function getActivity(
  config: Config,
  cursor?: string,
  limit?: number,
): Promise<ActivityResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  const res = await fetch(`${config.baseUrl}/api/v1/dashboard/activity${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  return handleResponse<ActivityResponse>(res);
}

export async function getProjects(
  config: Config,
): Promise<{ projects: ProjectItem[] }> {
  const res = await fetch(`${config.baseUrl}/api/v1/dashboard/projects`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  return handleResponse<{ projects: ProjectItem[] }>(res);
}

export async function exportData(
  config: Config,
): Promise<unknown> {
  const res = await fetch(`${config.baseUrl}/api/v1/account/export`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  return handleResponse<unknown>(res);
}
