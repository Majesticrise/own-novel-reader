// ---------- 侧边栏折叠/展开 ----------
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebarResizer');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (!sidebar || !resizer || !toggleBtn) return;

    const isHidden = sidebar.classList.toggle('hidden');
    resizer.classList.toggle('hidden', isHidden);
    toggleBtn.textContent = isHidden ? '⊞' : '⛶';
    toggleBtn.title = isHidden ? '展开侧边栏' : '折叠侧边栏';
    localStorage.setItem('sidebarHidden', isHidden ? 'true' : 'false');
}

// 初始化侧边栏折叠状态
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
        sidebar.classList.remove('hidden');
        resizer.classList.remove('hidden');
        toggleBtn.textContent = '⛶';
        toggleBtn.title = '折叠侧边栏';
    }
})();

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

// 初始化主题
if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
    document.querySelector('.theme-toggle').textContent = '☀️';
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

// 搜索框事件
document.getElementById('searchInput').addEventListener('keyup', function(e) {
    if (e.key === 'Enter') doSearch();
});
document.getElementById('searchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        this.value = '';
        document.getElementById('searchResults').style.display = 'none';
        this.blur();
        e.preventDefault();
        e.stopPropagation();
    }
});

// ---------- 全局键盘事件 ----------
document.addEventListener('keydown', function(e) {
    if (e.target.id === 'searchInput' && e.key === 'Escape') {
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

// ---------- 初始化应用 ----------
initFilterUI();
applyFilters();
loadLastState();