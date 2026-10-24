// Salin file ini menjadi config.js lalu isi nilai dari project Supabase dan Cloudflare Worker.
// Jangan pernah memasukkan service_role key, R2 secret, atau kunci rahasia server ke file ini.
window.USTWO_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  MEDIA_WORKER_URL: "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
  // Isi tepat dua UUID user Supabase setelah kedua akun dibuat.
  ALLOWED_USER_IDS: ["FIRST_USER_UUID", "SECOND_USER_UUID"],
  // Nama tampilan lokal; tidak memengaruhi autentikasi.
  DISPLAY_NAMES: { "FIRST_USER_UUID": "Aku", "SECOND_USER_UUID": "Kamu" }
};
