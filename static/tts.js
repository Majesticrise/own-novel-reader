// ============================================================
// ===== TTS 流式播放（纯 B64 + 预创建 Audio 缓存 + 暂停/继续） =====
// ============================================================
let ttsState = {
    queue: [],
    currentIndex: 0,
    isPlaying: false,
    isPaused: false,          // ★ 新增暂停标记
    isGenerating: false,
    abortController: null,
    audioElement: null,
    sentences: [],
    // ★ 预创建缓存
    preloadedAudio: null,
    preloadedBlobUrl: null,
    preloadedItem: null,
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

    // 如果正在生成中，点击停止
    if (ttsState.isGenerating) {
        stopTTS();
        return;
    }

    // 如果处于暂停状态（有音频且已暂停），则继续播放
    if (ttsState.isPaused) {
        resumeTTS();
        return;
    }

    // 如果当前正在播放，则暂停
    if (ttsState.isPlaying) {
        pauseTTS();
        return;
    }

    // 如果队列中有数据且未播放，开始播放
    if (ttsState.queue.length > 0 && !ttsState.isPlaying) {
        playNextInQueue();
        return;
    }

    // 否则启动 TTS 生成
    startTTS();
}

function startTTS() {
    let text = getCurrentText();

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
    ttsState.isPaused = false;   // 重置暂停状态
    ttsState.isGenerating = true;
    // 清空预加载
    if (ttsState.preloadedAudio) {
        ttsState.preloadedAudio.pause();
        ttsState.preloadedAudio.src = '';
        ttsState.preloadedAudio.onended = null;
        ttsState.preloadedAudio = null;
    }
    if (ttsState.preloadedBlobUrl) {
        URL.revokeObjectURL(ttsState.preloadedBlobUrl);
        ttsState.preloadedBlobUrl = null;
    }
    ttsState.preloadedItem = null;

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
                                    if (ttsState.queue.length > 0 && !ttsState.isPlaying && !ttsState.isPaused) {
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
                                            if (!ttsState.isPlaying && !ttsState.isPaused && !activePlayPromise) {
                                                playNextInQueue();
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('⚠️ Base64 解码失败:', e);
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

// ---------- 预创建下一句 Audio ----------
function preloadNextAudio() {
    if (ttsState.queue.length < 2) {
        // 清除旧的预加载
        if (ttsState.preloadedAudio) {
            ttsState.preloadedAudio.pause();
            ttsState.preloadedAudio.src = '';
            ttsState.preloadedAudio.onended = null;
            ttsState.preloadedAudio = null;
        }
        if (ttsState.preloadedBlobUrl) {
            URL.revokeObjectURL(ttsState.preloadedBlobUrl);
            ttsState.preloadedBlobUrl = null;
        }
        ttsState.preloadedItem = null;
        return;
    }

    const nextItem = ttsState.queue[1];
    if (!nextItem) return;
    if (ttsState.preloadedItem === nextItem) return;

    // 清除旧缓存
    if (ttsState.preloadedAudio) {
        ttsState.preloadedAudio.pause();
        ttsState.preloadedAudio.src = '';
        ttsState.preloadedAudio.onended = null;
        ttsState.preloadedAudio = null;
    }
    if (ttsState.preloadedBlobUrl) {
        URL.revokeObjectURL(ttsState.preloadedBlobUrl);
        ttsState.preloadedBlobUrl = null;
    }

    try {
        const blob = new Blob([nextItem.arrayBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.preservesPitch = true;

        const speedSlider = document.getElementById('ttsSpeed');
        const speed = parseFloat(speedSlider ? speedSlider.value : 1.0) || 1.0;
        audio.playbackRate = speed;

        ttsState.preloadedAudio = audio;
        ttsState.preloadedBlobUrl = url;
        ttsState.preloadedItem = nextItem;
        console.log('✅ 预创建下一句:', nextItem.sentence.substring(0, 20) + '...');
    } catch (e) {
        console.warn('⚠️ 预创建 Audio 失败:', e);
    }
}

// ---------- 播放队列 ----------
function playNextInQueue() {
    // 如果处于暂停状态，不应该进入播放，直接返回（由 resume 处理）
    if (ttsState.isPaused) {
        console.log('⏸️ 暂停中，忽略播放请求');
        return;
    }

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
    const sentence = item.sentence;
    ttsState.isPlaying = true;
    ttsState.isPaused = false;   // 确保暂停标记为 false

    if (ttsState.audioElement) {
        ttsState.audioElement.pause();
        ttsState.audioElement.src = '';
        ttsState.audioElement.onended = null;
        ttsState.audioElement.onerror = null;
        ttsState.audioElement = null;
    }

    highlightSentence(sentence);

    let audioToPlay = null;
    let blobUrlToUse = null;

    if (ttsState.preloadedAudio && ttsState.preloadedItem === item) {
        audioToPlay = ttsState.preloadedAudio;
        blobUrlToUse = ttsState.preloadedBlobUrl;
        ttsState.preloadedAudio = null;
        ttsState.preloadedBlobUrl = null;
        ttsState.preloadedItem = null;
        console.log('⚡ 使用预创建 Audio');
    } else {
        console.log('⏳ 未命中预创建，立即创建');
        const blob = new Blob([item.arrayBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        blobUrlToUse = url;
        audioToPlay = new Audio(url);
        audioToPlay.preservesPitch = true;
    }

    const speedSlider = document.getElementById('ttsSpeed');
    const speed = parseFloat(speedSlider ? speedSlider.value : 1.0) || 1.0;
    audioToPlay.playbackRate = speed;

    ttsState.audioElement = audioToPlay;

    let endedHandled = false;
    let errorHandled = false;

    audioToPlay.onended = function() {
        if (endedHandled) return;
        endedHandled = true;
        if (ttsState.audioElement !== audioToPlay) {
            console.log('⚠️ 过期的 ended 事件，忽略');
            return;
        }
        if (blobUrlToUse) {
            URL.revokeObjectURL(blobUrlToUse);
        }
        if (ttsState.queue.length > 0) {
            ttsState.queue.shift();
        }
        ttsState.isPlaying = false;
        ttsState.isPaused = false;   // 自然结束时清除暂停状态
        clearHighlight();
        activePlayPromise = null;
        ttsState.audioElement = null;

        preloadNextAudio();

        if (ttsState.queue.length > 0 && !ttsState.isPlaying && !ttsState.isPaused) {
            playNextInQueue();
        } else {
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '🔊';
        }
    };

    audioToPlay.onerror = function(e) {
        if (errorHandled) return;
        errorHandled = true;
        console.warn('⚠️ 播放错误:', e);
        if (blobUrlToUse) {
            URL.revokeObjectURL(blobUrlToUse);
        }
        ttsState.isPlaying = false;
        ttsState.isPaused = false;
        activePlayPromise = null;
        if (ttsState.queue.length > 0) {
            ttsState.queue.shift();
        }
        preloadNextAudio();
        if (ttsState.queue.length > 0 && !ttsState.isPlaying && !ttsState.isPaused) {
            playNextInQueue();
        } else {
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '🔊';
        }
    };

    activePlayPromise = audioToPlay.play()
        .then(() => {
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '⏸️';
            preloadNextAudio();
        })
        .catch(err => {
            if (errorHandled) return;
            errorHandled = true;
            console.warn('⚠️ play() 失败:', err);
            ttsState.isPlaying = false;
            ttsState.isPaused = false;
            activePlayPromise = null;
            if (audioToPlay.onerror) audioToPlay.onerror(err);
        });
}

// ---------- 暂停 ----------
function pauseTTS() {
    if (ttsState.audioElement && !ttsState.audioElement.paused) {
        ttsState.audioElement.pause();
        ttsState.isPlaying = false;
        ttsState.isPaused = true;
        const btn = document.getElementById('ttsPlayBtn');
        if (btn) {
            btn.textContent = '▶️';
            btn.title = '继续朗读';
        }
        console.log('⏸️ 已暂停');
    }
}

// ---------- 继续 ----------
function resumeTTS() {
    if (!ttsState.audioElement) {
        // 没有音频对象，尝试播放下一段
        ttsState.isPaused = false;
        if (ttsState.queue.length > 0) {
            playNextInQueue();
        } else {
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '🔊';
        }
        return;
    }

    // 如果音频已结束，则播下一段
    if (ttsState.audioElement.ended) {
        ttsState.isPaused = false;
        // 释放当前音频资源
        if (ttsState.audioElement) {
            ttsState.audioElement.pause();
            ttsState.audioElement.src = '';
            ttsState.audioElement.onended = null;
            ttsState.audioElement.onerror = null;
            ttsState.audioElement = null;
        }
        if (ttsState.queue.length > 0) {
            playNextInQueue();
        } else {
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) btn.textContent = '🔊';
        }
        return;
    }

    // 否则继续播放
    ttsState.audioElement.play()
        .then(() => {
            ttsState.isPlaying = true;
            ttsState.isPaused = false;
            const btn = document.getElementById('ttsPlayBtn');
            if (btn) {
                btn.textContent = '⏸️';
                btn.title = '暂停朗读';
            }
            console.log('▶️ 继续播放');
        })
        .catch(err => {
            console.warn('⚠️ 恢复播放失败:', err);
            // 恢复失败，跳过当前段
            ttsState.isPaused = false;
            if (ttsState.queue.length > 0) {
                ttsState.queue.shift(); // 丢弃当前段
                playNextInQueue();
            } else {
                const btn = document.getElementById('ttsPlayBtn');
                if (btn) btn.textContent = '🔊';
            }
        });
}

// ---------- 停止 ----------
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
    if (ttsState.preloadedAudio) {
        ttsState.preloadedAudio.pause();
        ttsState.preloadedAudio.src = '';
        ttsState.preloadedAudio.onended = null;
        ttsState.preloadedAudio = null;
    }
    if (ttsState.preloadedBlobUrl) {
        URL.revokeObjectURL(ttsState.preloadedBlobUrl);
        ttsState.preloadedBlobUrl = null;
    }
    ttsState.preloadedItem = null;

    ttsState.isGenerating = false;
    ttsState.isPlaying = false;
    ttsState.isPaused = false;   // 重置暂停状态
    ttsState.queue = [];
    ttsState.sentences = [];
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
            // 同步更新预加载音频的速度
            if (ttsState.preloadedAudio) {
                ttsState.preloadedAudio.playbackRate = parseFloat(val);
            }
        });
    }
});