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