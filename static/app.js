// ---------- 全局状态 ----------
let appState = {};
let currentFile = null;
let currentFilteredPaths = [];
let folderCounter = 0;
let expandedFolders = [];


// ---------- 进度条显示 ----------
function updateProgressBar() {
    const content = document.querySelector('.content');
    if (!content) return;
    const scrollTop = content.scrollTop;
    const scrollHeight = content.scrollHeight - content.clientHeight;
    const progress = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
    document.getElementById('progress-fill').style.width = progress + '%';
}

// ---------- 更新单个文件项的进度徽标 ----------
function updateFileItemProgress(path, progress) {
    const items = document.querySelectorAll('.file-item');
    for (let item of items) {
        if (item.dataset.path === path) {
            const badge = item.querySelector('.progress-badge');
            if (badge) {
                badge.textContent = progress > 0 ? progress + '%' : '';
            }
            break;
        }
    }
}

// ---------- 更新底部完成按钮状态 ----------
function updateCompleteButton(progress) {
    const btn = document.getElementById('btn-complete');
    if (!btn) return;
    if (progress >= 100) {
        btn.textContent = '清除进度';
        btn.classList.add('clear');
    } else {
        btn.textContent = '标记为完成';
        btn.classList.remove('clear');
    }
}

// ---------- 保存阅读进度到服务器（节流） ----------
let progressSaveTimer = null;
function saveReadProgress(path, progress) {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(() => {
        const payload = {
            read_progress: { [path]: progress }
        };
        fetch('/save_state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(e => console.warn('保存进度失败', e));
    }, 800);
}

// ---------- 保存滚动位置（立即执行，用于切换时） ----------
function saveScrollPositionNow() {
    if (!currentFile) return;
    const content = document.querySelector('.content');
    if (!content) return;
    const y = content.scrollTop;
    if (y >= 0) {
        if (!appState.scroll_positions) appState.scroll_positions = {};
        appState.scroll_positions[currentFile] = y;
        const payload = {
            scroll_positions: { [currentFile]: y }
        };
        fetch('/save_state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(e => console.warn('保存滚动位置失败', e));
    }
}

// ---------- 保存展开状态 ----------
function saveExpandedFolders() {
    const payload = { expanded_folders: expandedFolders };
    fetch('/save_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(e => console.warn('保存展开状态失败', e));
}

// ---------- 全局 toggleFolder ----------
function toggleFolder(element) {
    const targetId = element.dataset.target;
    if (!targetId) return;
    const container = document.getElementById(targetId);
    if (!container) return;
    const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
    container.style.display = isHidden ? 'block' : 'none';
    const iconSpan = element.querySelector('.folder-icon');
    if (iconSpan) {
        iconSpan.textContent = isHidden ? '▼' : '▶';
    }
    const path = element.dataset.path;
    if (path) {
        if (isHidden) {
            if (!expandedFolders.includes(path)) {
                expandedFolders.push(path);
            }
        } else {
            const idx = expandedFolders.indexOf(path);
            if (idx !== -1) expandedFolders.splice(idx, 1);
        }
        saveExpandedFolders();
    }
}

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
        loadFile(newPath, targetElement);
    } else {
        loadFile(newPath, null);
    }
}

// ---------- 键盘事件 ----------
document.addEventListener('keydown', function(e) {
    // 如果焦点在搜索框，且按了 ESC，则交给搜索框自己的处理（见下方搜索输入框监听）
    if (e.target.id === 'searchInput' && e.key === 'Escape') {
        // 让搜索框自己的监听处理，这里不做拦截，否则会两次触发
        return;
    }
    if (e.key === 'Escape') {
        const modal = document.getElementById('filterModal');
        if (modal.classList.contains('active')) {
            closeFilterModal();
            e.preventDefault();
            return;
        }
    }
    if (!document.getElementById('filterModal').classList.contains('active')) {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            switchFile(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            switchFile(1);
        }
    }
});

// ---------- 模态框控制 ----------
function openFilterModal() {
    document.getElementById('filterModal').classList.add('active');
    syncFilterUI();
}
function closeFilterModal() {
    document.getElementById('filterModal').classList.remove('active');
}
function applyFiltersAndClose() {
    applyFilters();
    closeFilterModal();
}
document.getElementById('filterModal').addEventListener('click', function(e) {
    if (e.target === this) closeFilterModal();
});

// ---------- 初始化筛选器 ----------
function initFilterUI() {
    const authorSelect = document.getElementById('authorFilter');
    authorSelect.innerHTML = '<option value="">全部</option>';
    allAuthors.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        authorSelect.appendChild(opt);
    });

    const tagContainer = document.getElementById('tagFilters');
    tagContainer.innerHTML = '';
    allTags.forEach(tag => {
        const btn = document.createElement('span');
        btn.className = 'tag-btn';
        btn.textContent = tag;
        btn.dataset.tag = tag;
        btn.onclick = function() { this.classList.toggle('selected'); };
        tagContainer.appendChild(btn);
    });
}

// ---------- 随机阅读 ----------
function goRandom() {
    if (!currentFilteredPaths || currentFilteredPaths.length === 0) return;
    const randomPath = currentFilteredPaths[Math.floor(Math.random() * currentFilteredPaths.length)];
    const items = document.querySelectorAll('.file-item');
    let targetElement = null;
    for (let item of items) {
        if (item.dataset.path === randomPath) {
            targetElement = item;
            break;
        }
    }
    if (targetElement) {
        loadFile(randomPath, targetElement);
    } else {
        loadFile(randomPath, null);
    }
}

// ---------- 侧边栏宽度拖拽 ----------
(function initSidebarResizer() {
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.querySelector('.sidebar');
    if (!resizer || !sidebar) return;

    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        const w = parseInt(savedWidth, 10);
        if (w > 200 && w < 600) sidebar.style.width = w + 'px';
    }

    let isDragging = false;
    let startX, startWidth;

    resizer.addEventListener('mousedown', function(e) {
        isDragging = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'col-resize';
        resizer.classList.add('active');
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const delta = e.clientX - startX;
        let newWidth = startWidth + delta;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 600) newWidth = 600;
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = '';
            resizer.classList.remove('active');
            const w = sidebar.offsetWidth;
            localStorage.setItem('sidebarWidth', w);
        }
    });
})();

// ★★★ 新增：侧边栏折叠/展开功能 ★★★
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebarResizer');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (!sidebar || !resizer || !toggleBtn) return;

    const isHidden = sidebar.classList.toggle('hidden');
    resizer.classList.toggle('hidden', isHidden);
    // 切换图标：折叠时显示展开图标，展开时显示折叠图标
    toggleBtn.textContent = isHidden ? '⊞' : '⛶';
    toggleBtn.title = isHidden ? '展开侧边栏' : '折叠侧边栏';
    // 保存状态
    localStorage.setItem('sidebarHidden', isHidden ? 'true' : 'false');
}

// 初始化时读取折叠状态
(function initSidebarState() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebarResizer');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (!sidebar || !resizer || !toggleBtn) return;
    const saved = localStorage.getItem('sidebarHidden');
    if (saved === 'true') {
        sidebar.classList.add('hidden');
        resizer.classList.add('hidden');
        toggleBtn.textContent = '⊞';
        toggleBtn.title = '展开侧边栏';
    } else {
        // 默认展开
        sidebar.classList.remove('hidden');
        resizer.classList.remove('hidden');
        toggleBtn.textContent = '⛶';
        toggleBtn.title = '折叠侧边栏';
    }
})();

let currentAuthor = '';
let currentTags = [];

function syncFilterUI() {
    document.getElementById('authorFilter').value = currentAuthor || '';
    document.querySelectorAll('#tagFilters .tag-btn').forEach(btn => {
        btn.classList.toggle('selected', currentTags.includes(btn.dataset.tag));
    });
}

// ---------- 筛选逻辑 ----------
function getFilteredPaths() {
    const author = document.getElementById('authorFilter').value;
    const selectedTags = Array.from(document.querySelectorAll('#tagFilters .tag-btn.selected')).map(el => el.dataset.tag);
    currentAuthor = author;
    currentTags = selectedTags;

    return allMeta
        .filter(item => {
            if (author && item.author !== author) return false;
            if (selectedTags.length > 0) {
                for (let t of selectedTags) {
                    if (!item.tags.includes(t)) return false;
                }
            }
            return true;
        })
        .map(item => item.path);
}

function applyFilters() {
    currentFilteredPaths = getFilteredPaths();
    renderTreeFromPaths(currentFilteredPaths);
    document.getElementById('searchInput').placeholder = `搜索当前 ${currentFilteredPaths.length} 个文件...`;
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('statusBar').textContent = `显示 ${currentFilteredPaths.length} 个文件`;
}

function resetFilters() {
    document.getElementById('authorFilter').value = '';
    document.querySelectorAll('#tagFilters .tag-btn').forEach(btn => btn.classList.remove('selected'));
    applyFilters();
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

// ---------- 切换完成状态 ----------
function toggleCompletion() {
    if (!currentFile) return;
    const currentProgress = readProgress[currentFile] || 0;
    let newProgress;
    if (currentProgress >= 100) {
        newProgress = 0;
    } else {
        newProgress = 100;
    }
    readProgress[currentFile] = newProgress;
    updateFileItemProgress(currentFile, newProgress);
    updateCompleteButton(newProgress);
    saveReadProgress(currentFile, newProgress);
}

// ============================================================
// ===== 推荐算法（基于雅卡尔指数） =====
// ============================================================
function jaccardSimilarity(tagsA, tagsB) {
    if (!tagsA || !tagsB || tagsA.length === 0 || tagsB.length === 0) return 0;
    const setA = new Set(tagsA);
    const setB = new Set(tagsB);
    let intersection = 0;
    for (let tag of setA) {
        if (setB.has(tag)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : (intersection / union);
}

function getRecommendations(currentPath, topN = 6) {
    const currentMeta = allMeta.find(item => item.path === currentPath);
    if (!currentMeta || !currentMeta.tags || currentMeta.tags.length === 0) return [];

    const scores = [];
    for (let item of allMeta) {
        if (item.path === currentPath) continue;
        if (!item.tags || item.tags.length === 0) continue;
        const score = jaccardSimilarity(currentMeta.tags, item.tags);
        if (score > 0) {
            scores.push({ path: item.path, score: Math.round(score * 100) });
        }
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topN);
}

function renderRecommendations(path) {
    const container = document.getElementById('recommendations-container');
    const list = document.getElementById('recommendations-list');
    if (!container || !list) return;

    const recs = getRecommendations(path, 6);
    if (recs.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    list.innerHTML = '';
    recs.forEach(rec => {
        const relativePath = rec.path.startsWith('chapters/') ? rec.path.substring('chapters/'.length) : rec.path;
        const displayName = relativePath.includes('/') ? relativePath : relativePath.split('/').pop();

        const item = document.createElement('span');
        item.className = 'rec-item';
        item.innerHTML = `${displayName} <span class="rec-score">${rec.score}%</span>`;
        item.onclick = function(e) {
            e.stopPropagation();
            const fileItems = document.querySelectorAll('.file-item');
            let target = null;
            for (let fi of fileItems) {
                if (fi.dataset.path === rec.path) {
                    target = fi;
                    break;
                }
            }
            if (target) {
                loadFile(rec.path, target);
            } else {
                loadFile(rec.path, null);
            }
        };
        list.appendChild(item);
    });
}

// ---------- 加载文件 ----------
function loadFile(path, element) {
    if (currentFile) {
        saveScrollPositionNow();
    }

    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
    if (element) element.classList.add('selected');

    currentFile = path;
    document.getElementById('file-title').textContent = '📖 ' + path;
    const contentDiv = document.getElementById('markdown-content');
    contentDiv.innerHTML = '<p class="loading">⏳ 加载中...</p>';
    document.getElementById('statusBar').textContent = '加载中...';
    document.getElementById('completion-bar').style.display = 'block';

    const progress = readProgress[path] || 0;
    updateCompleteButton(progress);

    fetch('/' + path)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);
            return res.text();
        })
        .then(text => {
            contentDiv.innerHTML = marked.parse(text);
            document.getElementById('statusBar').textContent = `当前阅读：${path}`;
            saveState({ file: path });

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
        })
        .catch(err => {
            contentDiv.innerHTML = `<p class="error">❌ 读取失败: ${err.message}</p>`;
            document.getElementById('statusBar').textContent = '加载失败';
        });
}

// ---------- 保存状态（通用） ----------
function saveState(state) {
    fetch('/save_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    }).catch(e => console.warn('保存状态失败', e));
}

// ---------- 加载全部状态 ----------
function loadLastState() {
    fetch('/get_state')
        .then(res => res.json())
        .then(state => {
            appState = state || {};
            if (appState.expanded_folders) {
                expandedFolders = appState.expanded_folders;
            } else {
                expandedFolders = [];
            }
            if (appState.read_progress) {
                Object.assign(readProgress, appState.read_progress);
            }
            renderTreeFromPaths(currentFilteredPaths);
            if (appState.file && currentFilteredPaths.includes(appState.file)) {
                const items = document.querySelectorAll('.file-item');
                for (let item of items) {
                    if (item.dataset.path === appState.file) {
                        loadFile(appState.file, item);
                        break;
                    }
                }
            }
            applyExpandedState();
        })
        .catch(() => {});
}

// ---------- 搜索 ----------
function doSearch() {
    const input = document.getElementById('searchInput');
    const keyword = input.value.trim();
    const resultsDiv = document.getElementById('searchResults');
    if (!keyword) {
        resultsDiv.style.display = 'none';
        return;
    }
    resultsDiv.innerHTML = '<div class="loading">搜索中...</div>';
    resultsDiv.style.display = 'block';
    fetch('/search?q=' + encodeURIComponent(keyword))
        .then(res => res.json())
        .then(data => {
            const filtered = data.filter(item => currentFilteredPaths.includes(item.file));
            if (filtered.length === 0) {
                resultsDiv.innerHTML = '<div class="empty">未找到匹配内容</div>';
                return;
            }
            let html = '';
            filtered.forEach(item => {
                html += `<div class="result-item" onclick="loadFile('${item.file}', null)">`;
                html += `<div class="file-name">📄 ${item.file}</div>`;
                item.matches.forEach(m => {
                    let context = m.context.replace(new RegExp(keyword, 'gi'), match => `<span class="highlight">${match}</span>`);
                    html += `<div class="context">${context}</div>`;
                });
                html += `</div>`;
            });
            resultsDiv.innerHTML = html;
        })
        .catch(err => {
            resultsDiv.innerHTML = '<div class="error">搜索出错</div>';
        });
}

document.getElementById('searchInput').addEventListener('keyup', function(e) {
    if (e.key === 'Enter') doSearch();
});

// ★★★ 新增：搜索框按下 ESC 清空并关闭 ★★★
document.getElementById('searchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        this.value = '';
        document.getElementById('searchResults').style.display = 'none';
        this.blur(); // 失去焦点
        e.preventDefault(); // 阻止冒泡，避免触发全局 ESC 关闭模态框
        e.stopPropagation();
    }
});

// ---------- 滚动事件 ----------
let scrollSaveTimer = null;
const contentScrollElement = document.querySelector('.content');
contentScrollElement.addEventListener('scroll', function() {
    updateProgressBar();

    if (!currentFile) return;

    const scrollTop = this.scrollTop;
    const scrollHeight = this.scrollHeight - this.clientHeight;
    const isBottom = scrollHeight > 0 && (scrollTop + this.clientHeight >= scrollHeight - 2);
    let progress = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
    if (isBottom) progress = 100;

    if (readProgress[currentFile] !== progress) {
        readProgress[currentFile] = progress;
        updateFileItemProgress(currentFile, progress);
        updateCompleteButton(progress);
        saveReadProgress(currentFile, progress);
    }

    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = setTimeout(() => {
        if (!currentFile) return;
        const y = this.scrollTop;
        if (y >= 0) {
            if (!appState.scroll_positions) appState.scroll_positions = {};
            appState.scroll_positions[currentFile] = y;
            const payload = { scroll_positions: { [currentFile]: y } };
            fetch('/save_state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(e => console.warn('保存滚动位置失败', e));
        }
    }, 500);
});

window.addEventListener('beforeunload', function() {
    saveScrollPositionNow();
});

// ---------- 暗色主题 ----------
function toggleTheme() {
    document.body.classList.toggle('dark');
    const btn = document.querySelector('.theme-toggle');
    if (document.body.classList.contains('dark')) {
        btn.textContent = '☀️';
        localStorage.setItem('theme', 'dark');
    } else {
        btn.textContent = '🌙';
        localStorage.setItem('theme', 'light');
    }
}

if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
    document.querySelector('.theme-toggle').textContent = '☀️';
}

// ---------- 筛选辅助 ----------
function filterByAuthor() {
    const authorName = document.getElementById('author-name');
    if (!authorName || !authorName.textContent || authorName.textContent === '未知') return;
    const author = authorName.textContent;
    openFilterModal();
    const authorSelect = document.getElementById('authorFilter');
    if ([...authorSelect.options].some(opt => opt.value === author)) {
        authorSelect.value = author;
    } else {
        return;
    }
    document.querySelectorAll('#tagFilters .tag-btn').forEach(btn => btn.classList.remove('selected'));
    applyFiltersAndClose();
}

function filterByTag(tag) {
    if (!tag) return;
    openFilterModal();
    document.getElementById('authorFilter').value = '';
    document.querySelectorAll('#tagFilters .tag-btn').forEach(btn => {
        if (btn.dataset.tag === tag) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    applyFiltersAndClose();
}

// ---------- 初始化 ----------
initFilterUI();
applyFilters();
loadLastState();