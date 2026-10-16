# Car Neuron gateway

Chạy trên laptop đặt trong xe. Gateway đọc xe qua cục ELM327, lấy mẫu 1 giây một lần, gom thành lô 5 mẫu (đổi bằng `--batch-size`), rồi gửi lên `POST /api/ingest/batch` của backend. Lô nhỏ giúp dashboard cập nhật gần như trực tiếp.

Gateway **chỉ đọc xe.** Mọi lệnh đều đi qua `allowlist.py`, nên Mode 04 (xóa mã lỗi) và các lệnh ghi bị chặn ngay trong code.

## Cài đặt

```sh
cd gateway
python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
```

## Token thiết bị

```sh
cd backend && .venv/bin/python scripts/create_device.py --vehicle bmw-m2 --label laptop
export CAR_NEURON_DEVICE_ID=dev_...  CAR_NEURON_TOKEN=cnd_...
```

Token chỉ đọc từ biến môi trường, không truyền qua tham số dòng lệnh.

## Chạy

| Mục đích | Lệnh |
|---|---|
| Xe thật, cục OBD USB | `.venv/bin/python -m car_neuron_gateway --source obd --port /dev/ttyUSB0 --fixed-location 16.0878,108.221` |
| Xe thật, Bluetooth thường | ghép đôi, `rfcomm bind` ra `/dev/rfcomm0`, rồi `--port /dev/rfcomm0` |
| Xe thật, cục OBD WiFi | `--port socket://192.168.0.10:35000` (địa chỉ tùy thiết bị, cần kiểm tra) |
| Có GPS USB | thay `--fixed-location` bằng `--gps-port /dev/ttyACM0` |
| ELM327 giả, thời gian thật | `--source fake-elm --scenario overheat` |
| Không gọi backend | `--source sim --scenario misfire --fast --duration 120 --dry-run` |
| ELM327 giả qua cổng serial | `.venv/bin/python -m car_neuron_gateway.fake_elm --scenario overheat` in ra `/dev/pts/N`; sau đó chạy `--source obd --port /dev/pts/N` |

Cục OBD chỉ hỗ trợ BLE thì không tạo ra cổng serial. Trường hợp này cần cầu nối BLE–serial hoặc đổi sang cục USB (cần kiểm tra theo model cụ thể).

Các tùy chọn khác:
- `--scenario`: `normal`, `city`, `overheat`, `misfire`, `lean`.
- `--profile minimal`: xe không có các PID oil, fuel, ambient, MAF.
- `--fast`: chạy bằng thời gian giả, không phải chờ.

Dữ liệu từ `fake-elm` và `sim` được backend gắn nhãn mô phỏng.

## Nhịp đọc

| Nhịp | Nội dung |
|---|---|
| 1 s | rpm, tốc độ, tải, nhiệt độ nước làm mát |
| 5 s | khí nạp, MAP, MAF, bướm ga, fuel trim, điện áp, nhiệt dầu; trạng thái đèn MIL |
| 30 s | mức xăng, nhiệt độ ngoài trời; đọc lại toàn bộ DTC |

Có mã lỗi thì lô được gửi ngay, kèm freeze frame.

## Khi mất mạng

Lô chưa gửi được nằm chờ trong `~/.car-neuron/spool/` và được gửi lại đúng thứ tự khi có mạng.

Lô bị backend từ chối (401/403/422) không gửi lại; chúng được chuyển sang `spool/rejected/` để kiểm tra.

## Test

```sh
.venv/bin/python -m pytest -q
```
