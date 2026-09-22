# StreamFX — LOCAL ONLY

Studio điều khiển hiệu ứng livestream: project, effect, nút Stream Deck, trigger mock, upload media, browser overlay và TTS.

**Không có xác thực người dùng. Chỉ dùng trên máy cá nhân đáng tin cậy. Không mở port ra LAN/Internet, không dùng tunnel hoặc reverse proxy công khai.** `DEV_USER_ID` chỉ phân vùng dữ liệu, không phải đăng nhập. CORS không thay thế xác thực. Các tiến trình khác trên máy vẫn có thể gọi API.

## Yêu cầu

- Node.js **>=22.14.0**, khuyến nghị Node 22 LTS bản vá mới nhất; npm >=10.
- PostgreSQL 16 local. Redis 7 tùy chọn cho cooldown.
- Docker Desktop chỉ cần nếu chọn chạy PostgreSQL/Redis bằng Compose. **Máy thực hiện đóng gói hiện chưa cài Docker; chưa kiểm chứng Compose bằng runtime.**
- npm là trình quản lý package duy nhất; commit `package-lock.json`, dùng `npm ci`. Không dùng pnpm.

## Cài đặt Windows (PowerShell)

1. Mở terminal tại thư mục gốc repository. Kiểm tra Node/npm rồi cài dependency:

	```powershell
	node --version
	npm --version
	npm ci
	```

2. Tạo cấu hình nếu chưa có. Không ghi đè `.env` hiện tại:

	```powershell
	if (!(Test-Path .env)) { Copy-Item .env.example .env }
	```

	Sửa `DATABASE_URL` theo PostgreSQL của bạn. Mặc định ví dụ khớp Compose. Để `REDIS_URL=` trống nếu dùng cooldown trong bộ nhớ; đặt `redis://127.0.0.1:6379` nếu dùng Redis local. Server đọc `.env` ở gốc; biến môi trường có sẵn được ưu tiên. `UPLOAD_DIR` tương đối với gốc repository.

3. Chuẩn bị database. Nếu đã cài và chạy Docker Desktop:

	```powershell
	docker compose up -d --wait
	```

	Compose chỉ chạy PostgreSQL/Redis, không chạy ứng dụng. Port chỉ publish tại `127.0.0.1`. Nếu không có Docker, cài PostgreSQL local, tạo user/database rồi cập nhật `DATABASE_URL`; Redis không bắt buộc.

4. Sinh Prisma Client và áp dụng migration. Seed dữ liệu mẫu là tùy chọn:

	```powershell
	npm run prisma:generate
	npm run prisma:migrate
	npm run prisma:seed
	```

5. Chạy chế độ phát triển:

	```powershell
	npm run dev
	```

	Mở `http://127.0.0.1:3000`. Next.js, REST API, `/assets/` và `/ws` dùng chung server/port. Dừng bằng Ctrl+C. Dùng script gốc, không chạy Next riêng vì thiếu API/WebSocket. Package dùng chung được build trước dev; sau khi sửa package, chạy lại dev để build lại.

6. Mở project trong studio; sao chép URL overlay vào OBS Browser Source trên **cùng máy**. Giữ overlay mở khi phát hiệu ứng. TTS/âm thanh phụ thuộc giọng hệ điều hành, hỗ trợ trình duyệt/OBS và chính sách autoplay; cần kiểm tra trực tiếp trên máy sử dụng.

## Bản build local

Sau khi hoàn thành cấu hình/database:

```powershell
npm run prisma:generate
npm run build
npm start
```

Build theo thứ tự types → protocol → API → web. Package dùng chung xuất `dist/index.js` và declaration; API production không biên dịch file test. `npm start` dùng bản build, không tự build hoặc migrate. “Production” chỉ là chế độ build tối ưu, **không có nghĩa an toàn để public**.

`STREAMFX_HOST` chỉ nhận `127.0.0.1`, `::1` hoặc `localhost` (được đổi thành `127.0.0.1`). Host khác bị từ chối vì ứng dụng không có auth. Với `::1`, mở `http://[::1]:3000`. `PORT` phải là số nguyên 1–65535. Không cấu hình CORS origin công khai.

## Tính năng và giới hạn

- Effect chứa các action tuần tự: `image`, `video`, `audio`, `tts`, `confetti`, `wait`, `clear`, `stop`; mode `QUEUE`, `REPLACE`, `DROP`.
- Cooldown cho effect/button/trigger. Không dùng Redis: bộ nhớ riêng tiến trình, mất khi restart. Có Redis nhưng Redis lỗi: không tự chuyển sang bộ nhớ để tránh vượt cooldown.
- CRUD project/effect/button/trigger, cài đặt overlay, điều khiển phát và sự kiện mock. TikTok chỉ là placeholder; event TikTok trả `501`, **không kết nối TikTok thật**.
- Media lưu local trong `data/uploads`; giới hạn mặc định 10 MiB/file, kiểm tra MIME và dung lượng, lưu SHA-256. Chưa kiểm tra magic bytes, quét malware hoặc có adapter S3/R2.
- WebSocket phục vụ overlay đang kết nối; không có hàng đợi bền vững/replay hiệu ứng sau mất kết nối. Không triển khai đa instance.
- Sao lưu cả PostgreSQL lẫn thư mục upload. Không commit `.env`, upload hay dữ liệu riêng. Compose dùng mật khẩu mẫu local, không dùng cho môi trường công khai.

## API chính

- CRUD project: `/api/projects`, `/api/projects/:id`
- Effect/button/trigger: `/api/projects/:id/effects`, `/api/projects/:id/buttons`, `/api/projects/:id/triggers` (item dùng `/:childId`)
- Settings: `PATCH /api/projects/:id/settings`
- Upload/delete: `/api/projects/:id/assets`
- Phát effect: `POST /api/projects/:id/fire/:effectId`; nút: `POST /api/projects/:id/buttons/:childId/fire`
- Điều khiển: `POST /api/projects/:id/control`; sự kiện: `POST /api/projects/:id/events`
- Provider: `GET /api/providers`; WebSocket: `/ws`
- `/health`: tiến trình sống; `/ready`: kiểm tra PostgreSQL, không kiểm tra Redis.

## Kiểm tra không khởi động server

```powershell
npm run prisma:generate
npm test
npm run typecheck
npm run build
```

CI chạy `npm ci`, generate, test, typecheck, build trên Windows/Linux với Node 22.14.0 và URL database giả. Test hiện tại không thay thế kiểm thử PostgreSQL/Redis thật hoặc OBS. Không tự chạy migration hay server trong CI. Script `test:e2e` chỉ dành cho Playwright khi đã có bộ test/cấu hình phù hợp; không nằm trong kiểm chứng đóng gói này.

Nếu port 3000 bị chiếm, đổi `PORT` trong `.env`. Nếu `/ready` trả `503`, kiểm tra PostgreSQL và `DATABASE_URL`. Sau khi sửa dependency, dùng `npm install` để cập nhật lockfile rồi commit cả manifest và lockfile.
