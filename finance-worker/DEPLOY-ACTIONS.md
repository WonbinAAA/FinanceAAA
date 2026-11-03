# Deploy ผ่าน GitHub Actions แบบแชทค่าใช้จ่ายบริษัท

เตรียมวิธี deploy แบบเดียวกับโปรเจกต์ค่าใช้จ่ายบริษัท โดยใช้ GitHub Actions → Wrangler → Cloudflare Workers + D1 แยกเป็น Worker และฐาน Finance ของตัวเอง ไม่แก้โปรเจกต์บริษัทเดิม

## การตั้งค่าที่ต้องได้รับอนุญาตก่อน

เจ้าของอนุญาตแล้วให้เก็บ token ใน GitHub Actions Secrets ซึ่งซ่อนค่าและไม่เป็นส่วนหนึ่งของซอร์ส และเก็บ runtime secrets ที่จำเป็นใน Cloudflare Secrets ปัจจุบันเว็บใช้โหมดสาธารณะโดยไม่ล็อกอิน จึงไม่ต้องตั้ง Google client หรือรหัสผ่าน และไม่ใส่ token deploy ใน runtime ของเว็บ

| ชนิด | ชื่อ | ใช้ทำอะไร |
| --- | --- | --- |
| Actions Secret | `CLOUDFLARE_API_TOKEN` | สิทธิ์ deploy Worker และ apply schema D1 ของบัญชีเป้าหมาย |
| Actions Secret | `CLOUDFLARE_ACCOUNT_ID` | ระบุบัญชี Cloudflare ของเจ้าของ |
| Actions Variable | `FINANCE_D1_DATABASE_ID` | UUID ฐาน Finance preview ที่สร้างไว้แล้ว |
| Actions Variable | `FINANCE_APP_ORIGIN` | HTTPS workers.dev origin ของ Worker Finance preview |

ไม่ใส่ค่าจริงใน workflow, source หรือ logs ตัวแปร `AUTH_MODE=public` เป็นค่ากำหนดพฤติกรรมที่เจ้าของยืนยัน ไม่ใช่ secret

## Workflow ที่เตรียมไว้

ไฟล์ `.github/workflows/finance-worker-deploy.yml` ใช้ `workflow_dispatch` และยอม deploy เฉพาะ branch `cloudflare-d1` ทุก push ปกติยังรันเพียง CI ตรวจโค้ด

GitHub กำหนดให้ไฟล์ workflow ที่เรียกด้วย `workflow_dispatch` อยู่ใน default branch ก่อน จึงต้องเพิ่มเฉพาะไฟล์ workflow นี้ใน `main` เมื่อตั้งค่าเรียบร้อย เนื้อหาเว็บเดิมไม่ต้องเปลี่ยน จากนั้นเลือก branch `cloudflare-d1` ตอนกด Run workflow การรันโดยเลือก `main` จะไม่ deploy เพราะ job มีเงื่อนไขป้องกันไว้ ดู [GitHub: Manually running a workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)

ลำดับทำงานคือ install dependencies → tests → build dry-run → ตรวจบัญชี/Worker/D1 ผ่าน API แบบอ่านอย่างเดียว → apply migrations เฉพาะฐาน Finance → deploy Worker

สคริปต์ตรวจ `APP_ID`, ชื่อ Worker และ ID/ชื่อ D1 ก่อนเขียนข้อมูล หากพบชื่อซ้ำกับแอปอื่น หรืออ่านสิทธิ์ไม่ได้ จะหยุด ไม่ถือว่า HTTP 403 เป็นทรัพยากรที่ยังไม่มี ไม่สร้างหรือแก้ธุรกรรมการเงินและไม่อัปโหลดไฟล์นำเข้าจริง

## สถานะก่อนเปิดใช้

- เจ้าของเลือกเปิดเว็บข้อมูลจริงสาธารณะโดยไม่ล็อกอิน และอนุญาตการเก็บ secrets ทั้งสองระบบแล้ว
- ตั้งสิทธิ์และข้อมูลบัญชีให้ตรง พร้อมเปิดใช้ workflow ใน default branch
- ต้องทดสอบเว็บจริงและระบบเข้าสู่ระบบหลัง deploy ก่อนนำข้อมูลเงินจริงมาใช้
