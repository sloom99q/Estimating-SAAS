import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'
import { config } from '../config'

const secretBytes = new TextEncoder().encode(config.jwtSecret)

/**
 * Subject claims baked into the JWT. Keep the payload tiny — anything else the
 * server needs is loaded from the DB on each request (membership / role).
 */
export interface AccessTokenPayload {
  sub: string // userId
  oid: string // organizationId
  role: string // membership.role
}

export async function issueAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ oid: payload.oid, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${config.jwtTtlSeconds}s`)
    .sign(secretBytes)
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretBytes, { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string') return null
    if (typeof payload.oid !== 'string') return null
    if (typeof payload.role !== 'string') return null
    return { sub: payload.sub, oid: payload.oid, role: payload.role }
  } catch {
    return null
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
