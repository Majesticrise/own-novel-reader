// ---------- 文件树专用变量 ----------
let folderCounter = 0;
let preloadedNextPath = null;
let preloadedNextContent = null;
let preloadedPrevPath = null;
let preloadedPrevContent = null;

// ---------- 构建目录映射 ----------
function buildDirMap() {
    const dirMap = {};
    allMeta.forEach(item => {
        const path = item.path;
        const lastSlash = path.lastIndexOf('/');
        const dir = lastSlash === -1 ? '' : path.substring(0, lastSlash);
        if (!dirMap[dir]) dirMap[dir] = [];
        dirMap[dir].push(path);
    });
    for (const dir in dirMap) {
        dirMap[dir].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return dirMap;
}
const dirMap = buildDirMap();

// ---------- 预加载下一章/上一章 ----------
function preloadNextChapter(currentPath) {
    try {
        const lastSlash = currentPath.lastIndexOf('/');
        const dir = lastSlash === -1 ? '' : currentPath.substring(0, lastSlash);
        const list = dirMap[dir] || [];
        if (list.length === 0) return;
        const idx = list.indexOf(currentPath);
        if (idx === -1) return;
        const nextIdx = idx + 1;
        if (nextIdx >= list.length) return;
        const nextPath = list[nextIdx];
        if (!nextPath) return;
        if (preloadedNextPath === nextPath) return;
        fetch('/' + nextPath)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(text => {
                preloadedNextPath = nextPath;
                preloadedNextContent = text;
            })
            .catch(() => {});
    } catch (e) {}
}

function preloadPrevChapter(currentPath) {
    try {
        const lastSlash = currentPath.lastIndexOf('/');
        const dir = lastSlash === -1 ? '' : currentPath.substring(0, lastSlash);
        const list = dirMap[dir] || [];
        if (list.length === 0) return;
        const idx = list.indexOf(currentPath);
        if (idx === -1) return;
        const prevIdx = idx - 1;
        if (prevIdx < 0) return;
        const prevPath = list[prevIdx];
        if (!prevPath) return;
        if (preloadedPrevPath === prevPath) return;
        fetch('/' + prevPath)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(text => {
                preloadedPrevPath = prevPath;
                preloadedPrevContent = text;
            })
            .catch(() => {});
    } catch (e) {}
}

// ---------- 切换文章 ----------
function switchFile(delta) {
    if (!currentFile) return;
    saveScrollPositionNow();
    if (readProgress[currentFile] !== undefined) {
        saveReadProgress(currentFile, readProgress[currentFile]);
    }

    const lastSlash = currentFile.lastIndexOf('/');
    const dir = lastSlash === -1 ? '' : currentFile.substring(0, lastSlash);
    const list = dirMap[dir] || [];
    if (list.length === 0) return;
    const idx = list.indexOf(currentFile);
    if (idx === -1) return;
    let newIdx = (idx + delta + list.length) % list.length;
    const newPath = list[newIdx];
    const items = document.querySelectorAll('.file-item');
    let targetElement = null;
    for (let item of items) {
        if (item.dataset.path === newPath) {
            targetElement = item;
            break;
        }
    }
    if (targetElement) {
        preloadedNextPath = null; preloadedNextContent = null;
        preloadedPrevPath = null; preloadedPrevContent = null;
        loadFile(newPath, targetElement);
    } else {
        preloadedNextPath = null; preloadedNextContent = null;
        preloadedPrevPath = null; preloadedPrevContent = null;
        loadFile(newPath, null);
    }
}

// ---------- 应用展开状态 ----------
function applyExpandedState() {
    document.querySelectorAll('.folder').forEach(el => {
        const path = el.dataset.path;
        if (path && expandedFolders.includes(path)) {
            const targetId = el.dataset.target;
            if (targetId) {
                const container = document.getElementById(targetId);
                if (container) {
                    container.style.display = 'block';
                    const icon = el.querySelector('.folder-icon');
                    if (icon) icon.textContent = '▼';
                }
            }
        }
    });
}

// ---------- 文件树渲染 ----------
function renderTreeFromPaths(paths) {
    const root = {};
    paths.forEach(file => {
        const parts = file.split('/');
        let current = root;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                if (!current._files) current._files = [];
                current._files.push(part);
            } else {
                if (!current[part]) current[part] = {};
                current = current[part];
            }
        });
    });

    function naturalCompare(a, b) {
        return a.localeCompare(b, undefined, { numeric: true });
    }

    function renderTree(node, path) {
        let html = '';
        const keys = Object.keys(node).filter(k => k !== '_files');
        keys.sort(naturalCompare);
        keys.forEach(key => {
            const childPath = path ? path + '/' + key : key;
            const containerId = 'folder-' + (folderCounter++);
            html += `<div class="folder" data-target="${containerId}" data-path="${childPath}" onclick="toggleFolder(this)"><span class="folder-icon">▶</span> 📁 ${key}</div>`;
            html += `<div class="child-container" id="${containerId}" style="display:none;">`;
            html += renderTree(node[key], childPath);
            html += `</div>`;
        });
        if (node._files) {
            node._files.sort(naturalCompare);
            node._files.forEach(file => {
                const fullPath = path ? path + '/' + file : file;
                const relative = fullPath.startsWith('chapters/') ? fullPath.substring('chapters/'.length) : fullPath;
                const progress = readProgress[fullPath] || 0;
                const progressText = progress > 0 ? progress + '%' : '';
                html += `<div class="file-item" data-path="${fullPath}" onclick="loadFile('${fullPath}', this)">
                            <span>📄 ${relative}</span>
                            <span class="progress-badge">${progressText}</span>
                        </div>`;
            });
        }
        return html;
    }

    const treeContainer = document.getElementById('file-tree');
    if (paths.length === 0) {
        treeContainer.innerHTML = '<div class="empty">⚠️ 没有匹配的文件</div>';
    } else {
        folderCounter = 0;
        treeContainer.innerHTML = renderTree(root, '');
        applyExpandedState();
        if (currentFile) {
            if (!paths.includes(currentFile)) {
                document.getElementById('file-title').textContent = '📖 选择左侧文件预览';
                document.getElementById('markdown-content').innerHTML = '<p style="opacity:0.6;">当前文件已被筛选过滤</p>';
                document.getElementById('completion-bar').style.display = 'none';
                currentFile = null;
            } else {
                const items = document.querySelectorAll('.file-item');
                for (let item of items) {
                    if (item.dataset.path === currentFile) {
                        item.classList.add('selected');
                        break;
                    }
                }
            }
        }
    }
}

// ---------- 加载文件 ----------
function loadFile(path, element) {
    if (currentFile) {
        saveScrollPositionNow();
    }

    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
    if (element) element.classList.add('selected');

    ensureParentFoldersExpanded(path);

    currentFile = path;
    document.getElementById('file-title').textContent = '📖 ' + path;
    const contentDiv = document.getElementById('markdown-content');
    contentDiv.innerHTML = '<p class="loading">⏳ 加载中...</p>';
    document.getElementById('statusBar').textContent = '加载中...';
    document.getElementById('completion-bar').style.display = 'block';

    const progress = readProgress[path] || 0;
    updateCompleteButton(progress);

    // 检查预加载缓存
    if (preloadedNextPath === path && preloadedNextContent) {
        const text = preloadedNextContent;
        contentDiv.innerHTML = marked.parse(text);
        document.getElementById('statusBar').textContent = `当前阅读：${path}`;
        saveState({ file: path });
        preloadedNextPath = null; preloadedNextContent = null;
        _afterLoadRender(path, text);
        return;
    }
    if (preloadedPrevPath === path && preloadedPrevContent) {
        const text = preloadedPrevContent;
        contentDiv.innerHTML = marked.parse(text);
        document.getElementById('statusBar').textContent = `当前阅读：${path}`;
        saveState({ file: path });
        preloadedPrevPath = null; preloadedPrevContent = null;
        _afterLoadRender(path, text);
        return;
    }

    // 网络请求
    fetch('/' + path)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);
            return res.text();
        })
        .then(text => {
            contentDiv.innerHTML = marked.parse(text);
            document.getElementById('statusBar').textContent = `当前阅读：${path}`;
            saveState({ file: path });
            _afterLoadRender(path, text);
        })
        .catch(err => {
            contentDiv.innerHTML = `<p class="error">❌ 读取失败: ${err.message}</p>`;
            document.getElementById('statusBar').textContent = '加载失败';
        });
}

// 渲染完成后的统一处理
function _afterLoadRender(path, text) {
    const metaBar = document.getElementById('meta-bar');
    const authorName = document.getElementById('author-name');
    const tagsContainer = document.getElementById('tags-container');
    const meta = allMeta.find(item => item.path === path);
    if (meta && (meta.author || (meta.tags && meta.tags.length > 0))) {
        metaBar.style.display = 'flex';
        authorName.textContent = meta.author || '未知';
        tagsContainer.innerHTML = '';
        if (meta.tags && meta.tags.length > 0) {
            meta.tags.forEach(tag => {
                const tagBtn = document.createElement('span');
                tagBtn.textContent = tag;
                tagBtn.style.cssText = `
                            display: inline-block;
                            padding: 2px 12px;
                            border-radius: 12px;
                            background: var(--search-bg);
                            color: var(--text);
                            border: 1px solid var(--search-border);
                            font-size: 0.85rem;
                            cursor: pointer;
                            transition: all 0.2s;
                            user-select: none;
                        `;
                tagBtn.onmouseenter = function() {
                    this.style.background = 'var(--link)';
                    this.style.color = 'white';
                    this.style.borderColor = 'var(--link)';
                };
                tagBtn.onmouseleave = function() {
                    this.style.background = 'var(--search-bg)';
                    this.style.color = 'var(--text)';
                    this.style.borderColor = 'var(--search-border)';
                };
                tagBtn.onclick = function(e) {
                    e.stopPropagation();
                    filterByTag(tag);
                };
                tagsContainer.appendChild(tagBtn);
            });
        } else {
            tagsContainer.innerHTML = '<span style="opacity:0.6;">无</span>';
        }
    } else {
        metaBar.style.display = 'none';
    }

    const content = document.querySelector('.content');
    if (appState.scroll_positions && appState.scroll_positions[path] !== undefined) {
        content.scrollTop = appState.scroll_positions[path];
        setTimeout(() => {
            updateProgressBar();
            const currentP = readProgress[path] || 0;
            if (currentP === 0 && content.scrollTop > 0) {
                const sh = content.scrollHeight - content.clientHeight;
                if (sh > 0) {
                    const p = Math.round((content.scrollTop / sh) * 100);
                    if (p > 0) {
                        readProgress[path] = p;
                        updateFileItemProgress(path, p);
                        updateCompleteButton(p);
                        saveReadProgress(path, p);
                    }
                }
            }
        }, 50);
    } else {
        content.scrollTop = 0;
        updateProgressBar();
    }
    updateFileItemProgress(path, readProgress[path] || 0);
    renderRecommendations(path);

    // 预加载下一章与前一章
    preloadNextChapter(path);
    preloadPrevChapter(path);
}