import os
import re
import json
import time
from config import CHAPTERS_DIR

# 缓存文件（放在项目根目录）
CACHE_FILE = os.path.join(os.path.dirname(__file__), '.meta_cache.json')
# 缓存有效期（秒）
CACHE_TTL = 0

def parse_metadata(content):
    """解析文件开头作者和标签"""
    author = ''
    tags = []
    lines = content.splitlines()
    for line in lines[:5]:
        line = line.strip()
        if re.match(r'^-\s*作者[：:]', line):
            author = re.sub(r'^-\s*作者[：:]\s*', '', line).strip()
        elif re.match(r'^-\s*标签[：:]', line):
            tag_str = re.sub(r'^-\s*标签[：:]\s*', '', line).strip()
            for sep in ['，', ',', '、']:
                if sep in tag_str:
                    tags = [t.strip() for t in tag_str.split(sep) if t.strip()]
                    break
            else:
                if tag_str:
                    tags = [tag_str]
    return author, tags

def search_md(keyword):
    """搜索所有 .md 文件，返回匹配结果"""
    results = []
    if not os.path.exists(CHAPTERS_DIR):
        return results
    for dirpath, _, filenames in os.walk(CHAPTERS_DIR):
        for f in filenames:
            if f.endswith('.md') or f.endswith('.markdown'):
                rel_path = os.path.relpath(os.path.join(dirpath, f), '.')
                rel_path = rel_path.replace(os.sep, '/')
                try:
                    with open(os.path.join(dirpath, f), 'r', encoding='utf-8') as file:
                        content = file.read()
                        if keyword.lower() in content.lower():
                            lines = content.splitlines()
                            matches = []
                            for idx, line in enumerate(lines):
                                if keyword.lower() in line.lower():
                                    start = max(0, idx - 1)
                                    end = min(len(lines), idx + 2)
                                    context = '\n'.join(lines[start:end])
                                    matches.append({
                                        'line_num': idx + 1,
                                        'context': context,
                                        'highlight': line.strip()
                                    })
                            results.append({
                                'file': rel_path,
                                'matches': matches
                            })
                except:
                    continue
    return results

def collect_all_metadata():
    """遍历所有 .md 文件，收集路径、作者、标签"""
    all_meta = []
    if not os.path.exists(CHAPTERS_DIR):
        return all_meta
    for dirpath, _, filenames in os.walk(CHAPTERS_DIR):
        for f in filenames:
            if f.endswith('.md') or f.endswith('.markdown'):
                rel_path = os.path.relpath(os.path.join(dirpath, f), '.')
                rel_path = rel_path.replace(os.sep, '/')
                try:
                    with open(os.path.join(dirpath, f), 'r', encoding='utf-8') as file:
                        content = file.read()
                        author, tags = parse_metadata(content)
                        all_meta.append({
                            'path': rel_path,
                            'author': author,
                            'tags': tags
                        })
                except:
                    pass
    return all_meta

# ========== 新增：带缓存的元数据获取 ==========
def get_cached_metadata(force_refresh=False):
    """
    优先从 .meta_cache.json 读取，缓存过期或强制刷新时重新扫描
    """
    if not force_refresh and os.path.exists(CACHE_FILE):
        try:
            mtime = os.path.getmtime(CACHE_FILE)
            if time.time() - mtime < CACHE_TTL:
                with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception:
            pass  # 缓存损坏则重新扫描

    # 重新扫描
    all_meta = collect_all_metadata()
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(all_meta, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"写入元数据缓存失败: {e}")
    return all_meta