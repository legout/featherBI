// Remote snapshot (spec 0002): upload each snapshot table by content hash, presign GET URLs, check bucket CORS.
// AWS SigV4 query signing with node:crypto and fetch; no SDK. Messages name buckets and keys, never URLs or credentials.
import crypto from "node:crypto";

const sha256 = data => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
// RFC 3986 encoding, as SigV4 requires.
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function credentials(env) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error("--remote needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the environment");
  return { id: env.AWS_ACCESS_KEY_ID, secret: env.AWS_SECRET_ACCESS_KEY, token: env.AWS_SESSION_TOKEN, region: env.AWS_REGION || "us-east-1" };
}

// -> URL signed in its query string (host is the only signed header; the payload is unsigned).
export async function presign({ method, url, expiresSec, now = new Date(), env }) {
  const { id, secret, token, region } = credentials(env);
  const u = new URL(url);
  const date = now.toISOString().replace(/[-:]|\.\d{3}/g, ""); // 20130524T000000Z
  const scope = `${date.slice(0, 8)}/${region}/s3/aws4_request`;
  const params = { "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${id}/${scope}`, "X-Amz-Date": date, "X-Amz-Expires": String(expiresSec), ...(token && { "X-Amz-Security-Token": token }), "X-Amz-SignedHeaders": "host" };
  const query = Object.keys(params).sort().map(k => `${enc(k)}=${enc(params[k])}`).join("&");
  const path = u.pathname.split("/").map(s => enc(decodeURIComponent(s))).join("/");
  const request = [method, path, query, `host:${u.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const key = ["s3", "aws4_request"].reduce(hmac, hmac(hmac(`AWS4${secret}`, date.slice(0, 8)), region));
  const signature = crypto.createHmac("sha256", key).update(["AWS4-HMAC-SHA256", date, scope, sha256(request)].join("\n")).digest("hex");
  return new URL(`${u.origin}${path}?${query}&X-Amz-Signature=${signature}`);
}

// -> { tables: { <table>: { url, bytes } }, expiresAt }, or throws naming the table or bucket and the problem.
export async function remote(snapshots, target, { expiresSec, env, now = new Date() }) {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(target);
  if (!m) throw new Error(`--remote must be an s3://<bucket>/<prefix> URL, not ${target}`);
  const [, bucket, rawPrefix] = m;
  // S3 bucket naming rules, so the bucket can never change the host or path it is sent to.
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`--remote: "${bucket}" is not a valid S3 bucket name (3-63 lowercase letters, digits, dots and hyphens)`);
  // The prefix is path data: each segment is percent-encoded, so "#" or "?" stays part of the key.
  const prefix = rawPrefix.split("/").filter(Boolean).map(enc).join("/");
  const { region } = credentials(env);
  // With an endpoint (SeaweedFS and other non-AWS stores) path-style, otherwise AWS virtual-hosted style.
  const base = env.AWS_ENDPOINT_URL ? `${env.AWS_ENDPOINT_URL.replace(/\/+$/, "")}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`;
  const call = async (what, method, key, init) => {
    const url = await presign({ method, url: `${base}/${key}`, expiresSec: method === "GET" ? expiresSec : 900, now, env });
    try {
      // No redirect following: a 3xx must be reported as itself, not as the status of wherever it points.
      return await fetch(url, { method, redirect: "manual", ...init });
    } catch (e) {
      throw new Error(`${what}: ${method} s3://${bucket}/${key} failed (${e.cause?.code ?? e.message})`);
    }
  };
  const tables = {};
  for (const [name, bytes] of Object.entries(snapshots)) {
    const key = [prefix, `${sha256(bytes)}.parquet`].filter(Boolean).join("/");
    const what = `table "${name}"`;
    // An object under its content hash already holds these bytes: never upload (or overwrite) it again.
    const head = await call(what, "HEAD", key);
    if (head.status === 404) {
      const put = await call(what, "PUT", key, { body: bytes });
      if (!put.ok) throw new Error(`${what}: PUT s3://${bucket}/${key} returned ${put.status}`);
    } else if (head.status !== 200) throw new Error(`${what}: HEAD s3://${bucket}/${key} returned ${head.status}`);
    tables[name] = { url: String(await presign({ method: "GET", url: `${base}/${key}`, expiresSec, now, env })), bytes: bytes.length };
  }
  // A page opened from file:// sends Origin: null; without a matching CORS rule every table fetch fails in the browser.
  for (const [name, { url }] of Object.entries(tables)) {
    const what = `table "${name}"`;
    let res;
    try {
      res = await fetch(url, { headers: { Range: "bytes=0-0", Origin: "null" }, redirect: "manual" });
    } catch (e) {
      throw new Error(`${what}: the preflight GET to bucket ${bucket} failed (${e.cause?.code ?? e.message})`);
    }
    await res.body?.cancel();
    const allow = res.headers.get("access-control-allow-origin");
    const hint = "add a bucket CORS rule that allows GET from any origin (file:// sends Origin: null) and exposes Content-Length and Content-Range";
    if (res.status !== 206) throw new Error(`${what}: the preflight range GET to bucket ${bucket} returned ${res.status}, not 206; check the bucket CORS rule: ${hint}`);
    if (allow !== "null" && allow !== "*") throw new Error(`${what}: bucket ${bucket} sends no CORS header for Origin: null; ${hint}`);
  }
  return { tables, expiresAt: new Date(now.getTime() + expiresSec * 1000).toISOString() };
}
