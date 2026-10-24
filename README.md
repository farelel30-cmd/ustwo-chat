# UsTwo Chat ♡

Starter website chat privat dua akun dengan tema pink-putih. Frontend statis (GitHub Pages), Supabase Auth + Postgres/Realtime untuk chat, dan Cloudflare R2 melalui Worker untuk media privat.

## Fitur di starter ini
- Login email/password (tidak ada tombol daftar publik; buat kedua akun melalui dashboard Supabase).
- Chat teks real-time, waktu pesan, indikator mengetik, dan status dibaca.
- Rekam pesan suara dari browser yang mendukung MediaRecorder.
- Kirim foto/video tanpa kompresi ulang oleh aplikasi; file asli disimpan di R2.
- URL unduhan bertanda tangan dan kedaluwarsa; Worker hanya mengizinkan dua UUID yang dikonfigurasi.
- Tampilan responsif untuk ponsel dan desktop.

## Batasan versi awal
- Worker memakai unggahan `PutObject` tunggal, dengan batas maksimal 5 GB per file sesuai batas objek R2. Upload yang sangat besar tetap memerlukan koneksi stabil; upload multipart/resumable belum dibuat.
- Kuota penyimpanan/egress dan ketentuan gratis bergantung pada paket provider yang aktif. Gratis tidak berarti tanpa batas.
- Ini starter yang perlu dikonfigurasi dan diuji di akun milikmu. Belum live, belum tersambung ke project Supabase/R2 milikmu, dan belum ada kredensial yang ditanamkan.
- Browser/OS bisa memiliki batas file, memori, atau izin mikrofon. Video iPhone dalam format HEVC/MOV bisa tidak dapat diputar inline di sebagian browser Android; file aslinya tetap dapat diunduh. Konversi tidak dilakukan agar kualitas tidak berubah.

## A. Buat Supabase
1. Buat project baru di https://supabase.com/.
2. Buka SQL Editor, jalankan seluruh isi `supabase.sql`.
3. Buka Authentication → Users dan buat tepat dua user dengan email yang kamu dan pasangan kendalikan. Jika konfirmasi email aktif, konfirmasi keduanya.
4. Salin UUID masing-masing user. Pada bagian paling akhir `supabase.sql`, ganti `UUID_AKUN_FAREL` dan `UUID_AKUN_PACAR` serta nama, lalu jalankan perintah INSERT itu sekali.
5. Buka Project Settings → API. Ambil Project URL dan anon/publishable key. Hanya key publik ini yang boleh masuk ke frontend.
6. Pastikan Realtime aktif untuk tabel `public.messages` (Database → Publications/Replication bila perlu).

## B. Siapkan Cloudflare R2 dan Worker
1. Buat akun Cloudflare dan bucket R2 bernama misalnya `ustwo-private-media`.
2. Buat R2 API token yang hanya memiliki akses Object Read & Write untuk bucket itu. Catat Access Key ID, Secret Access Key, Account ID, dan nama bucket. Jangan masukkan secret ini ke `config.js`.
3. Pasang Node.js LTS pada komputer. Buka terminal di folder `worker` lalu jalankan:
   ```sh
   npm install
   npx wrangler login
   ```
4. Edit `worker/wrangler.toml`: isi `ALLOWED_ORIGINS` dengan origin GitHub Pages milikmu (contoh `https://farelel30-cmd.github.io`) dan `ALLOWED_USER_IDS` dengan dua UUID yang sama persis dengan Supabase. Isi `SUPABASE_URL`.
5. Set variabel rahasia server satu per satu:
   ```sh
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   ```
6. Isi `R2_BUCKET` dan `R2_ACCOUNT_ID` sebagai vars di `wrangler.toml` atau rahasia Worker. Jangan menaruh secret di file yang di-commit.
7. Pada bucket R2, set CORS memakai `worker/r2-cors.example.json`, ganti origin contoh dengan origin situsmu. Browser perlu izin PUT dari origin situs.
8. Deploy dari folder `worker`:
   ```sh
   npx wrangler deploy
   ```
   Catat URL Worker yang diberikan.

## C. Konfigurasi frontend
1. Salin `config.example.js` menjadi `config.js`.
2. Isi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MEDIA_WORKER_URL`, dua UUID di `ALLOWED_USER_IDS`, dan nama tampilan di `DISPLAY_NAMES`.
3. `config.js` sengaja masuk `.gitignore` agar tidak ikut ter-commit. Untuk GitHub Pages, karena frontend statis perlu membaca konfigurasi saat runtime, buat `config.js` melalui cara deploy privat yang aman untuk key publik; anon/publishable key memang bukan secret, tetapi UUID dan URL Worker tetap sebaiknya dipahami sebagai informasi konfigurasi, bukan kredensial. Jangan pernah masukkan service-role key atau R2 secret ke frontend.
4. Untuk uji lokal, jalankan Live Server dari VS Code. Jangan membuka `index.html` melalui `file://`.

## D. Publikasikan di GitHub Pages
1. Buat repository baru bernama `ustwo-chat` di akun GitHub.
2. Upload file frontend (`index.html`, `style.css`, `app.js`, `config.js`) ke root repo. `config.js` dibuat khusus untuk deploy dan berisi hanya URL/key publik serta UUID allowlist, tidak ada secret server. Simpan `supabase.sql`, `README.md`, dan folder `worker` juga jika ingin versioning.
3. Settings → Pages → Deploy from a branch → `main` → `/(root)` → Save.
4. Tambahkan origin dan URL situs ke konfigurasi Worker/CORS yang sesuai. Karena GitHub Pages bersifat publik, jangan taruh pesan, foto, atau file pribadi dalam repo.

## Keamanan penting
- Tabel `messages` memakai RLS dan hanya user yang terdaftar di `chat_members` yang dapat membaca/mengirim.
- Worker memverifikasi token login ke Supabase Auth, lalu mengecek UUID pada allowlist server-side sebelum menerbitkan URL media.
- Kedua UUID harus sama di tabel `chat_members`, `config.js`, dan `worker/wrangler.toml`.
- Jangan pernah membagikan `SUPABASE_SERVICE_ROLE_KEY`, R2 secret, atau token API. Jika bocor, rotasi segera.
- Sebelum mengirim foto pribadi, uji dulu dengan file non-pribadi dan pastikan akun ketiga tidak bisa membaca chat/media.
