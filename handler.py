import http.server
import socketserver
import os
import json
import urllib.parse
import urllib.request
import hashlib
import re
from config import PORT, CHAPTERS_DIR, ILLUSTRATION_DIR
from state import save_state, load_state
# 替换：不再导入 collect_all_metadata，改为 get_cached_metadata
from metadata import search_md, get_cached_metadata

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 主页
        if path == '/' or path == '/index.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = self.generate_html()
            self.wfile.write(html.encode())
            return

        # 搜索 API
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

        # 读取状态
        if path == '/get_state':
            state = load_state()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(state).encode())
            return

        # 处理 .md 文件请求（解码路径）
        if path.endswith('.md') or path.endswith('.markdown'):
            rel_path = urllib.parse.unquote(path.lstrip('/'))
            if os.path.exists(rel_path):
                try:
                    with open(rel_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    # ★ 统一处理所有图片（外部下载 + 相对路径转绝对）
                    content = self.process_all_images(content)
                    # ★ 新增：处理自定义样式 [文字]{.class}
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

        # 其他静态文件（图片、html等）交给父类
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
        else:
            self.send_response(404)
            self.end_headers()

    def generate_html(self):
        # 使用缓存的元数据（首次调用会扫描生成，之后读缓存）
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

        # ★ 读取阅读进度（从 state.json 中获取 read_progress 字段）
        full_state = load_state()                     # 需确保已导入 load_state
        read_progress = full_state.get('read_progress', {})

        illu_abs_path = '/' + CHAPTERS_DIR + '/' + ILLUSTRATION_DIR + '/'

        # 读取模板文件
        template_path = os.path.join(os.path.dirname(__file__), 'templates', 'index.html')
        with open(template_path, 'r', encoding='utf-8') as f:
            template = f.read()

        # 替换占位符（新增 READ_PROGRESS_JSON）
        html = template.replace('{{META_JSON}}', json.dumps(all_meta)) \
                    .replace('{{AUTHORS_JSON}}', json.dumps(authors)) \
                    .replace('{{TAGS_JSON}}', json.dumps(all_tags)) \
                    .replace('{{ILLU_ABS_PATH}}', illu_abs_path) \
                    .replace('{{READ_PROGRESS_JSON}}', json.dumps(read_progress))
        return html

    # ---------- 统一图片处理 ----------
    def process_all_images(self, content):
        """处理所有图片链接：外部下载，本地相对路径转绝对路径"""
        def replace_match(match):
            full = match.group(0)
            alt = match.group(1)
            src = match.group(2).strip()

            # 1. 已经是绝对路径且指向插图目录，保持不变
            if src.startswith('/') and src.startswith('/' + CHAPTERS_DIR + '/' + ILLUSTRATION_DIR):
                return full

            # 2. 外部链接（http/https）→ 下载到本地
            if src.startswith(('http://', 'https://')):
                return self.download_external_image(alt, src)

            # 3. 本地相对路径 → 转换为绝对路径（提取文件名）
            filename = os.path.basename(src)
            if not filename:
                return full  # 无法提取文件名，保留原样
            # 处理可能的查询参数
            if '?' in filename:
                filename = filename.split('?')[0]
            # 构造绝对路径（保证编码正确）
            encoded_parts = [urllib.parse.quote(part) for part in [CHAPTERS_DIR, ILLUSTRATION_DIR, filename]]
            new_src = '/' + '/'.join(encoded_parts)
            return f'![{alt}]({new_src})'

        pattern = r'!\[([^\]]*)\]\(([^)]+)\)'
        return re.sub(pattern, replace_match, content)

    def download_external_image(self, alt, url):
        """下载外部图片，返回替换后的 Markdown 标签"""
        # 提取文件名
        parsed = urllib.parse.urlparse(url)
        filename = os.path.basename(parsed.path)
        if not filename:
            filename = hashlib.md5(url.encode()).hexdigest() + '.jpg'
        else:
            if '?' in filename:
                filename = filename.split('?')[0]
            if '.' not in filename:
                filename += '.jpg'

        # 本地保存路径
        local_dir = os.path.join(CHAPTERS_DIR, ILLUSTRATION_DIR)
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, filename)

        # 如果不存在则下载
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
                return f'![{alt}]({url})'  # 下载失败则保留原链接

        # 返回新的 Markdown 标签（绝对路径）
        encoded_parts = [urllib.parse.quote(part) for part in [CHAPTERS_DIR, ILLUSTRATION_DIR, filename]]
        local_url = '/' + '/'.join(encoded_parts)
        return f'![{alt}]({local_url})'

    # ---------- 新增：处理自定义样式 ----------
    def process_custom_styles(self, content):
        """
        将 [文字]{.类名} 转换为 <span class="类名">文字</span>
        例如: [“小芳姐姐！”]{.text-red} → <span class="text-red">“小芳姐姐！”</span>
        """
        # 匹配 [任意非]字符]{.任意字母数字下划线横线}
        pattern = r'\[([^\]]+)\]\{\.([a-zA-Z0-9_-]+)\}'
        return re.sub(pattern, r'<span class="\2">\1</span>', content)