import os
import json
from config import STATE_FILE

# 最大保留的滚动位置条数
MAX_SCROLL_RECORDS = 25

def save_state(state):
    try:
        existing = {}
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f)

        # 处理滚动位置：合并并保留最新 25 条
        if 'scroll_positions' in state:
            new_scroll = state['scroll_positions']
            if new_scroll:
                # 从 existing 中取出已有的滚动字典，若没有则新建
                scroll_dict = existing.get('scroll_positions', {})
                
                # 对 new_scroll 中的每个键值对进行“插入并置顶”
                for key, value in new_scroll.items():
                    # 如果键已存在，先删除（为了改变插入顺序）
                    if key in scroll_dict:
                        del scroll_dict[key]
                    # 再插入（此时为最新）
                    scroll_dict[key] = value

                # 如果长度超过 MAX_SCROLL_RECORDS，删除最旧的（即最前面的键）
                while len(scroll_dict) > MAX_SCROLL_RECORDS:
                    # 获取第一个键（最旧）
                    oldest = next(iter(scroll_dict))
                    del scroll_dict[oldest]

                # 更新 state 中的 scroll_positions
                state['scroll_positions'] = scroll_dict

        # 其他字段直接覆盖（file, expanded_folders 等）
        existing.update(state)

        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
        print(f"✅ 阅读状态已保存: {state}")
    except Exception as e:
        print(f"❌ 保存状态失败: {e}")
        import traceback
        traceback.print_exc()

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {}

def get_read_progress():
    """从状态文件中读取所有文件的阅读进度（百分比）"""
    state = load_state()
    return state.get('read_progress', {})