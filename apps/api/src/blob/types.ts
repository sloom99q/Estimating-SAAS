/**
 * BlobStore — the storage abstraction Sprint 2's INGEST job will write PDF
 * pages and rendered images through. Two drivers ship over the life of the
 * project:
 *
 *   - filesystem (Sprint 1) — writes under `BLOB_ROOT`. No signed URLs.
 *   - S3-compatible (Sprint 2) — writes to S3 / Cloudflare R2. Signed URLs.
 *
 * Both drivers use the SAME `documentKey()` helper so storage keys are
 * portable between environments. The wire format is:
 *
 *   org/{orgId}/projects/{projectId}/documents/{docId}/{suffix}
 *
 * `exists()` is mandatory: INGEST retries are idempotent (the same PDF may
 * arrive twice on a worker retry); we skip re-uploads when the destination
 * key already exists.
 */
export interface SignedUrlOptions {
  ttlSeconds?: number
  method?: 'GET' | 'PUT'
}

export interface BlobStore {
  /** Write bytes to the storage at `key`. Overwrites existing content. */
  put(key: string, data: Uint8Array | Buffer, contentType?: string): Promise<void>
  /** Read bytes from `key`. Throws if the key does not exist. */
  get(key: string): Promise<Buffer>
  /** True iff the key has data behind it. Used for idempotent retries. */
  exists(key: string): Promise<boolean>
  /** Remove `key` from storage. No-op if it does not exist. */
  delete(key: string): Promise<void>
  /**
   * Generate a presigned URL for direct browser access. The fs driver throws
   * `NotSupportedInFs` — callers should fall back to streaming via the API
   * in dev. Sprint 2's S3 driver implements this for real.
   */
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string>
}

export const BLOB_KEY_PREFIX = 'org'

/**
 * Canonical key for a document blob. Both drivers MUST use this helper so a
 * filesystem-development blob is portable to S3 verbatim.
 *
 *   documentKey('org_abc', 'prj_xyz', 'doc_1', 'source.pdf')
 *   → 'org/org_abc/projects/prj_xyz/documents/doc_1/source.pdf'
 */
export function documentKey(
  organizationId: string,
  projectId: string,
  documentId: string,
  suffix?: string,
): string {
  const base = `${BLOB_KEY_PREFIX}/${organizationId}/projects/${projectId}/documents/${documentId}`
  return suffix ? `${base}/${suffix}` : base
}

export class BlobNotFoundError extends Error {
  constructor(key: string) {
    super(`Blob not found: ${key}`)
    this.name = 'BlobNotFoundError'
  }
}

export class NotSupportedInFsError extends Error {
  constructor(operation: string) {
    super(`Filesystem driver does not support ${operation}; use S3 / R2 in production`)
    this.name = 'NotSupportedInFsError'
  }
}
