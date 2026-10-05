import { hash, verify } from "@node-rs/argon2";

// argon2id; parameters follow OWASP's minimum recommendation.
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = (hashed: string, pw: string) => verify(hashed, pw).catch(() => false);
