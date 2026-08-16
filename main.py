import webbrowser
import time
import socketserver
import threading
from handler import MyHandler
from config import PORT, TTS_OUTPUT_DIR, PRELOAD_TTS
import os

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """支持多线程并发请求的 TCP 服务器"""
    pass

def preload_tts_async():
    """后台预热 TTS 模型"""
    try:
        from handler import get_tts_engine
        print("后台正在预热 TTS 模型...")
        engine = get_tts_engine()
        if engine:
            print("TTS 模型已加载完毕")
        else:
            print("TTS 模型加载失败，请检查模型文件配置")
    except Exception as e:
        print(f"预热 TTS 模型时出错: {e}")

if __name__ == '__main__':
    # 清理旧的 TTS 文件（360秒前）
    if os.path.exists(TTS_OUTPUT_DIR):
        for f in os.listdir(TTS_OUTPUT_DIR):
            fpath = os.path.join(TTS_OUTPUT_DIR, f)
            if f.startswith('tts_') and os.path.isfile(fpath):
                if time.time() - os.path.getmtime(fpath) > 360:
                    try:
                        os.remove(fpath)
                    except:
                        pass

    # ★ 先启动服务器（立刻开始监听）
    with ThreadedTCPServer(("", PORT), MyHandler) as httpd:
        print(f"服务器已启动（多线程模式），请访问: http://localhost:{PORT}")
        print("按 Ctrl + C 停止")

        #打开浏览器（此时服务器已启动，可以正常连接）
        webbrowser.open(f'http://localhost:{PORT}')

        # ★ 如果开启了预热，启动后台线程加载模型（不阻塞主线程）
        if PRELOAD_TTS:
            thread = threading.Thread(target=preload_tts_async, daemon=True)
            thread.start()


        # 主线程阻塞在这里处理请求
        httpd.serve_forever()