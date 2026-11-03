# ตั้ง Google login สำหรับเจ้าของบัญชี

ระบบใช้ Google OpenID Connect แบบ server flow ขอ scope `openid email` และตรวจว่าอีเมลตรงกับ `ALLOWED_EMAIL` ที่เก็บเป็น runtime secret ใน Worker

## ค่าที่ต้องเตรียม

- Origin: `https://finance-aaa-preview.<subdomain>.workers.dev`
- Authorized redirect URI: `<Origin>/auth/callback`
- อีเมลเจ้าของ: อีเมลเดียวกับบัญชี Cloudflare ตามที่เจ้าของยืนยัน

Origin ต้องตรงกับ `FINANCE_APP_ORIGIN` ใน Cloudflare Builds และไม่มี slash ท้าย ส่วน redirect URI ต้องตรงทุกตัวอักษร รวม `https` และ `/auth/callback`

## สร้าง client ใน Google Cloud

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) ด้วยบัญชี Google ของเจ้าของ เลือกโปรเจกต์ที่จะใช้สำหรับเว็บนี้ หรือสร้างโปรเจกต์แยกสำหรับ Finance ตามที่เจ้าของต้องการ
2. เปิด Google Auth Platform หากยังไม่ได้ตั้งค่า ให้ตั้ง Branding เป็นชื่อเว็บการเงิน และระบุ user support email / developer contact เป็นอีเมลเจ้าของ
3. สำหรับบัญชี Gmail ส่วนบุคคล เลือก audience แบบ External ระหว่างทดสอบเพิ่มอีเมลเจ้าของใน Test users หากหน้าตั้งค่าต้องการ
4. เปิด Clients → Create client → Application type: Web application ตั้งชื่อ client ให้ระบุว่าเป็นเว็บ Finance preview
5. ใส่ Authorized redirect URI ตามค่าที่เตรียมไว้ ช่อง Authorized JavaScript origins ใช้ Origin ของเว็บเดียวกันได้
6. เจ้าของกดสร้าง client และเก็บ client ID / client secret ในที่เก็บส่วนตัว ห้ามวาง secret ในแชท, GitHub, ภาพหน้าจอสาธารณะ หรือไฟล์ใต้ `public/`

## ใส่ค่าใน Cloudflare Worker

เปิด Worker `finance-aaa-preview` → Settings → Variables and Secrets แล้วตั้งชนิด Secret:

| ชื่อ | ค่า |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID จาก Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Client secret จาก Google Cloud |
| `ALLOWED_EMAIL` | อีเมลเจ้าของเพียงหนึ่งบัญชี |

Google secrets เป็น runtime secrets ของ Worker ส่วน `FINANCE_APP_ORIGIN` และ `FINANCE_D1_DATABASE_ID` เป็น build variables ของ Workers Builds ต้องตั้งในคนละส่วน

## ตรวจหลังตั้งค่า

เปิดเว็บทดสอบ กดเข้าสู่ระบบ Google และตรวจว่าเจ้าของเข้าได้ บัญชีอื่นถูกปฏิเสธ ออกจากระบบแล้วเปิด API ไม่ได้ และโหมด local login ใช้บน public host ไม่ได้ ใช้ข้อมูลจำลองในการทดสอบฟีเจอร์จนกว่าจะตกลงย้ายข้อมูลจริง

หากพบ `redirect_uri_mismatch` ให้เทียบ Origin และ redirect URI ใน Google Cloud กับ Worker ทุกตัวอักษร หากยังไม่ได้ตั้ง client ระบบจะปิดการเข้าใช้งานไว้ด้วยสถานะ `AUTH_NOT_CONFIGURED`

อ้างอิง: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
