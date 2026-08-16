// ---------- 核心全局状态 ----------
let appState = {};
let currentFile = null;
let currentFilteredPaths = [];
let expandedFolders = [];
let progressSaveTimer = null;
let scrollSaveTimer = null;

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

// ---------- 展开文件路径的所有父文件夹 ----------
function ensureParentFoldersExpanded(filePath) {
    const parts = filePath.split('/');
    const dirs = parts.slice(0, -1);
    let currentPath = '';
    for (let i = 0; i < dirs.length; i++) {
        currentPath = i === 0 ? dirs[i] : currentPath + '/' + dirs[i];
        const folderEl = document.querySelector(`.folder[data-path="${currentPath}"]`);
        if (!folderEl) continue;
        const targetId = folderEl.dataset.target;
        if (!targetId) continue;
        const container = document.getElementById(targetId);
        if (!container) continue;
        const isHidden = container.style.display === 'none' || getComputedStyle(container).display === 'none';
        if (isHidden) {
            toggleFolder(folderEl);
        }
    }
}

// ---------- 保存状态（通用） ----------
function saveState(state) {
    fetch('/save_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
    }).catch(e => console.warn('保存状态失败', e));
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

// ---------- 滚动事件 ----------
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