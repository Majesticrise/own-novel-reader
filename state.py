import os
import json
import shutil
from config import STATE_FILE

# 最大保留的滚动位置条数
MAX_SCROLL_RECORDS = 25


def _try_fix_json(content):
    """
    尝试修复常见的 JSON 损坏问题（如末尾多出的 } 或 Extra data）
    返回修复后的数据（dict），如果无法修复则返回 None
    """
    if not content or not content.strip():
        return None

    # 第一次尝试直接解析
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        # 如果是 "Extra data" 错误（末尾有多余字符），截断到错误位置
        if "Extra data" in str(e):
            try:
                # e.pos 指向额外数据的起始位置
                fixed_content = content[:e.pos]
                # 去掉可能残留的空白
                fixed_content = fixed_content.rstrip()
                # 如果截断后为空或只有空白，返回 None
                if not fixed_content:
                    return None
                return json.loads(fixed_content)
            except Exception:
                pass
        return None


def save_state(state):
    try:
        existing = {}
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, 'r', encoding='utf-8') as f:
                    content = f.read()
                repaired = _try_fix_json(content)
                if repaired is not None:
                    existing = repaired
                else:
                    # 无法修复，备份并重置
                    backup_file = STATE_FILE + '.bak'
                    shutil.copy2(STATE_FILE, backup_file)
                    print(f"状态文件无法修复，已备份为 {backup_file}，将重建新文件")
                    existing = {}
            except Exception as e:
                # 读取时发生其他异常（如权限问题），备份并重置
                backup_file = STATE_FILE + '.bak'
                try:
                    shutil.copy2(STATE_FILE, backup_file)
                    print(f"读取状态文件异常，已备份为 {backup_file}")
                except:
                    pass
                existing = {}

        # 处理滚动位置：合并并保留最新 25 条
        if 'scroll_positions' in state:
            new_scroll = state['scroll_positions']
            if new_scroll:
                scroll_dict = existing.get('scroll_positions', {})
                for key, value in new_scroll.items():
                    if key in scroll_dict:
                        del scroll_dict[key]
                    scroll_dict[key] = value
                while len(scroll_dict) > MAX_SCROLL_RECORDS:
                    oldest = next(iter(scroll_dict))
                    del scroll_dict[oldest]
                state['scroll_positions'] = scroll_dict

        existing.update(state)

        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
        print(f"阅读状态已保存: {state}")
    except Exception as e:
        print(f"保存状态失败: {e}")
        import traceback
        traceback.print_exc()


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
            repaired = _try_fix_json(content)
            if repaired is not None:
                return repaired
            # 无法修复，备份并返回空
            backup_file = STATE_FILE + '.bak'
            shutil.copy2(STATE_FILE, backup_file)
            print(f"状态文件无法修复，已备份为 {backup_file}，将使用空状态")
            return {}
        except Exception as e:
            # 其他异常（如权限问题）返回空
            print(f"加载状态文件异常: {e}")
            return {}
    return {}


def get_read_progress():
    """从状态文件中读取所有文件的阅读进度（百分比）"""
    state = load_state()
    return state.get('read_progress', {})