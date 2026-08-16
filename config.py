import os

PORT = 8080
CHAPTERS_DIR = 'chapters'
ILLUSTRATION_DIR = '1.4 - 插图'
STATE_FILE = 'reading_state.json'

SHERPA_MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models', 'vits-piper-zh_CN-xiao_ya-medium-int8')
SHERPA_MODEL_PATH = os.path.join(SHERPA_MODEL_DIR, 'zh_CN-xiao_ya-medium.onnx')
SHERPA_TOKENS_PATH = os.path.join(SHERPA_MODEL_DIR, 'tokens.txt')
SHERPA_LEXICON_PATH = os.path.join(SHERPA_MODEL_DIR, 'lexicon.txt')   
TTS_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'static', 'tts')
TTS_OUTPUT_URL_PREFIX = '/static/tts/'

# 是否在服务器启动时预热 TTS 模型（预加载引擎，减少首次请求延迟）
PRELOAD_TTS = True