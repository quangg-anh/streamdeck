# StreamFX — Local Only

[🇻🇳 Tiếng Việt](#-tiếng-việt) · [🇬🇧 English](#-english)

---

## 🇻🇳 Tiếng Việt

### Đây là gì?

**StreamFX** là công cụ điều khiển hiệu ứng livestream chạy **hoàn toàn trên máy bạn** (local only).

Bạn có thể:

- Tạo **project** — mỗi project là một bản dựng riêng với overlay riêng.
- Tạo **effect** — mỗi effect là một chuỗi hành động chạy tuần tự: hiện ảnh, phát video/âm thanh, đọc TTS, bắn confetti, chờ, xóa màn hình, dừng.
- Gắn effect vào **nút Stream Deck** và **trigger** sự kiện (mock).
- **Upload media** (ảnh/video/âm thanh) dùng cho effect.
- Mở **browser overlay** trong OBS để hiện hiệu ứng khi livestream.

```
Bạn bấm nút ──► API trên máy ──► Overlay trong OBS ──► Hiệu ứng hiện ra
```

### ⚠️ Lưu ý quan trọng

- **Bắt buộc đăng nhập.** Một trang login chung tại `/login` cho cả admin và user.
- **User không tự đăng ký được.** Admin tạo tài khoản và cấp gói (số stream deck + thời hạn) qua Admin Panel.
- Cookie session hết hạn sau **7 ngày**.
- **Không mở port ra LAN/Internet**, không dùng tunnel hay reverse proxy công khai. Ứng dụng **chưa đủ an toàn để public**.
- Các tiến trình khác trên cùng máy vẫn có thể gọi API nếu có cookie — CORS không thay thế xác thực.

### Yêu cầu

| Thành phần | Yêu cầu |
|---|---|
| Node.js | **≥ 22.14.0** (khuyến nghị Node 22 LTS bản vá mới nhất) |
| npm | ≥ 10 — npm là package manager **duy nhất**, không dùng pnpm |
| PostgreSQL | 16, chạy local |
| Docker Desktop | Chỉ cần nếu chạy PostgreSQL bằng Compose |

### Cài đặt (Windows / PowerShell)

**Bước 1 — Kiểm tra môi trường và cài dependency**

Mở terminal tại thư mục gốc repository:

```powershell
node --version
npm --version
npm ci
```

**Bước 2 — Tạo file cấu hình `.env`**

Chỉ tạo nếu chưa có (không ghi đè `.env` hiện tại):

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Sau đó mở `.env` và sửa các giá trị chính:

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL của bạn (ví dụ mặc định khớp Compose) |
| `COOLDOWN_STORE` | Để trống = dùng PostgreSQL (cooldown giữ nguyên khi restart). Đặt `memory` = mất cooldown khi restart |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Tài khoản admin tạo bởi seed (mặc định `admin` / `admin12345` — **đổi ngay sau lần đăng nhập đầu**) |
| `PORT` | Cổng server, mặc định `3000` |
| `UPLOAD_DIR` | Thư mục lưu media, mặc định `data/uploads` (tương đối với gốc repo) |

> Server đọc `.env` ở gốc repo; biến môi trường có sẵn được ưu tiên.

**Bước 3 — Khởi động PostgreSQL**

Nếu đã cài Docker Desktop:

```powershell
docker compose up -d --wait
```

Compose **chỉ chạy PostgreSQL**, không chạy ứng dụng; port chỉ publish tại `127.0.0.1`.

Nếu không có Docker: cài PostgreSQL trực tiếp, tạo user/database rồi điền vào `DATABASE_URL`.

**Bước 4 — Tạo database schema và tài khoản admin**

```powershell
npm run prisma:generate   # Sinh Prisma Client
npm run prisma:migrate    # Áp dụng migration
npm run prisma:seed       # Tạo admin (đọc ADMIN_USERNAME/ADMIN_PASSWORD từ .env)
```

**Bước 5 — Chạy chế độ phát triển**

```powershell
npm run dev
```

Mở `http://127.0.0.1:3000` — sẽ chuyển hướng tới `/login`.

- Đăng nhập bằng **admin** → mở Admin Panel (quản lý user, cấp gói).
- Đăng nhập bằng **user** → mở dashboard stream deck.

Dừng server bằng `Ctrl+C`.

> ⚠️ Dùng script `npm run dev` gốc, **đừng** chạy Next.js riêng — sẽ thiếu API/WebSocket. Package dùng chung được build trước khi dev; sau khi sửa package, chạy lại `dev` để build lại.

**Bước 6 — Dùng với OBS**

1. Mở một project trong studio.
2. Sao chép **URL overlay** (có token riêng) vào Browser Source của OBS **trên cùng máy**.
3. Giữ overlay mở khi phát hiệu ứng.
4. TTS/âm thanh phụ thuộc giọng hệ điều hành, hỗ trợ trình duyệt/OBS và chính sách autoplay — cần kiểm tra trực tiếp trên máy sử dụng.

### Build bản production (local)

Sau khi hoàn thành cấu hình và database:

```powershell
npm run prisma:generate
npm run build
npm start
```

- Build theo thứ tự: **types → protocol → API → web**.
- `npm start` chỉ chạy bản build có sẵn, **không** tự build hay migrate.
- "Production" ở đây chỉ là chế độ build tối ưu, **không có nghĩa an toàn để public**.

Cấu hình host/port trong `.env`:

- `STREAMFX_HOST`: chỉ nhận `127.0.0.1`, `::1` hoặc `localhost`. Host khác bị **từ chối**. Với `::1`, mở `http://[::1]:3000`.
- `PORT`: số nguyên 1–65535.
- Không cấu hình CORS origin công khai.

### Tính năng và giới hạn

**Auth & gói dịch vụ**

- Một cổng login `/login` cho cả admin và user.
- Admin Panel: tạo/khóa/xóa user, cấp `deckLimit` (số stream deck) và `planDays` (hạn sử dụng).
- Vượt quota hoặc hết hạn: **không tạo được deck mới** (HTTP 402), vẫn xem được deck hiện có.
- Gia hạn gói **cộng dồn** vào hạn hiện tại.

**Effect & phát hiệu ứng**

- Effect = chuỗi action tuần tự: `image`, `video`, `audio`, `tts`, `confetti`, `wait`, `clear`, `stop`.
- 3 mode phát: `QUEUE` (xếp hàng), `REPLACE` (thay thế), `DROP` (bỏ qua).
- CRUD project/effect/button/trigger, cài đặt overlay, điều khiển phát, sự kiện mock.

**Cooldown**

- Áp dụng cho effect/button/trigger.
- Mặc định lưu PostgreSQL — giữ nguyên khi restart.
- `COOLDOWN_STORE=memory`: lưu trong RAM của tiến trình, mất khi restart.
- PostgreSQL lỗi: **không** tự chuyển sang memory (tránh vượt cooldown).

**Overlay & media**

- Overlay truy cập bằng URL có token riêng (`overlayToken`) — không cần cookie session.
- Media lưu local trong `data/uploads`: giới hạn 10 MiB/file, kiểm tra MIME và dung lượng, lưu SHA-256.
- **Chưa có**: kiểm tra magic bytes, quét malware, adapter S3/R2.

**Khác**

- TikTok chỉ là placeholder — event TikTok trả `501`, **không kết nối TikTok thật**.
- WebSocket chỉ phục vụ overlay đang kết nối; **không có** hàng đợi bền vững/replay sau mất kết nối; không hỗ trợ đa instance.

### API chính

| Nhóm | Endpoint |
|---|---|
| **Auth** | `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/password` |
| **Admin** | `GET\|POST /api/admin/users` · `PATCH\|DELETE /api/admin/users/:id` |
| **Project** | `/api/projects` · `/api/projects/:id` |
| **Effect / Button / Trigger** | `/api/projects/:id/effects` · `.../buttons` · `.../triggers` (item dùng `/:childId`) |
| **Settings** | `PATCH /api/projects/:id/settings` |
| **Media** | `/api/projects/:id/assets` (upload/delete) |
| **Phát effect** | `POST /api/projects/:id/fire/:effectId` |
| **Phát nút** | `POST /api/projects/:id/buttons/:childId/fire` |
| **Điều khiển** | `POST /api/projects/:id/control` |
| **Sự kiện mock** | `POST /api/projects/:id/events` |
| **Provider** | `GET /api/providers` |
| **WebSocket** | `/ws` (subscribe kèm `overlayToken`) |
| **Sức khỏe** | `/health` (tiến trình sống) · `/ready` (kiểm tra PostgreSQL) |

### Kiểm tra (không khởi động server)

```powershell
npm run prisma:generate
npm test
npm run typecheck
npm run build
```

- CI chạy `npm ci` → generate → test → typecheck → build trên **Windows/Linux** với Node 22.14.0 và URL database giả.
- Test **không** thay thế kiểm thử PostgreSQL thật hoặc OBS; CI không tự chạy migration hay server.
- `test:e2e` chỉ dành cho Playwright khi đã có bộ test phù hợp — không nằm trong kiểm chứng đóng gói.

### Xử lý sự cố

| Vấn đề | Cách xử lý |
|---|---|
| Port 3000 bị chiếm | Đổi `PORT` trong `.env` |
| `/ready` trả `503` | Kiểm tra PostgreSQL đang chạy và `DATABASE_URL` |
| Sửa dependency | Dùng `npm install` để cập nhật lockfile, commit cả `package.json` và `package-lock.json` |

### Sao lưu

- Sao lưu định kỳ: PostgreSQL và thư mục `data/uploads`.
- **Không commit**: `.env`, thư mục upload, dữ liệu riêng.
- Mật khẩu trong `docker-compose.yml` chỉ dùng local, không dùng cho môi trường công khai.

---

## 🇬🇧 English

### What is this?

**StreamFX** is a livestream effect controller that runs **entirely on your machine** (local only).

You can:

- Create **projects** — each project is its own build with its own overlay.
- Create **effects** — each effect is a sequence of actions: show an image, play video/audio, TTS speech, confetti, wait, clear screen, stop.
- Bind effects to **Stream Deck buttons** and mock **triggers**.
- **Upload media** (images/video/audio) for effects.
- Open a **browser overlay** in OBS to display effects while streaming.

```
Button press ──► Local API ──► OBS overlay ──► Effect plays
```

### ⚠️ Important notes

- **Login required.** One shared login page at `/login` for both admin and users.
- **Users cannot self-register.** Admin creates accounts and grants plans (deck count + expiry) via the Admin Panel.
- Session cookies expire after **7 days**.
- **Never expose ports to LAN/Internet**, never use public tunnels or reverse proxies. The app is **not safe to make public**.
- Other processes on the same machine can still call the API with a cookie — CORS does not replace authentication.

### Requirements

| Component | Requirement |
|---|---|
| Node.js | **≥ 22.14.0** (latest Node 22 LTS patch recommended) |
| npm | ≥ 10 — npm is the **only** package manager, no pnpm |
| PostgreSQL | 16, running locally |
| Docker Desktop | Only if you run PostgreSQL via Compose |

### Setup (Windows / PowerShell)

**Step 1 — Check environment and install dependencies**

Open a terminal at the repository root:

```powershell
node --version
npm --version
npm ci
```

**Step 2 — Create the `.env` config file**

Only if it doesn't exist (never overwrite an existing `.env`):

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Then edit `.env` — the key values:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string (default example matches Compose) |
| `COOLDOWN_STORE` | Empty = PostgreSQL (cooldowns survive restarts). `memory` = lost on restart |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin account created by the seed (default `admin` / `admin12345` — **change it right after first login**) |
| `PORT` | Server port, default `3000` |
| `UPLOAD_DIR` | Media folder, default `data/uploads` (relative to repo root) |

> The server reads `.env` from the repo root; pre-existing environment variables take priority.

**Step 3 — Start PostgreSQL**

If Docker Desktop is installed:

```powershell
docker compose up -d --wait
```

Compose **only runs PostgreSQL**, not the app; the port is published to `127.0.0.1` only.

Without Docker: install PostgreSQL directly, create a user/database, then fill in `DATABASE_URL`.

**Step 4 — Create the schema and admin account**

```powershell
npm run prisma:generate   # Generate Prisma Client
npm run prisma:migrate    # Apply migrations
npm run prisma:seed       # Create admin (reads ADMIN_USERNAME/ADMIN_PASSWORD from .env)
```

**Step 5 — Run in development mode**

```powershell
npm run dev
```

Open `http://127.0.0.1:3000` — it redirects to `/login`.

- Sign in as **admin** → Admin Panel (manage users, grant plans).
- Sign in as **user** → stream deck dashboard.

Stop with `Ctrl+C`.

> ⚠️ Use the original `npm run dev` script — **don't** run Next.js standalone (the API/WebSocket would be missing). Shared packages are built before dev; re-run `dev` after editing packages to rebuild.

**Step 6 — Use with OBS**

1. Open a project in the studio.
2. Copy the **overlay URL** (it has its own token) into an OBS Browser Source **on the same machine**.
3. Keep the overlay open while playing effects.
4. TTS/audio depends on OS voices, browser/OBS support, and the autoplay policy — verify on the actual machine.

### Local production build

After configuration and the database are ready:

```powershell
npm run prisma:generate
npm run build
npm start
```

- Build order: **types → protocol → API → web**.
- `npm start` runs the existing build only — it does **not** build or migrate.
- "Production" here just means an optimized build, **not public-safety**.

Host/port config in `.env`:

- `STREAMFX_HOST`: only `127.0.0.1`, `::1`, or `localhost` accepted. Other hosts are **rejected**. With `::1`, open `http://[::1]:3000`.
- `PORT`: integer 1–65535.
- Do not configure a public CORS origin.

### Features and limitations

**Auth & plans**

- One login page `/login` for admin and users.
- Admin Panel: create/lock/delete users, grant `deckLimit` (deck count) and `planDays` (expiry).
- Over quota or expired: **cannot create new decks** (HTTP 402), existing decks remain viewable.
- Renewals **extend** the current expiry date.

**Effects & playback**

- Effect = sequential actions: `image`, `video`, `audio`, `tts`, `confetti`, `wait`, `clear`, `stop`.
- 3 playback modes: `QUEUE`, `REPLACE`, `DROP`.
- CRUD for projects/effects/buttons/triggers, overlay settings, playback control, mock events.

**Cooldown**

- Applies to effects/buttons/triggers.
- Default store is PostgreSQL — survives restarts.
- `COOLDOWN_STORE=memory`: in-process memory, lost on restart.
- If PostgreSQL fails: does **not** fall back to memory (to prevent bypassing cooldowns).

**Overlay & media**

- The overlay is accessed via a URL with its own token (`overlayToken`) — no session cookie needed.
- Media stored locally in `data/uploads`: 10 MiB per file limit, MIME and size checks, SHA-256 stored.
- **Not implemented**: magic-byte validation, malware scanning, S3/R2 adapters.

**Other**

- TikTok is a placeholder only — TikTok events return `501`, **no real TikTok connection**.
- The WebSocket serves connected overlays only; **no** durable queue/replay after disconnect; no multi-instance support.

### API overview

| Group | Endpoints |
|---|---|
| **Auth** | `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `PATCH /api/auth/password` |
| **Admin** | `GET\|POST /api/admin/users` · `PATCH\|DELETE /api/admin/users/:id` |
| **Projects** | `/api/projects` · `/api/projects/:id` |
| **Effects / Buttons / Triggers** | `/api/projects/:id/effects` · `.../buttons` · `.../triggers` (items use `/:childId`) |
| **Settings** | `PATCH /api/projects/:id/settings` |
| **Media** | `/api/projects/:id/assets` (upload/delete) |
| **Fire effect** | `POST /api/projects/:id/fire/:effectId` |
| **Fire button** | `POST /api/projects/:id/buttons/:childId/fire` |
| **Control** | `POST /api/projects/:id/control` |
| **Mock events** | `POST /api/projects/:id/events` |
| **Providers** | `GET /api/providers` |
| **WebSocket** | `/ws` (subscribe with `overlayToken`) |
| **Health** | `/health` (process alive) · `/ready` (PostgreSQL check) |

### Testing (no server started)

```powershell
npm run prisma:generate
npm test
npm run typecheck
npm run build
```

- CI runs `npm ci` → generate → test → typecheck → build on **Windows/Linux** with Node 22.14.0 and a dummy database URL.
- Tests do **not** replace real PostgreSQL or OBS verification; CI never runs migrations or a server.
- `test:e2e` is only for Playwright when a proper test suite exists — not part of this packaging verification.

### Troubleshooting

| Problem | Fix |
|---|---|
| Port 3000 in use | Change `PORT` in `.env` |
| `/ready` returns `503` | Check PostgreSQL is running and `DATABASE_URL` |
| Dependency changes | Use `npm install` to update the lockfile; commit both the manifest and the lockfile |

### Backups

- Regularly back up: PostgreSQL and the `data/uploads` folder.
- **Never commit**: `.env`, uploaded media, private data.
- Passwords in `docker-compose.yml` are local-only samples, not for public environments.
