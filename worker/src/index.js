import { AwsClient } from "aws4fetch";

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
const SIGNED_URL_SECONDS = 900;

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Vary": "Origin" }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const corsOrigin = allowedOrigins.includes(origin) ? origin : "null";
    if (request.method === "OPTIONS") {
      if (corsOrigin === "null") return new Response("Origin not allowed", { status: 403 });
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" } });
    }
    if (corsOrigin === "null") return json({ error: "Origin tidak diizinkan." }, 403, "null");
    const url = new URL(request.url);
    if (request.method !== "POST" || !["/sign-upload", "/sign-download"].includes(url.pathname)) return json({ error: "Endpoint tidak ditemukan." }, 404, corsOrigin);
    try {
      const auth = request.headers.get("Authorization") || "";
      if (!auth.startsWith("Bearer ")) return json({ error: "Login diperlukan." }, 401, corsOrigin);
      const token = auth.slice(7);
      const userRes = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", { headers: { "Authorization": "Bearer " + token, "apikey": env.SUPABASE_SERVICE_ROLE_KEY } });
      if (!userRes.ok) return json({ error: "Sesi login tidak valid." }, 401, corsOrigin);
      const user = await userRes.json();
      const allowed = (env.ALLOWED_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!user?.id || !allowed.includes(user.id)) return json({ error: "Akun ini tidak diizinkan." }, 403, corsOrigin);

      const body = await request.json();
      let key;
      let mimeType = "application/octet-stream";
      if (url.pathname === "/sign-upload") {
        const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 180) : "file";
        mimeType = typeof body.mimeType === "string" ? body.mimeType.slice(0, 120) : mimeType;
        const fileSize = Number(body.fileSize);
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) return json({ error: "Ukuran file harus lebih dari 0 dan maksimal 5 GB per file." }, 413, corsOrigin);
        if (!/^(image|video|audio)\//.test(mimeType)) return json({ error: "Jenis file tidak didukung." }, 415, corsOrigin);
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "media";
        key = user.id + "/" + crypto.randomUUID() + "-" + safeName;
      } else {
        key = typeof body.key === "string" ? body.key : "";
        if (!allowed.some(id => key.startsWith(id + "/")) || key.includes("..") || key.startsWith("/")) return json({ error: "Akses file ditolak." }, 403, corsOrigin);
      }

      if (!env.R2_ACCOUNT_ID || env.R2_ACCOUNT_ID.startsWith("GANTI_") || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return json({ error: "Penyimpanan R2 belum dikonfigurasi." }, 503, corsOrigin);
      const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
      const objectUrl = "https://" + env.R2_ACCOUNT_ID + ".r2.cloudflarestorage.com/" + encodeURIComponent(env.R2_BUCKET) + "/" + key.split("/").map(encodeURIComponent).join("/");
      const method = url.pathname === "/sign-upload" ? "PUT" : "GET";
      const headers = method === "PUT" ? { "Content-Type": mimeType } : {};
      const signed = await aws.sign(objectUrl, { method, headers, aws: { signQuery: true, expires: SIGNED_URL_SECONDS } });
      return json({ url: signed.url, key: url.pathname === "/sign-upload" ? key : undefined, expiresIn: SIGNED_URL_SECONDS }, 200, corsOrigin);
    } catch (error) {
      console.error(error);
      return json({ error: "Worker gagal memproses permintaan." }, 500, corsOrigin);
    }
  }
};
