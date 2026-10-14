# ตั้งค่า LINE สำหรับระบบรายรับ–รายจ่าย

ระบบเดิมเป็น Google Apps Script Web App ที่รันด้วยสิทธิ์ผู้ deploy และเปิดให้ผู้มีลิงก์ทุกคนใช้งานอยู่ การรับ LINE เพิ่มตัวกลาง HTTPS เพราะ Apps Script `doPost` ไม่มี request header สำหรับตรวจ `x-line-signature` โดยตรง

## ค่าที่ต้องเตรียม

1. LINE Official Account ที่เปิด Messaging API: channel secret และ channel access token
2. LINE user ID ของเจ้าของที่อนุญาตให้สั่งงาน (ไม่ใช่ชื่อแสดงผล) ตั้งเป็นรายการคั่นด้วย comma
3. secret สุ่มอย่างน้อย 32 bytes สำหรับช่องทางตัวกลาง → Apps Script ใช้ค่าเดียวกันทั้งสองฝั่ง
4. URL Web App deployment เดิมใน `FINANCE_APP_URL`

Script Properties ในโปรเจกต์ Apps Script:

| ชื่อ | ค่า |
| --- | --- |
| `LINE_BRIDGE_SECRET` | secret ที่สร้างในข้อ 3 |
| `LINE_ALLOWED_USER_IDS` | LINE user ID ที่อนุญาต คั่นด้วย comma |

Environment variables ของตัวกลาง:

| ชื่อ | ค่า |
| --- | --- |
| `LINE_CHANNEL_SECRET` | channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | channel access token |
| `LINE_ALLOWED_USER_IDS` | ชุด user ID เดียวกับ Script Properties |
| `FINANCE_APP_URL` | `https://script.google.com/macros/s/.../exec` ของ deployment เดิม |
| `FINANCE_BRIDGE_SECRET` | ค่าเดียวกับ `LINE_BRIDGE_SECRET` |
| `PORT` | พอร์ต HTTP ภายในโฮสต์ ค่าเริ่มต้น 8080 |

ใช้โฮสต์ HTTPS ที่ส่ง request body และ header ถึง Node ตามเดิม เช่น Cloud Run โดยสร้าง image จาก `line-relay.Dockerfile` และตั้งค่า environment/secrets ผ่านระบบจัดการ secret ของโฮสต์ ตั้ง LINE Webhook URL เป็น `https://<โฮสต์>/webhook` เปิด Use webhook และ Webhook redelivery จากนั้นกด Verify ใน LINE Developers Console; `GET /health` ใช้เช็กว่าโปรเซสทำงาน

อย่าส่ง secret ลง source หรือบันทึกลง Sheet การตั้งค่า LINE มีผลเมื่อ deploy Apps Script ที่มี `doPost`, เปิดตัวกลาง และตั้ง webhook แล้วเท่านั้น ก่อนเปิดใช้งานให้รัน `node Finance.test.js` และ `node line-relay.test.js` ตรวจด้วย LINE ID ที่อนุญาตและไม่ได้อนุญาต โดยใช้รายการทดสอบจำนวนเล็กและตรวจยอดก่อน/หลังยืนยัน

ตัวกลางตรวจลายเซ็น LINE ตาม [เอกสาร LINE](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/) และใช้ `webhookEventId` กันการสร้างร่างซ้ำตาม [แนวทาง webhook redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/) การตอบกลับใช้ [reply API](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
