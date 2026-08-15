import webbrowser
import time
import socketserver
from handler import MyHandler
from config import PORT

if __name__ == '__main__':
    webbrowser.open(f'http://localhost:{PORT}')
    time.sleep(0.5)
    with socketserver.TCPServer(("", PORT), MyHandler) as httpd:
        print(f"✅ 服务器已启动，请访问: http://localhost:{PORT}")
        print("⏹ 按 Ctrl + C 停止")
        httpd.serve_forever()