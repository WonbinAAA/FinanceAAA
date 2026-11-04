# Finance Worker — ระบบใหม่ระหว่างพัฒนา

การเชื่อมสมุดบริษัท admin แบบบันทึกครั้งเดียวดูรายละเอียดใน [COMPANY-LINK.md](COMPANY-LINK.md) ตัวเชื่อมเริ่มต้นเป็นปิด และเปิดได้หลังตรวจจับคู่ประวัติครบเท่านั้น

ระบบ Workers + D1 ใน repository FinanceAAA เดิม พอร์ตหน้าจอและกฎที่ไม่เกี่ยวกับสูตรหนี้จาก Apps Script v53 (`f5873ef`) เว็บ GitHub Pages และ Apps Script เดิมยังทำงานแยกกัน ไม่มีการย้ายเว็บหลักหรืออ่าน/แก้ข้อมูลเงินจริงระหว่างพัฒนา

การตัดสินใจล่าสุดของเจ้าของ (4 พฤศจิกายน 2569): เปิดเว็บใช้งานจริงสาธารณะ ไม่ต้องล็อกอิน และยอมรับว่าผู้อื่นดู เพิ่ม แก้ไข ยกเลิก และส่งออกข้อมูลได้ ใช้ workers.dev, เริ่มฐานใหม่แล้วนำเข้าประวัติภายหลัง, หนี้คงเหลือรวมเงินต้น + ดอกเบี้ยค้าง + ค่าธรรมเนียมค้าง โดยกรอกจากใบแจ้งยอด ไม่มีการสมมติอัตราหรือคิดดอกเบี้ยรายวัน

โหมดปัจจุบัน `AUTH_MODE=public` เปิดหน้าเว็บได้ทันที สร้าง session อัตโนมัติเพื่อกัน CSRF/คำขอซ้ำ ไม่มีการยืนยันตัวตนและไม่ต้องสร้าง Google OAuth client ป้ายบนเว็บแสดงว่าทุกคนดูและแก้รายการได้ โค้ด Google login เก็บไว้เป็นตัวเลือกหากเจ้าของสั่งเปลี่ยนโหมดภายหลัง

## รันในเครื่อง

ใช้ Node 22.13 ขึ้นไป (แนะนำ Node 24 LTS) และ npm:

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# แก้ .dev.vars: APP_ORIGIN=http://127.0.0.1:8787
npm run db:local
npm run dev
```

เปิด http://127.0.0.1:8787 ได้ทันที ใช้ข้อมูลจำลองสำหรับทดสอบในเครื่อง ข้อมูลจำลองอยู่ใน `.wrangler/` และไม่ถูกคัดลอกไป GitHub หรือฐาน Cloudflare

```powershell
npm test
npm run build
```

ชุดทดสอบครอบคลุมบัญชีและเงินสด, รายรับ/รายจ่าย, โอน, VOID/DRAFT, กองกลาง/โปรเจกต์, ส่วนขาดที่ต้องยืนยัน, จับคู่เงินคืนเฉพาะที่เลือก, รายการประจำ, หนี้แยกส่วนประกอบ, การเขียน D1 ทั้งชุด, คำขอซ้ำ/การแก้พร้อมกัน, OAuth/CSRF, นำเข้าและเทียบยอด นอกจากนี้มี `scripts/smoke-local.mjs` สำหรับ Playwright ที่ติดตั้งไว้แล้ว ใช้ Edge แบบ headless กับข้อมูลจำลองบน loopback เท่านั้น

## เชื่อม Cloudflare และ GitHub

วิธีที่ใช้ปัจจุบันคือ [GitHub Actions แบบ manual](DEPLOY-ACTIONS.md) เช่นเดียวกับแชทค่าใช้จ่ายบริษัท เจ้าของอนุญาตเก็บ token ใน Actions Secrets และค่าลับของเว็บใน Cloudflare Secrets แล้ว กด Run workflow โดยเลือก branch `cloudflare-d1` เพื่อ deploy ไปยัง Worker/D1 ของ Finance เท่านั้น

วิธี Workers Builds ด้านล่างเป็นอีกทางเลือกหนึ่ง ปัจจุบันไม่ได้ใช้ Google OAuth หรือบังคับล็อกอิน:

1. ใน Cloudflare Workers & Pages เลือก Create application → Connect GitHub และให้ GitHub App เข้าถึงเฉพาะ `WonbinAAA/FinanceAAA` เจ้าของดำเนินการยืนยันตัวตน/อนุญาตสิทธิ์ในหน้า GitHub เอง
2. ตั้ง Worker name = `finance-aaa-preview`, branch = `cloudflare-d1`, root directory = `finance-worker`, build command = `npm test && npm run build`, deploy command = `npm run deploy` และ watch path = `finance-worker/**` คง GitHub Pages บน branch เดิม
3. ใช้ D1 ใหม่ชื่อ `finance-aaa-preview` สำหรับระบบทดสอบโดยเฉพาะ กำหนด build variables `FINANCE_D1_DATABASE_ID` เป็น ID ฐานนี้ และ `FINANCE_APP_ORIGIN` เป็น `https://finance-aaa-preview.<subdomain>.workers.dev` จริง ไม่มี slash ท้าย ค่าทั้งสองไม่ใช่ password/token
4. Schema ต้องถูก apply เฉพาะฐานใหม่ก่อนเข้าใช้งาน ในเครื่องทำได้ด้วย `node scripts/check-release.mjs --deploy` แล้ว `npx wrangler d1 migrations apply DB --remote --config wrangler.deploy.json` ตรวจชื่อฐานก่อนยืนยัน ค่าตั้งต้นใน `wrangler.jsonc` เป็น placeholder สำหรับ local เท่านั้น
5. Cloudflare Builds เรียก `npm run deploy` ซึ่งสร้าง `wrangler.deploy.json` ระหว่าง build และเปิดโหมด preview ที่ไม่รองรับ local login
6. เปิดเว็บและตรวจ public session กับหน้าจอโดยไม่สร้างธุรกรรมเงินจริง หากภายหลังเปลี่ยนเป็น Google login จึงค่อยใช้ [คู่มือตั้ง Google login](GOOGLE-LOGIN-SETUP.md)

การ deploy ผ่าน GitHub ไม่ต้องเข้าสู่ Wrangler ในเครื่องทุกครั้ง หากต้องใช้ CLI เพื่อดูแลฐานหรือ deploy โดยตรงภายหลัง ให้เชื่อมบัญชี Cloudflare ของเจ้าของในครั้งที่จำเป็นด้วย `npx wrangler login` และใช้ config สำหรับฐาน preview ที่เตรียมไว้

ตัวแปรสำหรับ build/deploy กับ runtime secrets เป็นคนละส่วน โหมดสาธารณะไม่ต้องมี Google secret หรือรหัสผ่าน ตัว token deploy เก็บใน GitHub Actions Secrets และไม่ถูกส่งเข้า frontend หรือ runtime ของเว็บ

ก่อนเปลี่ยนเว็บหลัก ต้องทดสอบเปิดโดยไม่ล็อกอิน, reload/หมดอายุ public session, ขนาดมือถือ, ฟีเจอร์ครบ, backup/restore, ผลเทียบยอด ณ เวลาเดียวกัน และตรวจหนี้กับใบแจ้งยอดของเจ้าของ จากนั้นตกลงช่วงหยุดบันทึกและแผนย้อนกลับกับเจ้าของ

## โครงสร้างและข้อจำกัด

- `src/legacy-engine.js` เป็นพอร์ตแบบ static ไม่มี eval ไม่มี Google runtime; `src/debt-components.js` แทนส่วนเขียนหนี้เก่าด้วยการแยกยอดตามที่เจ้าของเลือก
- D1 เก็บ record พร้อมรหัส, field เดิม, ลำดับแถว และเงินเป็น integer สตางค์ใน `money_json`; ตารางเก็บข้อมูลความเข้ากันได้เพื่อไม่ให้ field เก่าสูญหาย
- ทุก mutation อ่าน snapshot ที่สอดคล้องกัน แล้ว commit ข้อมูลพร้อม audit และ idempotency receipt ใน D1 batch เดียว มี revision guard ปฏิเสธการเขียนทับกัน
- คำขอที่สำเร็จแล้วแต่เครือข่ายขาดใช้ idempotency key เดิม มีเพียง hash กับ request ID ค้างใน sessionStorage ไม่มีรายละเอียดการเงินใน browser storage
- รูปแบบ snapshot เหมาะกับบัญชีส่วนบุคคล ยังไม่ได้ benchmark ประวัติขนาดใหญ่หรือแยก query รายหน้า การนำเข้าผ่านเว็บจำกัด 5 MB และต้องลองกับขนาดสำเนาจริงก่อนย้าย
- LINE/OCR/n8n เดิมยังไม่เชื่อมกับ Worker ใหม่ ไม่เปลี่ยน webhook หรือเปิดงานอัตโนมัติ
- โหมด public ได้รับอนุญาตจากเจ้าของอย่างชัดเจน ผู้ใช้อินเทอร์เน็ตทุกคนสามารถเข้าถึงข้อมูลผ่านเว็บได้ ส่วนการนำเข้าประวัติจริงยังต้องทดสอบและตกลงแผนยอดเริ่มต้นก่อน

ดู [แผนย้ายข้อมูล](MIGRATION.md), [กฎหนี้](DEBT-REVIEW.md) และ [ตั้ง Google login](GOOGLE-LOGIN-SETUP.md)

## โฟลเดอร์งานกับ Git

โฟลเดอร์ทำงานหลักของระบบใหม่คือ `D:\ChatGPT\MCP\Finance\finance-worker` สำเนาที่ส่งเข้า repository เดิมคือ `.publish/FinanceAAA/finance-worker` ใช้ `npm run sync:repository` คัดลอกเฉพาะ allowlist ซอร์ส เอกสาร และทดสอบ ไม่คัดลอก `.dev.vars`, `.wrangler`, exports, รายงาน, PDF, screenshots, credential หรือข้อมูลจริง ไม่แก้ไฟล์เว็บเดิมใน repository

`scripts/port-legacy.mjs` ใช้เฉพาะเมื่อทบทวนการพอร์ตจากซอร์สสาธารณะ ไม่รันตอน build/deploy และไม่ดึงซอร์ส Google Apps Script ตัวจริงมาเผยแพร่

อ้างอิง: [Workers assets](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
