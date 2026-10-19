# รับสลิป LINE ด้วย n8n Cloud — พร้อมตั้งค่า แต่ยังไม่เปิดใช้งาน

เจ้าของเลือก: ส่งสลิปผ่าน LINE → บันทึกทันทีเมื่อข้อมูลครบ → ขาดข้อมูลให้ถามใน LINE ก่อน ไม่ต้องยืนยันซ้ำหลังตอบครบ

ไฟล์นำเข้า: [n8n/finance-line-slips.json](n8n/finance-line-slips.json) เปิดมาเป็น inactive และไม่มี secret ข้างใน ต้องเลือก Credentials และตั้งค่า Apps Script ก่อน ระบบนี้ไม่เปลี่ยนเว็บหรือยอดเงินจากการนำเข้า workflow

## เริ่มต้นสำหรับเจ้าของ

1. สมัครบัญชีทดลอง [n8n Cloud](https://app.n8n.cloud/) ด้วยตัวเอง แล้วแจ้ง URL ของ workspace เช่น `https://ชื่อของคุณ.app.n8n.cloud` เพื่อช่วยตั้งค่าต่อ รหัสผ่านและ API key ให้กรอกในหน้าบริการโดยตรง
2. ในหน้า n8n สร้าง workflow แล้วเลือก Import from File → `finance-line-slips.json`
3. ตั้งค่าเชื่อมต่อด้านล่างก่อนเปลี่ยน LINE webhook หรือตั้ง Publish

## การเชื่อมต่อ

Workflow ใช้ 6 ขั้นตอน: LINE Webhook → เก็บ raw body เดิม → ให้ Apps Script ตรวจลายเซ็นและสิทธิ์ → สร้างคำขออ่านภาพ → OpenAI → กลับไปถามหรือบันทึกใน Apps Script

คำตอบปุ่มและข้อความวิ่งกลับเข้าจุดเดิม แต่ไม่ส่งไปอ่านด้วย AI ซ้ำ การเขียนข้อมูลใช้กฎการเงินของแอปเดิม ไม่ใช้ Google Sheets node เขียนแถวธุรกรรมเอง

### Apps Script

deploy `Code.gs`, `LineSlip.gs`, HTML เดิม และ manifest ด้วย URL deployment เดิม `LineSlip.gs` เป็นส่วนรับสลิปใหม่ ส่วนคำสั่งข้อความ LINE เดิมยังสร้าง DRAFT ตามเดิม

ตั้ง Script Properties:

| ชื่อ | ค่า |
| --- | --- |
| `N8N_AUTOMATION_KEY` | secret สุ่มอย่างน้อย 32 ตัวอักษร สำหรับ n8n เรียก Apps Script |
| `N8N_LINE_ENABLED` | `false` ระหว่างเตรียม แล้วเปลี่ยน `true` เมื่อตั้งค่า LINE ครบและเริ่มทดสอบ |
| `N8N_AUTOSAVE_ENABLED` | `false` ระหว่างทดสอบ และเปิด `true` หลังตรวจเส้นทางทั้งหมด |
| `LINE_CHANNEL_SECRET` | channel secret ของ LINE OA นี้ |
| `LINE_CHANNEL_ACCESS_TOKEN` | channel access token ที่ใช้ดาวน์โหลดรูปและส่งข้อความ |
| `LINE_ALLOWED_USER_IDS` | LINE user ID ที่อนุญาต คั่นด้วย comma ชุดเดียวกับระบบเดิม |

สร้าง key ด้วยเครื่องมือสุ่มของระบบ เช่น `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` แล้วใส่ค่าลง Script Properties และ Credentials เท่านั้น ไม่ใส่ใน source, prompt หรือ Sheet

### Credentials ใน n8n

1. สร้าง **HTTP Custom Auth** ชื่อ `Finance Bridge (body key)` ด้วย JSON:

   ```json
   {"body":{"automation_key":"ใส่ค่าเดียวกับ N8N_AUTOMATION_KEY"}}
   ```

   เลือก credential นี้ให้ทั้ง `Verify LINE and handle answers` และ `Ask missing fields or save once` ใส่ URL Apps Script `/exec` เดิมในทั้งสอง node ค่าเริ่มต้นในไฟล์เป็น placeholder ไม่ใช่ URL ที่ทำงานจริง

2. สร้าง **OpenAI API credential** แล้วเลือกใน `Read slip with OpenAI` ต้องเป็น API account ที่เรียกโมเดลและมีเครดิต/การเรียกใช้พร้อม ไม่ใช่ใช้รหัสผ่าน ChatGPT
3. `Build extraction requests` ตั้งต้น `gpt-6-luna` ซึ่งรองรับภาพและ Structured Outputs ตรวจสิทธิ์โมเดลใน API account ก่อนใช้งาน เปลี่ยนชื่อโมเดลใน node นี้ได้ตามโมเดลที่รองรับ

ไม่มี API key หรือ token อยู่ใน workflow JSON ที่แจก ใช้ n8n Credentials จัดเก็บกุญแจ การบันทึก payload การทำงานถูกตั้งเป็น none ทั้งสำเร็จและผิดพลาด เพราะมีรูปสลิปในข้อมูลระหว่างทาง

### LINE

ใน LINE Developers ใช้ **Production URL** ของ `LINE Webhook` ใน n8n ซึ่งลงท้าย `/webhook/finance-line-slips` ไม่ใช้ test URL เปิด Use webhook และ redelivery ตั้งค่าคำตอบอัตโนมัติของ OA ตามการใช้งานเพื่อไม่ให้ตอบซ้อน และ Publish workflow เมื่อตั้งค่าครบ

เก็บ **Raw Body** ใน Webhook ไว้เสมอ ระบบตรวจ `x-line-signature` กับ bytes เดิมใน Apps Script ก่อนดาวน์โหลดรูปหรือส่ง AI และยอมรับเฉพาะผู้ใช้ใน allowlist ส่วน Apps Script ตรวจ automation key ก่อนรับทุกคำสั่งจาก n8n

การกด Verify ใน LINE ได้ HTTP 200 แค่ยืนยันว่า webhook ของ n8n เข้าถึงได้ ต้องตรวจผลการตั้งค่า/ตอบกลับใน LINE เพิ่มด้วยจึงถือว่าเชื่อมครบ

## เมื่อใช้งาน

ส่ง JPG, PNG หรือ WEBP หนึ่งธุรกรรมต่อภาพ ขนาดไม่เกิน 5 MB บอตตอบรับรหัส `SLIP-...` แล้วอ่านข้อความบนภาพ หากไม่ชัด มีค่าธรรมเนียมแยก ภาพไม่ระบุว่าจ่ายสำเร็จ หรืออ่านวันที่ไม่ได้ จะให้ระบุ/ตรวจข้อมูลก่อน

บอตให้เลือกตามข้อมูลที่ยังขาด: ประเภทรายการ → บัญชี → หมวด → แหล่งเงินบริษัท → โปรเจกต์ตามที่จำเป็น เมื่อครบจะบันทึก ACTIVE และส่งเลข TX กลับทันที จึงไม่ควรลงรายการเดียวกันในเว็บซ้ำ

รองรับรายรับทั่วไป รายจ่ายส่วนตัว/บริษัท โอนระหว่างบัญชี รับเงินบริษัทล่วงหน้า และรับเงินคืนบริษัท การชำระหนี้ให้ใช้หน้าหนี้ของแอป ส่วนเบี้ยเลี้ยงตัวเองที่เปลี่ยนสถานะเงินโดยไม่มีเงินออกไม่มีสลิปการจ่ายจริง ให้ใช้ฟอร์มเฉพาะเดิม

ตัวอย่างการตอบข้อมูลที่อ่านไม่ชัด:

```text
สลิป SLIP-XXXXXXXX | ยอด=123.45
สลิป SLIP-XXXXXXXX | วันที่=2026-10-19
สลิป SLIP-XXXXXXXX | รายละเอียด=เติมน้ำมัน
```

เงินบริษัทไม่พอจะถามจำนวนที่จะออกส่วนตัวเฉพาะส่วนขาด หากยอดเปลี่ยนก่อนบันทึกจะถามใหม่ รายการเงินคืนบริษัทแสดงรายชื่อค้างคืนให้ตอบด้วยเลขและจำนวน เช่น `สลิป SLIP-XXXXXXXX | จับคู่=1:600.00,3:35.00` ไม่คืนรายการที่ไม่ได้เลือกให้เอง และถามก่อนนำส่วนเหลือเข้ากองกลาง

หากพบรายการวัน/บัญชี/ยอดเหมือนเดิม จะให้ตรวจว่าเป็นคนละรายการก่อน รูปเดียวกัน เลขอ้างอิงธนาคาร/วัน/ยอดเดียวกัน หรือการส่งซ้ำของ LINE ไม่สร้างยอดซ้ำ การตรวจนี้เป็นการอ่านและตรวจข้อมูลซ้ำ ไม่ได้เช็กความแท้ของสลิปกับธนาคาร

ดูงานต่อโดยพิมพ์ `สลิป SLIP-XXXXXXXX` ยกเลิกงานที่ยังไม่บันทึกด้วย `สลิป SLIP-XXXXXXXX | ยกเลิก=ใช่` รายการที่บันทึกแล้วให้แก้หรือ VOID ในเว็บตามเดิม

## เปิดใช้งานและทดสอบ

รันในเครื่องก่อน deploy:

```text
node Finance.test.js
node line-relay.test.js
node SlipAutomation.test.js
```

ชุดทดสอบใช้ข้อมูลจำลองและ mock เครือข่าย ไม่ส่งรูปจริงไป OpenAI ไม่เขียนข้อมูลเงินจริง และไม่ใช้เครดิต API ครอบคลุมสิทธิ์ ลายเซ็น ภาพซ้ำ ข้อมูลขาด การบันทึกอัตโนมัติ เงินบริษัทส่วนขาด เงินคืนที่เลือกเอง และการกู้สถานะเมื่อเขียนธุรกรรมแล้วแต่ตอบกลับล้มเหลว

ก่อนเปิดจริงต้องทดสอบการนำเข้าใน n8n Cloud, เลือก Credentials, เชื่อม LINE OA, อ่านภาพด้วย API จริง และรับข้อความกลับให้ครบ ซึ่งยังทำไม่ได้จนกว่าจะมีบัญชี/URL และ Credentials ของเจ้าของ เปิดเฉพาะ `N8N_LINE_ENABLED` ก่อน โดยคง `N8N_AUTOSAVE_ENABLED=false` ระหว่างตรวจทางเดิน หากใช้สลิปจำลองให้ยกเลิก job เหล่านั้นก่อนเปิด auto-save เพื่อไม่ให้ถูกบันทึกภายหลัง

ข้อความที่ตอบทันทีใช้ reply API ส่วนผลอ่านรูปที่เสร็จภายหลังใช้ push API จึงต้องตรวจโควตาข้อความของ LINE OA ด้วย หากส่งข้อความกลับไม่สำเร็จ endpoint รายงาน `notifications_failed` และหากมีเลข TX อยู่แล้วให้ตรวจในเว็บก่อนลงใหม่ ประวัติ job เก็บใน Sheet **รับสลิป LINE** ไม่เก็บรูป base64 ลง Sheet

หากการอ่าน AI ล้มเหลว ให้ส่งรูปใหม่เพื่อเริ่มลองอีกครั้ง งานที่รออ่านมี lease 5 นาทีเพื่อกันทำซ้ำพร้อมกัน หากเกิดการขัดข้องกลางทางให้รอ lease หมดแล้วส่งรูปใหม่ ห้ามสั่ง workflow เรียก API AI ซ้ำโดยแก้ nonce เอง

## แหล่งอ้างอิง

- [n8n Webhook และ Raw Body](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [n8n HTTP Custom Auth](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
- [n8n อ่าน binary buffer](https://docs.n8n.io/code/cookbook/code-node/get-binary-data-buffer/)
- [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [LINE ตรวจลายเซ็น](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE ส่งข้อความ](https://developers.line.biz/en/docs/messaging-api/sending-messages/)
