// ---------- 筛选状态 ----------
let currentAuthor = '';
let currentTags = [];

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

// ---------- 初始化筛选器 UI ----------
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

// ---------- 同步 UI 与当前筛选状态 ----------
function syncFilterUI() {
    document.getElementById('authorFilter').value = currentAuthor || '';
    document.querySelectorAll('#tagFilters .tag-btn').forEach(btn => {
        btn.classList.toggle('selected', currentTags.includes(btn.dataset.tag));
    });
}

// ---------- 获取筛选后的路径列表 ----------
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

// ---------- 应用筛选 ----------
function applyFilters() {
    currentFilteredPaths = getFilteredPaths();
    renderTreeFromPaths(currentFilteredPaths);
    document.getElementById('searchInput').placeholder = `搜索当前 ${currentFilteredPaths.length} 个文件...`;
    document.getElementById('searchResults').style.display = 'none';
    document.getElementById('statusBar').textContent = `显示 ${currentFilteredPaths.length} 个文件`;
}

// ---------- 重置筛选 ----------
function resetFilters() {
    document.getElementById('authorFilter').value = '';
    document.querySelectorAll('#tagFilters .tag-btn').forEach(btn => btn.classList.remove('selected'));
    applyFilters();
}

// ---------- 辅助筛选（从元数据栏触发） ----------
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