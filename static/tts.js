// ============================================================
// ===== TTS 流式播放（Web Audio API 版） =====
// ============================================================
let ttsState = {
    queue: [],
    currentIndex: 0,
    isPlaying: false,
    isGenerating: false,
    abortController: null,
    audioContext: null,          // 替换 audioElement
    currentSource: null,         // 当前播放的 AudioBufferSourceNode
    currentBuffer: null,         // 当前播放的 AudioBuffer
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

    // 过滤元数据行
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
                                } else if (data.b64) {
                                    try {
                                        const binaryString = atob(data.b64);
                                        const bytes = new Uint8Array(binaryString.length);
                                        for (let i = 0; i < binaryString.length; i++) {
                                            bytes[i] = binaryString.charCodeAt(i);
                                        }
                                        const arrayBuffer = bytes.buffer;
                                        const exists = ttsState.queue.some(item => item.arrayBuffer === arrayBuffer);
                                        if (!exists) {
                                            ttsState.queue.push({
                                                arrayBuffer: arrayBuffer,
                                                index: data.index,
                                                sentence: data.sentence
                                            });
                                            if (!ttsState.isPlaying && !activePlayPromise) {
                                                playNextInQueue();
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('⚠️ Base64 解码失败，降级到 URL 方式:', e);
                                        if (data.url) {
                                            const exists = ttsState.queue.some(item => item.url === data.url);
                                            if (!exists) {
                                                ttsState.queue.push({
                                                    url: data.url,
                                                    index: data.index,
                                                    sentence: data.sentence
                                                });
                                                if (!ttsState.isPlaying && !activePlayPromise) {
                                                    playNextInQueue();
                                                }
                                            }
                                        }
                                    }
                                } else if (data.url) {
                                    const exists = ttsState.queue.some(item => item.url === data.url);
                                    if (!exists) {
                                        ttsState.queue.push({
                                            url: data.url,
                                            index: data.index,
                                            sentence: data.sentence
                                        });
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

// ★★★ 核心：使用 Web Audio API 播放 ★★★
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

    // 清除当前播放的 source
    if (ttsState.currentSource) {
        try { ttsState.currentSource.stop(); } catch (e) {}
        ttsState.currentSource = null;
        ttsState.currentBuffer = null;
    }

    highlightSentence(sentence);

    const getArrayBuffer = () => {
        if (item.arrayBuffer) {
            const buf = item.arrayBuffer;
            item.arrayBuffer = null;
            return Promise.resolve(buf);
        }
        if (ttsState.preloadedAudioUrl === url && ttsState.preloadedAudioBuffer) {
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
            // 创建 AudioContext（懒加载，恢复时重新创建）
            if (!ttsState.audioContext || ttsState.audioContext.state === 'closed') {
                ttsState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = ttsState.audioContext;
            // 如果 context 是 suspended，需要恢复（用户交互后自动恢复，这里确保）
            if (ctx.state === 'suspended') {
                return ctx.resume().then(() => ctx.decodeAudioData(arrayBuffer));
            }
            return ctx.decodeAudioData(arrayBuffer);
        })
        .then(audioBuffer => {
            if (ttsState.currentSource) {
                try { ttsState.currentSource.stop(); } catch (e) {}
                ttsState.currentSource = null;
            }
            ttsState.currentBuffer = audioBuffer;

            const source = ttsState.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            // 应用速度
            const speedSlider = document.getElementById('ttsSpeed');
            const speed = parseFloat(speedSlider ? speedSlider.value : 1.0) || 1.0;
            source.playbackRate.value = speed;

            source.connect(ttsState.audioContext.destination);
            ttsState.currentSource = source;

            // 播放结束处理
            source.onended = function() {
                if (ttsState.currentSource !== source) return; // 防止过期事件
                // 播放完成后，从队列移除当前项
                if (ttsState.queue.length > 0 && ttsState.queue[0].url === url) {
                    ttsState.queue.shift();
                }
                ttsState.isPlaying = false;
                clearHighlight();
                activePlayPromise = null;
                ttsState.currentSource = null;
                ttsState.currentBuffer = null;

                // 检查是否有更多句子
                if (ttsState.queue.length > 0 && !ttsState.isPlaying) {
                    playNextInQueue();
                } else {
                    const btn = document.getElementById('ttsPlayBtn');
                    if (btn) btn.textContent = '🔊';
                }
            };

            // 开始播放
            source.start(0);
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '⏸️';

            // 预加载下一段（可选）
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
            } catch (e) {}
        })
        .catch(err => {
            console.warn('⚠️ 音频加载或解码失败:', err);
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
    if (ttsState.audioContext && ttsState.audioContext.state === 'running') {
        ttsState.audioContext.suspend();
        ttsState.isPlaying = false;
        const btn = document.getElementById('ttsPlayBtn');
        if (btn) {
            btn.textContent = '▶️';
            btn.title = '继续朗读';
        }
        console.log('⏸️ 已暂停');
    }
}

function stopTTS(silent = false) {
    if (ttsState.abortController) {
        ttsState.abortController.abort();
        ttsState.abortController = null;
    }
    if (ttsState.currentSource) {
        try { ttsState.currentSource.stop(); } catch (e) {}
        ttsState.currentSource = null;
        ttsState.currentBuffer = null;
    }
    if (ttsState.audioContext) {
        try { ttsState.audioContext.close(); } catch (e) {}
        ttsState.audioContext = null;
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

// 速度滑块控制（同时支持 Web Audio 播放中的实时速度调整）
document.addEventListener('DOMContentLoaded', function() {
    const speedSlider = document.getElementById('ttsSpeed');
    const speedLabel = document.getElementById('ttsSpeedLabel');
    if (speedSlider && speedLabel) {
        speedLabel.textContent = parseFloat(speedSlider.value).toFixed(1) + 'x';
        speedSlider.addEventListener('input', function() {
            const val = parseFloat(this.value).toFixed(1);
            speedLabel.textContent = val + 'x';
            // 如果当前有播放的 source，实时调整速度
            if (ttsState.currentSource && ttsState.currentSource.playbackRate) {
                ttsState.currentSource.playbackRate.value = parseFloat(val);
            }
        });
    }
});