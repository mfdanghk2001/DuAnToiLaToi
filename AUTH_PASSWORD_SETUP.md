# Đăng nhập nội bộ bằng tài khoản + mật khẩu

Bản này bỏ phụ thuộc vào Google Account để đăng nhập Web App.

## Kiến trúc

- Web App: chạy dưới tài khoản deployer.
- Quyền truy cập deployment: ANYONE_ANONYMOUS.
- Người dùng mở Web App không cần đăng nhập Google.
- Ứng dụng tự xác thực:
  - email
  - mật khẩu nội bộ
  - role
  - permission
- Mật khẩu không lưu dạng rõ.
- Session hết hạn sau 8 giờ.

## Thiết lập lần đầu cho ADMIN hiện có

Trước khi deploy bản mới:

1. Apps Script -> Project Settings.
2. Script Properties -> Add script property.
3. Name:
   VPDU_BOOTSTRAP_PASSWORD
4. Value:
   đặt một mật khẩu mạnh do bạn tự chọn.
5. Không gửi mật khẩu này vào GitHub hoặc chat.

Sau khi deploy:
- đăng nhập bằng email ADMIN hiện có trong sheet USERS
- dùng giá trị VPDU_BOOTSTRAP_PASSWORD làm mật khẩu lần đầu

Khi đăng nhập thành công lần đầu:
- hệ thống tự hash mật khẩu vào USERS
- tự xóa Script Property VPDU_BOOTSTRAP_PASSWORD

## Tài khoản khác

ADMIN vào:
Quản trị -> Người dùng

Khi:
- tạo người dùng mới: bắt buộc đặt mật khẩu ban đầu
- sửa người dùng: có thể nhập mật khẩu mới để reset, hoặc để trống để giữ nguyên

## Migration tự động

Không chạy setupSystem().

Lần đăng nhập đầu tiên hệ thống tự:
- thêm các cột auth vào USERS
- tạo sheet AUTH_SESSIONS
- tạo auth pepper trong Script Properties

## Deploy

Sau khi merge:

git pull
clasp push

Sau đó tạo Web App deployment/version mới:
- Execute as: Me / USER_DEPLOYING
- Who has access: Anyone
  (tương ứng ANYONE_ANONYMOUS)

Không chọn "Anyone with Google account".

## Lưu ý bảo mật

Không dùng mật khẩu Google. Đây là mật khẩu riêng của ứng dụng.
