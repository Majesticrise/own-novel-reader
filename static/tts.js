// ============================================================
// ===== TTS 流式播放（边生成边播放） =====
// ============================================================
let ttsState = {
    queue: [],
    currentIndex: 0,
    isPlaying: false,
    isGenerating: false,
    abortController: null,
    audioElement: null,
    sentences: [],
    preloadedAudioBuffer: null,
    preloadedAudioUrl: null,
};
let activePlayPromise = null;
let retryCount = {};

function getCurrentText() {
    const contentDiv = document.getElementById('markdown-content');
    return contentDiv ? contentDiv.textContent || '' : '';
}

function highlightSentence(sentenceText) {
    clearHighlight();
    if (!sentenceText) return;

    const contentDiv = document.getElementById('markdown-content');
    if (!contentDiv) return;

    let fullText = contentDiv.textContent;
    let start = fullText.indexOf(sentenceText);
    if (start === -1) {
        const trimmed = sentenceText.trim();
        if (trimmed !== sentenceText) {
            start = fullText.indexOf(trimmed);
            if (start !== -1) sentenceText = trimmed;
        }
    }
    if (start === -1) {
        const noSpaceText = sentenceText.replace(/\s+/g, ' ');
        const noSpaceFull = fullText.replace(/\s+/g, ' ');
        start = noSpaceFull.indexOf(noSpaceText);
        if (start !== -1) {
            console.warn('⚠️ 使用近似匹配高亮');
            return;
        }
    }
    if (start === -1) {
        console.warn('⚠️ 未找到句子:', sentenceText);
        return;
    }

    const walker = document.createTreeWalker(
        contentDiv,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    let node;
    let charIndex = 0;
    const len = sentenceText.length;
    while (node = walker.nextNode()) {
        const nodeText = node.textContent;
        const nextCharIndex = charIndex + nodeText.length;
        if (start >= charIndex && start < nextCharIndex) {
            const offset = start - charIndex;
            const end = Math.min(offset + len, nodeText.length);
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, end);
            const span = document.createElement('span');
            span.className = 'tts-highlight';
            span.textContent = nodeText.substring(offset, end);
            range.deleteContents();
            range.insertNode(span);
            break;
        }
        charIndex = nextCharIndex;
    }
}

function clearHighlight() {
    const highlights = document.querySelectorAll('.tts-highlight');
    highlights.forEach(span => {
        const parent = span.parentNode;
        parent.replaceChild(document.createTextNode(span.textContent), span);
        parent.normalize();
    });
}

function toggleTTSPlayback() {
    const btn = document.getElementById('ttsPlayBtn');
    if (!btn) return;
    const label = btn.textContent;

    if (ttsState.isGenerating) {
        stopTTS();
        return;
    }
    if (ttsState.queue.length > 0 && !ttsState.isPlaying) {
        playNextInQueue();
        return;
    }
    startTTS();
}

function startTTS() {
    let text = getCurrentText();

    // 过滤元数据行（作者、标签）
    const lines = text.split('\n');
    const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        if (/^作者\s*[:：]/.test(trimmed)) return false;
        if (/^标签\s*[:：]/.test(trimmed)) return false;
        if (/^Author\s*[:：]/.test(trimmed)) return false;
        if (/^Tags\s*[:：]/.test(trimmed)) return false;
        if (/^-\s*作者\s*[:：]/.test(trimmed)) return false;
        if (/^-\s*标签\s*[:：]/.test(trimmed)) return false;
        return true;
    });
    text = filteredLines.join('\n');

    if (!text || text.trim().length === 0) {
        alert('当前章节没有可朗读的文本');
        return;
    }

    stopTTS(true);

    ttsState.queue = [];
    ttsState.currentIndex = 0;
    ttsState.isPlaying = false;
    ttsState.isGenerating = true;

    const btn = document.getElementById('ttsPlayBtn');
    if (btn) {
        btn.textContent = '⏹';
        btn.title = '停止生成';
    }

    ttsState.abortController = new AbortController();

    fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
        signal: ttsState.abortController.signal,
    })
        .then(async (response) => {
            if (!response.ok) throw new Error(`服务器响应错误: ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;

                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';

                for (const part of parts) {
                    if (!part.trim()) continue;
                    const lines = part.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.substring(6);
                            try {
                                const data = JSON.parse(jsonStr);
                                if (data.done) {
                                    ttsState.isGenerating = false;
                                    const btn = document.getElementById('ttsPlayBtn');
                                    if (btn) {
                                        btn.textContent = ttsState.queue.length > 0 ? '⏸️' : '🔊';
                                    }
                                    if (ttsState.queue.length > 0 && !ttsState.isPlaying) {
                                        playNextInQueue();
                                    }
                                } else if (data.error) {
                                    console.error('❌ 服务器错误:', data.error);
                                    alert('生成语音失败: ' + data.error);
                                    ttsState.isGenerating = false;
                                    const btn = document.getElementById('ttsPlayBtn');
                                    if (btn) btn.textContent = '🔊';
                                } else if (data.url) {
                                    const exists = ttsState.queue.some(item => item.url === data.url);
                                    if (!exists) {
                                        ttsState.queue.push({url: data.url, index: data.index, sentence: data.sentence});
                                        if (!ttsState.isPlaying && !activePlayPromise) {
                                            playNextInQueue();
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn('⚠️ 解析 JSON 失败:', jsonStr, e);
                            }
                        }
                    }
                }
            }

            ttsState.isGenerating = false;
            const btn = document.getElementById('ttsPlayBtn');
            if (btn && ttsState.queue.length === 0) {
                btn.textContent = '🔊';
            }
        })
        .catch((err) => {
            if (err.name === 'AbortError') {
                console.log('⏹ 请求已被用户取消');
                return;
            }
            console.error('❌ TTS 请求失败:', err);
            alert('请求失败: ' + err.message);
            ttsState.isGenerating = false;
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '🔊';
        });
}

function playNextInQueue() {
    if (activePlayPromise) {
        console.log('⏳ 已有播放任务进行中，跳过');
        return;
    }

    if (ttsState.queue.length === 0) {
        ttsState.isPlaying = false;
        const btn = document.getElementById('ttsPlayBtn');
        if (btn) btn.textContent = '🔊';
        clearHighlight();
        activePlayPromise = null;
        return;
    }
    if (ttsState.isPlaying) {
        console.log('⏳ 正在播放，忽略重复调用');
        return;
    }

    const item = ttsState.queue[0];
    const url = item.url;
    const index = item.index;
    const sentence = item.sentence;
    ttsState.isPlaying = true;

    if (ttsState.audioElement) {
        ttsState.audioElement.pause();
        ttsState.audioElement.src = '';
        ttsState.audioElement.onended = null;
        ttsState.audioElement.onerror = null;
        ttsState.audioElement = null;
    }

    highlightSentence(sentence);

    const usePreloaded = (ttsState.preloadedAudioUrl === url && ttsState.preloadedAudioBuffer);
    const getArrayBuffer = () => {
        if (usePreloaded) {
            const buf = ttsState.preloadedAudioBuffer;
            ttsState.preloadedAudioBuffer = null;
            ttsState.preloadedAudioUrl = null;
            return Promise.resolve(buf);
        }
        return fetch(url, { cache: 'no-store' }).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.arrayBuffer();
        });
    };

    activePlayPromise = getArrayBuffer()
        .then(arrayBuffer => {
            const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);
            ttsState.audioElement = audio;

            const speedSlider = document.getElementById('ttsSpeed');
            const speed = parseFloat(speedSlider ? speedSlider.value : 1.0) || 1.0;
            audio.playbackRate = speed;

            let endedHandled = false;
            let errorHandled = false;

            audio.onended = function() {
                if (endedHandled) return;
                endedHandled = true;
                if (ttsState.audioElement !== audio) {
                    console.log('⚠️ 过期的 ended 事件，忽略');
                    return;
                }
                URL.revokeObjectURL(blobUrl);
                if (ttsState.queue.length > 0 && ttsState.queue[0].url === url) {
                    ttsState.queue.shift();
                }
                ttsState.isPlaying = false;
                clearHighlight();
                activePlayPromise = null;
                if (ttsState.queue.length > 0 && !ttsState.isPlaying) {
                    playNextInQueue();
                } else {
                    const btn = document.getElementById('ttsPlayBtn');
                    if (btn) btn.textContent = '🔊';
                }
            };

            audio.onerror = function(e) {
                if (errorHandled) return;
                errorHandled = true;
                console.warn('⚠️ 播放错误:', e);
                URL.revokeObjectURL(blobUrl);
                ttsState.isPlaying = false;
                activePlayPromise = null;
                retryPlay(url, index);
            };

            audio.play().then(() => {
                const btn = document.getElementById('ttsPlayBtn');
                if (btn) btn.textContent = '⏸️';

                // 预加载下一段
                try {
                    if (ttsState.queue.length > 1) {
                        const nextItem = ttsState.queue[1];
                        if (nextItem && nextItem.url && ttsState.preloadedAudioUrl !== nextItem.url) {
                            fetch(nextItem.url, { cache: 'no-store' })
                                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                                .then(buf => {
                                    ttsState.preloadedAudioBuffer = buf;
                                    ttsState.preloadedAudioUrl = nextItem.url;
                                })
                                .catch(() => {});
                        }
                    }
                } catch (e) { }

            }).catch(err => {
                if (errorHandled) return;
                errorHandled = true;
                console.warn('⚠️ play() 失败:', err);
                ttsState.isPlaying = false;
                activePlayPromise = null;
                retryPlay(url, index);
            });
        })
        .catch(err => {
            console.warn('⚠️ fetch 音频失败:', err);
            ttsState.isPlaying = false;
            activePlayPromise = null;
            retryPlay(url, index);
        });
}

function retryPlay(url, index, maxRetries = 3) {
    if (ttsState.queue.length === 0) return;
    if (ttsState.isPlaying) return;
    if (activePlayPromise) return;

    if (!retryCount[url]) retryCount[url] = 0;
    retryCount[url]++;
    if (retryCount[url] > maxRetries) {
        console.warn(`❌ 重试 ${maxRetries} 次后仍失败，跳过当前段`);
        if (ttsState.queue.length > 0 && ttsState.queue[0].url === url) {
            ttsState.queue.shift();
        }
        clearHighlight();
        if (ttsState.queue.length > 0 && !ttsState.isPlaying) {
            playNextInQueue();
        } else {
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '🔊';
        }
        return;
    }
    console.log(`🔄 重试播放 (${retryCount[url]}/${maxRetries})`);
    setTimeout(() => {
        if (ttsState.queue.length > 0 && ttsState.queue[0].url === url && !ttsState.isPlaying && !activePlayPromise) {
            playNextInQueue();
        }
    }, 500);
}

function pauseTTS() {
    if (ttsState.audioElement && !ttsState.audioElement.paused) {
        ttsState.audioElement.pause();
        ttsState.isPlaying = false;
        const btn = document.getElementById('ttsPlayBtn');
        if (btn) {
            btn.textContent = '▶️';
            btn.title = '继续朗读';
        }
    }
}

function stopTTS(silent = false) {
    if (ttsState.abortController) {
        ttsState.abortController.abort();
        ttsState.abortController = null;
    }
    if (ttsState.audioElement) {
        ttsState.audioElement.pause();
        ttsState.audioElement.src = '';
        ttsState.audioElement.onended = null;
        ttsState.audioElement.onerror = null;
        ttsState.audioElement = null;
    }
    ttsState.isGenerating = false;
    ttsState.isPlaying = false;
    ttsState.queue = [];
    ttsState.sentences = [];
    ttsState.preloadedAudioBuffer = null;
    ttsState.preloadedAudioUrl = null;
    retryCount = {};
    activePlayPromise = null;
    clearHighlight();
    const btn = document.getElementById('ttsPlayBtn');
    if (btn) {
        btn.textContent = '🔊';
        btn.title = '朗读本章';
    }
}

function toggleTTS() {
    toggleTTSPlayback();
}

// 速度滑块控制
document.addEventListener('DOMContentLoaded', function() {
    const speedSlider = document.getElementById('ttsSpeed');
    const speedLabel = document.getElementById('ttsSpeedLabel');
    if (speedSlider && speedLabel) {
        speedLabel.textContent = parseFloat(speedSlider.value).toFixed(1) + 'x';
        speedSlider.addEventListener('input', function() {
            const val = parseFloat(this.value).toFixed(1);
            speedLabel.textContent = val + 'x';
            if (ttsState.audioElement && !ttsState.audioElement.paused) {
                ttsState.audioElement.playbackRate = parseFloat(val);
            }
        });
    }
});