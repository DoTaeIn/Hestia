/** Test-only RFC 6238 generator for synthetic local fixtures. Never logs a secret or code. */
import { createHmac } from "node:crypto";
export function localTotp(secret, time = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) { const value = alphabet.indexOf(char); if (value < 0) throw new Error("Invalid test TOTP secret"); bits += value.toString(2).padStart(5,"0"); }
  const bytes = []; for (let n=0; n+8<=bits.length; n+=8) bytes.push(parseInt(bits.slice(n,n+8),2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));
  const digest = createHmac("sha1",Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length-1]&15;
  return ((digest.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,"0");
}
