import http.server
import socketserver
import os
import json
import urllib.parse
import urllib.request
import hashlib
import re
import uuid
import time
import threading
import sherpa_onnx
import soundfile as sf
from config import PORT, CHAPTERS_DIR, ILLUSTRATION_DIR, SHERPA_LEXICON_PATH, SHERPA_TOKENS_PATH, TTS_OUTPUT_DIR, TTS_OUTPUT_URL_PREFIX, SHERPA_MODEL_PATH
from state import save_state, load_state
from metadata import search_md, get_cached_metadata

# ---------- 全局 TTS 引擎 ----------
_tts_engine = None

def get_tts_engine():
    global _tts_engine
    if _tts_engine is None:
        try:
            config = sherpa_onnx.OfflineTtsConfig(
                model=sherpa_onnx.OfflineTtsModelConfig(
                    vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                        model=SHERPA_MODEL_PATH,
                        tokens=SHERPA_TOKENS_PATH,
                        lexicon=SHERPA_LEXICON_PATH
                    ),
                    num_threads=4,
                    debug=False,
                    provider='cpu',
                )
            )
            _tts_engine = sherpa_onnx.OfflineTts(config)
            print("✅ Sherpa-ONNX TTS 引擎加载成功")
        except Exception as e:
            print(f"❌ Sherpa-ONNX TTS 引擎加载失败: {e}")
            _tts_engine = None
    return _tts_engine

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/' or path == '/index.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = self.generate_html()
            self.wfile.write(html.encode())
            return

        if path == '/search':
            q = query.get('q', [''])[0].strip()
            if not q:
                self.send_response(400)
                self.end_headers()
                return
            results = search_md(q)
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(results).encode())
            return

        if path == '/get_state':
            state = load_state()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(state).encode())
            return

        # ★★★ 处理 .wav 文件请求（显式返回二进制数据）★★★
        if path.endswith('.wav'):
            rel_path = urllib.parse.unquote(path.lstrip('/'))
            if os.path.exists(rel_path):
                try:
                    with open(rel_path, 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/wav')
                    self.send_header('Content-Length', str(len(content)))
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    self.wfile.write(content)
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(str(e).encode())
                return
            else:
                self.send_response(404)
                self.end_headers()
                return

        if path.endswith('.md') or path.endswith('.markdown'):
            rel_path = urllib.parse.unquote(path.lstrip('/'))
            if os.path.exists(rel_path):
                try:
                    with open(rel_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    content = self.process_all_images(content)
                    content = self.process_custom_styles(content)
                    self.send_response(200)
                    self.send_header('Content-type', 'text/markdown; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(content.encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(str(e).encode())
                return
            else:
                self.send_response(404)
                self.end_headers()
                return

        # 其他静态文件交给父类
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/save_state':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                state = json.loads(post_data.decode())
                save_state(state)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'ok'}).encode())
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
        elif parsed.path == '/tts':
            self.handle_tts_stream()
        else:
            self.send_response(404)
            self.end_headers()

    def handle_tts_stream(self):
        """同步生成每个句子并立即推送 SSE 事件，生成完一个就推送一个"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode())
            text = data.get('text', '').strip()
            
            if not text:
                raise ValueError('Text cannot be empty')

            # 设置 SSE 响应头（强制关闭连接，避免复用）
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Connection', 'close')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()

            # 过滤元数据行（如 - 作者：xxx，- 标签：xxx 等），然后分割句子
            lines = text.splitlines()
            filtered_lines = []
            for line in lines:
                stripped = line.strip()
                # 过滤以 '- 作者' 或 '- 标签' 开头的行（不区分全角半角冒号）
                if re.match(r'^-\s*作者\s*[:：]', stripped):
                    continue
                if re.match(r'^-\s*标签\s*[:：]', stripped):
                    continue
                if re.match(r'^-\s*Author\s*[:：]', stripped):
                    continue
                if re.match(r'^-\s*Tags\s*[:：]', stripped):
                    continue
                filtered_lines.append(line)
            filtered_text = '\n'.join(filtered_lines)
            # 分割句子
            sentences = re.split(r'(?<=[。！？\n])', filtered_text)
            sentences = [s.strip() for s in sentences if s.strip()]
            total = len(sentences)
            if total == 0:
                self.wfile.write(b'data: {}\n\n')
                return

            os.makedirs(TTS_OUTPUT_DIR, exist_ok=True)
            tts = get_tts_engine()
            if tts is None:
                self.wfile.write(b'data: {"error": "TTS engine not loaded"}\n\n')
                return

            for idx, sentence in enumerate(sentences):
                if not sentence:
                    continue
                filename = f"tts_{int(time.time())}_{uuid.uuid4().hex[:6]}.wav"
                output_path = os.path.join(TTS_OUTPUT_DIR, filename)

                try:
                    audio = tts.generate(sentence, sid=0, speed=1.0)
                    sf.write(output_path, audio.samples, audio.sample_rate)
                    # 强制刷新文件系统缓存（确保文件完全写入）
                    with open(output_path, 'rb') as f:
                        f.read()
                    time.sleep(0.1)  # 等待磁盘同步
                except Exception as e:
                    print(f"TTS generation failed: {sentence[:20]}..., error: {e}")
                    continue

                if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                    continue

                audio_url = TTS_OUTPUT_URL_PREFIX + filename
                event_data = json.dumps({
                    'url': audio_url,
                    'index': idx,
                    'total': total,
                    'sentence': sentence   # 推送完整句子，不再截断
                })
                self.wfile.write(f"data: {event_data}\n\n".encode())
                self.wfile.flush()

                # 定时清理文件（180秒后删除）
                threading.Timer(180, self._cleanup_tts_file, args=[output_path]).start()

            # 发送完成标记
            self.wfile.write(b'data: {"done": true}\n\n')
            self.wfile.flush()

        except Exception as e:
            error_data = json.dumps({'error': str(e)})
            try:
                self.wfile.write(f"data: {error_data}\n\n".encode())
                self.wfile.flush()
            except:
                pass

    def _cleanup_tts_file(self, filepath):
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                print(f"🧹 清理 TTS 文件: {os.path.basename(filepath)}")
        except Exception:
            pass

    def generate_html(self):
        all_meta = get_cached_metadata()
        authors_set = set()
        tags_set = set()
        for item in all_meta:
            if item['author']:
                authors_set.add(item['author'])
            for t in item['tags']:
                if t:
                    tags_set.add(t)
        authors = sorted(list(authors_set))
        all_tags = sorted(list(tags_set))

        full_state = load_state()
        read_progress = full_state.get('read_progress', {})

        illu_abs_path = '/' + CHAPTERS_DIR + '/' + ILLUSTRATION_DIR + '/'

        template_path = os.path.join(os.path.dirname(__file__), 'templates', 'index.html')
        with open(template_path, 'r', encoding='utf-8') as f:
            template = f.read()

        html = template.replace('{{META_JSON}}', json.dumps(all_meta)) \
                    .replace('{{AUTHORS_JSON}}', json.dumps(authors)) \
                    .replace('{{TAGS_JSON}}', json.dumps(all_tags)) \
                    .replace('{{ILLU_ABS_PATH}}', illu_abs_path) \
                    .replace('{{READ_PROGRESS_JSON}}', json.dumps(read_progress))
        return html

    # ---------- 图片处理 ----------
    def process_all_images(self, content):
        def replace_match(match):
            full = match.group(0)
            alt = match.group(1)
            src = match.group(2).strip()

            if src.startswith('/') and src.startswith('/' + CHAPTERS_DIR + '/' + ILLUSTRATION_DIR):
                return full

            if src.startswith(('http://', 'https://')):
                return self.download_external_image(alt, src)

            filename = os.path.basename(src)
            if not filename:
                return full
            if '?' in filename:
                filename = filename.split('?')[0]
            encoded_parts = [urllib.parse.quote(part) for part in [CHAPTERS_DIR, ILLUSTRATION_DIR, filename]]
            new_src = '/' + '/'.join(encoded_parts)
            return f'![{alt}]({new_src})'

        pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
        return re.sub(pattern, replace_match, content)

    def download_external_image(self, alt, url):
        parsed = urllib.parse.urlparse(url)
        filename = os.path.basename(parsed.path)
        if not filename:
            filename = hashlib.md5(url.encode()).hexdigest() + '.jpg'
        else:
            if '?' in filename:
                filename = filename.split('?')[0]
            if '.' not in filename:
                filename += '.jpg'

        local_dir = os.path.join(CHAPTERS_DIR, ILLUSTRATION_DIR)
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, filename)

        if not os.path.exists(local_path):
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'Referer': 'https://art.tepis.me/',
                }
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=10) as response:
                    with open(local_path, 'wb') as f:
                        f.write(response.read())
                print(f"✅ 下载图片: {url} -> {local_path}")
            except Exception as e:
                print(f"❌ 下载图片失败: {url}, 错误: {e}")
                return f'![{alt}]({url})'

        encoded_parts = [urllib.parse.quote(part) for part in [CHAPTERS_DIR, ILLUSTRATION_DIR, filename]]
        local_url = '/' + '/'.join(encoded_parts)
        return f'![{alt}]({local_url})'

    def process_custom_styles(self, content):
        pattern = r'\[([^\]]+)\]\{\.([a-zA-Z0-9_-]+)\}'
        return re.sub(pattern, r'<span class="\2">\1</span>', content)