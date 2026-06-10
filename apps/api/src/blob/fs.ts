import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  BlobNotFoundError,
  NotSupportedInFsError,
  documentKey,
  type BlobStore,
  type SignedUrlOptions,
} from './types'

/**
 * Filesystem driver. Keys are translated to relative paths under `root`. The
 * key format is identical to the S3 driver's, so a dev blob saved under
 * `./data/blobs/org/X/projects/Y/documents/Z/source.pdf` becomes the S3
 * object at the same key in production — no migration needed.
 */
export class FsBlobStore implements BlobStore {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  private resolve(key: string): string {
    // Defence-in-depth: refuse keys that try to escape the root via "..".
    const normalised = path.normalize(key)
    if (normalised.startsWith('..') || normalised.includes(`${path.sep}..${path.sep}`)) {
      throw new Error(`Invalid blob key: ${key}`)
    }
    return path.join(this.root, normalised)
  }

  async put(key: string, data: Uint8Array | Buffer, _contentType?: string): Promise<void> {
    const fullPath = this.resolve(key)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, data)
  }

  async get(key: string): Promise<Buffer> {
    const fullPath = this.resolve(key)
    try {
      return await fs.readFile(fullPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BlobNotFoundError(key)
      }
      throw err
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key))
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async signedUrl(_key: string, _options?: SignedUrlOptions): Promise<string> {
    throw new NotSupportedInFsError('signedUrl')
  }
}

let singleton: BlobStore | null = null

/**
 * Process-wide BlobStore. Returns the FS driver in Sprint 1; Sprint 2 swaps
 * in the S3 driver behind the same interface based on env presence
 * (S3_BUCKET / S3_ACCESS_KEY_ID / ...).
 */
export function getBlobStore(): BlobStore {
  if (singleton) return singleton
  const root = process.env.BLOB_ROOT ?? './data/blobs'
  singleton = new FsBlobStore(root)
  return singleton
}

// Re-export the helper so callers don't need to know which driver they're on.
export { documentKey }
