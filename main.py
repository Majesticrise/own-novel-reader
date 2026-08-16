import webbrowser
import time
import socketserver
from handler import MyHandler
from config import PORT, TTS_OUTPUT_DIR, PRELOAD_TTS   # 新增导入
import os

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """支持多线程并发请求的 TCP 服务器"""
    pass

if __name__ == '__main__':
    if os.path.exists(TTS_OUTPUT_DIR):
        for f in os.listdir(TTS_OUTPUT_DIR):
            fpath = os.path.join(TTS_OUTPUT_DIR, f)
            if f.startswith('tts_') and os.path.isfile(fpath):
                if time.time() - os.path.getmtime(fpath) > 360:
                    try:
                        os.remove(fpath)
                    except:
                        pass

    webbrowser.open(f'http://localhost:{PORT}')
    time.sleep(0.4)

    if PRELOAD_TTS:
        try:
            from handler import get_tts_engine
            print("⏳ 正在预热 TTS 模型...")
            engine = get_tts_engine()
            if engine:
                print("✅ TTS 模型已加载完毕")
            else:
                print("⚠️ TTS 模型加载失败，请检查模型文件配置")
        except Exception as e:
            print(f"⚠️ 预热 TTS 模型时出错: {e}")

    with ThreadedTCPServer(("", PORT), MyHandler) as httpd:
        print(f"✅ 服务器已启动（多线程模式），请访问: http://localhost:{PORT}")
        print("⏹ 按 Ctrl + C 停止")
        httpd.serve_forever()