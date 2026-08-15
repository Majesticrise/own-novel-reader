import webbrowser
import time
import socketserver
from handler import MyHandler
from config import PORT
import os
from config import TTS_OUTPUT_DIR

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """支持多线程并发请求的 TCP 服务器"""
    pass

if __name__ == '__main__':
    # 清理旧的 TTS 文件（10分钟前）
    if os.path.exists(TTS_OUTPUT_DIR):
        for f in os.listdir(TTS_OUTPUT_DIR):
            fpath = os.path.join(TTS_OUTPUT_DIR, f)
            if f.startswith('tts_') and os.path.isfile(fpath):
                if time.time() - os.path.getmtime(fpath) > 600:
                    try:
                        os.remove(fpath)
                    except:
                        pass

    webbrowser.open(f'http://localhost:{PORT}')
    time.sleep(0.5)

    with ThreadedTCPServer(("", PORT), MyHandler) as httpd:
        print(f"✅ 服务器已启动（多线程模式），请访问: http://localhost:{PORT}")
        print("⏹ 按 Ctrl + C 停止")
        httpd.serve_forever()