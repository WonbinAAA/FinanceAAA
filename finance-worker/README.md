# Finance Worker — ระบบใหม่ระหว่างพัฒนา

ระบบ Workers + D1 ใน repository FinanceAAA เดิม พอร์ตหน้าจอและกฎที่ไม่เกี่ยวกับสูตรหนี้จาก Apps Script v53 (`f5873ef`) เว็บ GitHub Pages และ Apps Script เดิมยังทำงานแยกกัน ไม่มีการย้ายเว็บหลักหรืออ่าน/แก้ข้อมูลเงินจริงระหว่างพัฒนา

การตัดสินใจของเจ้าของ: Google login เฉพาะบัญชีเดียว, ทดสอบบน workers.dev, เริ่มฐานใหม่แล้วนำเข้าประวัติภายหลัง, หนี้คงเหลือรวมเงินต้น + ดอกเบี้ยค้าง + ค่าธรรมเนียมค้าง โดยกรอกจากใบแจ้งยอด ไม่มีการสมมติอัตราหรือคิดดอกเบี้ยรายวัน

## รันในเครื่อง

ใช้ Node 22.13 ขึ้นไป (แนะนำ Node 24 LTS) และ npm:

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# แก้ .dev.vars: APP_ORIGIN=http://127.0.0.1:8787 และ LOCAL_DEV_LOGIN=true
npm run db:local
npm run dev
```

เปิด http://127.0.0.1:8787 แล้วเลือกทดสอบในเครื่อง ใช้ข้อมูลจำลองเท่านั้น โหมดนี้ถูกปฏิเสธบน public host แม้เปิด flag ผิด ข้อมูลจำลองอยู่ใน `.wrangler/` ไม่ถูกคัดลอกไป GitHub หรือฐาน Cloudflare

```powershell
npm test
npm run build
```

ชุดทดสอบครอบคลุมบัญชีและเงินสด, รายรับ/รายจ่าย, โอน, VOID/DRAFT, กองกลาง/โปรเจกต์, ส่วนขาดที่ต้องยืนยัน, จับคู่เงินคืนเฉพาะที่เลือก, รายการประจำ, หนี้แยกส่วนประกอบ, การเขียน D1 ทั้งชุด, คำขอซ้ำ/การแก้พร้อมกัน, OAuth/CSRF, นำเข้าและเทียบยอด นอกจากนี้มี `scripts/smoke-local.mjs` สำหรับ Playwright ที่ติดตั้งไว้แล้ว ใช้ Edge แบบ headless กับข้อมูลจำลองบน loopback เท่านั้น

## เชื่อม Cloudflare และ GitHub

1. ใน Cloudflare Workers & Pages เลือก Create application → Connect GitHub และให้ GitHub App เข้าถึงเฉพาะ `WonbinAAA/FinanceAAA` เจ้าของดำเนินการยืนยันตัวตน/อนุญาตสิทธิ์ในหน้า GitHub เอง
2. ตั้ง Worker name = `finance-aaa-preview`, branch = `cloudflare-d1`, root directory = `finance-worker`, build command = `npm test && npm run build`, deploy command = `npm run deploy` และ watch path = `finance-worker/**` คง GitHub Pages บน branch เดิม
3. ใช้ D1 ใหม่ชื่อ `finance-aaa-preview` สำหรับระบบทดสอบโดยเฉพาะ กำหนด build variables `FINANCE_D1_DATABASE_ID` เป็น ID ฐานนี้ และ `FINANCE_APP_ORIGIN` เป็น `https://finance-aaa-preview.<subdomain>.workers.dev` จริง ไม่มี slash ท้าย ค่าทั้งสองไม่ใช่ password/token
4. Schema ต้องถูก apply เฉพาะฐานใหม่ก่อนเข้าใช้งาน ในเครื่องทำได้ด้วย `node scripts/check-release.mjs --deploy` แล้ว `npx wrangler d1 migrations apply DB --remote --config wrangler.deploy.json` ตรวจชื่อฐานก่อนยืนยัน ค่าตั้งต้นใน `wrangler.jsonc` เป็น placeholder สำหรับ local เท่านั้น
5. Cloudflare Builds เรียก `npm run deploy` ซึ่งสร้าง `wrangler.deploy.json` ระหว่าง build และเปิดโหมด preview ที่ไม่รองรับ local login
6. สร้าง Google OAuth client แบบ Web application และตั้ง runtime secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL` ใน Worker ดู [คู่มือตั้ง Google login](GOOGLE-LOGIN-SETUP.md)

การ deploy ผ่าน GitHub ไม่ต้องเข้าสู่ Wrangler ในเครื่องทุกครั้ง หากต้องใช้ CLI เพื่อดูแลฐานหรือ deploy โดยตรงภายหลัง ให้เชื่อมบัญชี Cloudflare ของเจ้าของในครั้งที่จำเป็นด้วย `npx wrangler login` และใช้ config สำหรับฐาน preview ที่เตรียมไว้

Build variables กับ runtime secrets เป็นคนละส่วน Cloudflare Builds ต้องได้สอง build variables ข้างต้น ส่วน Google secret และอีเมลอยู่ที่ Variables & Secrets ของ Worker ไม่พิมพ์ลง log ไม่มีการใช้ GitHub Actions token เพื่อ deploy โดยอัตโนมัติ

ก่อนเปลี่ยนเว็บหลัก ต้องทดสอบ Google login จริง/บัญชีที่ไม่อนุญาต, reload/หมดอายุ session, ขนาดมือถือ, ฟีเจอร์ครบ, backup/restore, ผลเทียบยอด ณ เวลาเดียวกัน และตรวจหนี้กับใบแจ้งยอดของเจ้าของ จากนั้นตกลงช่วงหยุดบันทึกและแผนย้อนกลับกับเจ้าของ

## โครงสร้างและข้อจำกัด

- `src/legacy-engine.js` เป็นพอร์ตแบบ static ไม่มี eval ไม่มี Google runtime; `src/debt-components.js` แทนส่วนเขียนหนี้เก่าด้วยการแยกยอดตามที่เจ้าของเลือก
- D1 เก็บ record พร้อมรหัส, field เดิม, ลำดับแถว และเงินเป็น integer สตางค์ใน `money_json`; ตารางเก็บข้อมูลความเข้ากันได้เพื่อไม่ให้ field เก่าสูญหาย
- ทุก mutation อ่าน snapshot ที่สอดคล้องกัน แล้ว commit ข้อมูลพร้อม audit และ idempotency receipt ใน D1 batch เดียว มี revision guard ปฏิเสธการเขียนทับกัน
- คำขอที่สำเร็จแล้วแต่เครือข่ายขาดใช้ idempotency key เดิม มีเพียง hash กับ request ID ค้างใน sessionStorage ไม่มีรายละเอียดการเงินใน browser storage
- รูปแบบ snapshot เหมาะกับบัญชีส่วนบุคคล ยังไม่ได้ benchmark ประวัติขนาดใหญ่หรือแยก query รายหน้า การนำเข้าผ่านเว็บจำกัด 5 MB และต้องลองกับขนาดสำเนาจริงก่อนย้าย
- LINE/OCR/n8n เดิมยังไม่เชื่อมกับ Worker ใหม่ ไม่เปลี่ยน webhook หรือเปิดงานอัตโนมัติ
- ยังไม่เชื่อม Google OAuth/Cloudflare จริงจนกว่าเจ้าของยืนยันสิทธิ์และตั้ง credentials เสร็จ การผ่าน local test ไม่ใช่การยืนยัน production

ดู [แผนย้ายข้อมูล](MIGRATION.md), [กฎหนี้](DEBT-REVIEW.md) และ [ตั้ง Google login](GOOGLE-LOGIN-SETUP.md)

## โฟลเดอร์งานกับ Git

โฟลเดอร์ทำงานหลักของระบบใหม่คือ `D:\ChatGPT\MCP\Finance\finance-worker` สำเนาที่ส่งเข้า repository เดิมคือ `.publish/FinanceAAA/finance-worker` ใช้ `npm run sync:repository` คัดลอกเฉพาะ allowlist ซอร์ส เอกสาร และทดสอบ ไม่คัดลอก `.dev.vars`, `.wrangler`, exports, รายงาน, PDF, screenshots, credential หรือข้อมูลจริง ไม่แก้ไฟล์เว็บเดิมใน repository

`scripts/port-legacy.mjs` ใช้เฉพาะเมื่อทบทวนการพอร์ตจากซอร์สสาธารณะ ไม่รันตอน build/deploy และไม่ดึงซอร์ส Google Apps Script ตัวจริงมาเผยแพร่

อ้างอิง: [Workers assets](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
