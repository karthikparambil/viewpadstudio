/* ═══════════════════════════════════════
   DATA
═══════════════════════════════════════ */
const edges = [];

const rpTitles = {};
const nodeNotes = {}; // Per-node rich notes storage
let nodeCounter = 10;

let selectedEdgeIdx = null;
let ctxTargetNodeId = null;
let ctxTargetProjectId = null;

/* ═══════════════════════════════════════
   PROJECTS
═══════════════════════════════════════ */
const PROJECTS = [];
let activeProjectId = null;

const STATUS_COLORS = { active: '#1d9e75', paused: '#5a6a88', draft: '#ef9f27', error: '#e24b4a' };

function getCanvasState() {
    const nodeData = [...document.querySelectorAll('.node')].map(el => {
        const nh = el.querySelector('.nh');
        const nt = el.querySelector('.nt');
        const nd = el.querySelector('.nd-desc');
        const tags = [...el.querySelectorAll('.nd-tags .tag')].map(t => ({
            text: t.textContent,
            class: t.className
        }));
        const fields = [...el.querySelectorAll('.nr')].map(f => ({
            k: f.querySelector('.nk')?.textContent || '',
            v: f.querySelector('.nv')?.textContent || '',
            color: f.querySelector('.nv')?.style.color || ''
        }));
        return {
            id: el.id.replace('n-', ''),
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top),
            type: el.dataset.node,
            label: nt?.textContent || '',
            desc: nd?.textContent || '',
            color: nh ? rgbToHex(getComputedStyle(nh).borderLeftColor) : '#1d9e75',
            tags,
            fields
        };
    });

    const noteData = [...document.querySelectorAll('.notecard')].map(el => {
        return { id: el.id, x: parseFloat(el.style.left), y: parseFloat(el.style.top), html: el.innerHTML };
    });

    return {
        nodes: nodeData,
        notecards: noteData,
        edges: [...edges],
        nodeNotes: { ...nodeNotes },
        rpTitles: { ...rpTitles },
        nodeCounter
    };
}

function saveToStorage() {
    // If there's an active project, sync the current canvas state into it
    if (activeProjectId) {
        const p = PROJECTS.find(x => x.id === activeProjectId);
        if (p) p.canvasState = getCanvasState();
    }
    const state = { PROJECTS, activeProjectId };
    sessionStorage.setItem('flowforge_state', JSON.stringify(state));
}

function loadFromStorage() {
    const stored = sessionStorage.getItem('flowforge_state');
    if (!stored) return false;
    try {
        const state = JSON.parse(stored);
        PROJECTS.length = 0;
        PROJECTS.push(...state.PROJECTS);
        activeProjectId = state.activeProjectId;

        if (activeProjectId) {
            const p = PROJECTS.find(x => x.id === activeProjectId);
            if (p && p.canvasState) {
                restoreCanvasState(p.canvasState);
            }
        }

        renderProjects();
        if (activeProjectId) {
            const p = PROJECTS.find(x => x.id === activeProjectId);
            if (p) {
                const fn = document.querySelector('.fw-status span:last-child');
                if (fn) fn.textContent = (p.name || 'Untitled') + '.json';
            }
        }
        updateNodeCount();
        drawEdges();
        return true;
    } catch (e) {
        console.error('Failed to load state', e);
        return false;
    }
}

function restoreCanvasState(cs) {
    // Clear current
    document.querySelectorAll('.node, .notecard').forEach(el => el.remove());
    edges.length = 0;
    Object.keys(nodeNotes).forEach(k => delete nodeNotes[k]);
    Object.keys(rpTitles).forEach(k => delete rpTitles[k]);
    selectedEdgeIdx = null;
    ctxTargetNodeId = null;
    ctxTargetProjectId = null;
    closeAllMenus();

    // Restore data
    if (cs.edges) edges.push(...cs.edges);
    if (cs.nodeNotes) Object.assign(nodeNotes, cs.nodeNotes);
    if (cs.rpTitles) Object.assign(rpTitles, cs.rpTitles);
    nodeCounter = cs.nodeCounter || 10;
    if (cs.nodes) cs.nodes.forEach(n => recreateNode(n));
    if (cs.notecards) cs.notecards.forEach(nc => recreateNotecard(nc));
}

function recreateNode(n) {
    const el = document.createElement('div');
    el.className = 'node'; el.id = 'n-' + n.id; el.dataset.node = n.type;
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    const tagsHtml = (n.tags || []).map(t => `<span class="${t.class}">${t.text}</span>`).join('');
    const fieldsHtml = (n.fields || []).map(f => `<div class="nr"><span class="nk">${f.k}</span><span class="nv" style="${f.color ? 'color:' + f.color : ''}">${f.v}</span></div>`).join('');
    el.innerHTML = `
        <div class="port port-i" id="pi-${n.id}" data-port="pi-${n.id}" data-type="in" data-node="${n.id}"></div>
        <div class="port port-o" id="po-${n.id}" data-port="po-${n.id}" data-type="out" data-node="${n.id}"></div>
        <div class="nh" style="border-left:4px solid ${n.color}">
          <i class="ti ti-plus" style="font-size:16px;color:${n.color}"></i>
          <span class="nt">${n.label}</span>
        </div>
        <div class="nb">
          <div class="nd-desc">${n.desc}</div>
          <div class="nd-tags">${tagsHtml}</div>
          <div>${fieldsHtml}</div>
        </div>`;
    world.appendChild(el);
    makeDraggable(el);
    bindNodeContextMenu(el);
    bindAllPorts(el);
    initEditableValues(el);
}

function recreateNotecard(nc) {
    const el = document.createElement('div');
    el.className = 'notecard'; el.id = nc.id;
    el.style.left = nc.x + 'px'; el.style.top = nc.y + 'px';
    el.innerHTML = nc.html;
    world.appendChild(el);
    makeFreeMovable(el);
    bindNoteContextMenu(el);
    initEditableValues(el);
}

function renderProjects() {
    const list = document.getElementById('proj-list');
    list.innerHTML = '';
    if (PROJECTS.length === 0) {
        list.innerHTML = `<div style="padding:20px 16px;color:var(--text-dim);font-size:12px;text-align:center;opacity:0.6;font-family:var(--font-display);">No projects yet.<br>Click <strong>New Project</strong> to create one.</div>`;
        return;
    }
    PROJECTS.forEach(p => {
        const card = document.createElement('div');
        card.className = 'proj-card' + (p.id === activeProjectId ? ' active' : '');
        card.innerHTML = `
      <div class="proj-name">${p.name}</div>
      <div class="proj-meta">
        <span><i class="ti ti-git-branch"></i> ${p.nodes} nodes</span>
        <span><i class="ti ti-clock"></i> ${p.modified}</span>
      </div>`;
        card.addEventListener('click', () => switchProject(p.id));

        // Right-click context menu
        card.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            closeAllMenus();
            ctxTargetProjectId = p.id;
            const m = document.getElementById('proj-ctx');
            m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
            m.classList.add('open');
        });

        list.appendChild(card);
    });
}

function switchProject(id) {
    // First, save current project's state if there's one
    if (activeProjectId) {
        const currentP = PROJECTS.find(x => x.id === activeProjectId);
        if (currentP) currentP.canvasState = getCanvasState();
    }

    activeProjectId = id;
    const p = PROJECTS.find(x => x.id === id);
    renderProjects();

    // Update status bar filename
    const fn = document.querySelector('.fw-status span:last-child');
    if (fn) fn.textContent = (p?.name || 'Untitled') + '.json';

    // Clear canvas and restore new project state
    if (p && p.canvasState) {
        restoreCanvasState(p.canvasState);
    } else {
        // New/Empty project: Reset everything
        document.querySelectorAll('.node, .notecard').forEach(el => el.remove());
        edges.length = 0;
        Object.keys(nodeNotes).forEach(k => delete nodeNotes[k]);
        Object.keys(rpTitles).forEach(k => delete rpTitles[k]);
        nodeCounter = 10;
    }

    tx = 0; ty = 0; scale = 1; applyTransform(); drawEdges();
    updateNodeCount();

    // brief project name flash in toolbar
    const nb = document.getElementById('node-count-btn');
    if (nb) { nb.style.color = 'var(--accent)'; setTimeout(() => nb.style.color = '', 600); }
    saveToStorage();
}

// Sidebar tab switcher
document.querySelectorAll('.sb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.sb-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sb-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// Sidebar node-pill click adds a node
document.querySelectorAll('#tab-nodes .sb-pill[data-add]').forEach(pill => {
    pill.addEventListener('click', () => {
        const tpl = NODE_TEMPLATES[pill.dataset.add];
        if (tpl) addNode(pill.dataset.add, tpl, 200 + Math.random() * 300, 150 + Math.random() * 200);
    });
});

// New project button
document.getElementById('new-proj-btn').addEventListener('click', () => {
    showModal({
        title: 'New Project',
        message: 'Enter a name for your new workspace:',
        prompt: true,
        onConfirm: (name) => {
            if (!name) return;
            const id = 'p' + (Date.now());
            PROJECTS.push({ id, name, nodes: 0, status: 'draft', color: '#5a6a88', modified: 'just now' });
            renderProjects();
            switchProject(id);
            saveToStorage();
        }
    });
});


// Import project
document.getElementById('import-proj-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
});

document.getElementById('import-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if (!data.project || !data.nodes) throw new Error('Invalid format');

            // Clear existing canvas if it belonged to same project, else add as new
            const existingIdx = PROJECTS.findIndex(x => x.id === data.project.id);
            if (existingIdx !== -1) {
                PROJECTS[existingIdx] = data.project;
            } else {
                PROJECTS.push(data.project);
            }

            // Clear canvas
            document.querySelectorAll('.node, .notecard').forEach(el => el.remove());
            edges.length = 0;
            Object.keys(nodeNotes).forEach(k => delete nodeNotes[k]);
            Object.keys(rpTitles).forEach(k => delete rpTitles[k]);

            // Restore
            Object.assign(nodeNotes, data.nodeNotes || {});
            Object.assign(rpTitles, data.rpTitles || {});
            nodeCounter = data.nodeCounter || nodeCounter;
            edges.push(...(data.edges || []));
            data.nodes.forEach(n => recreateNode(n));
            (data.notecards || []).forEach(nc => recreateNotecard(nc));

            activeProjectId = data.project.id;
            renderProjects();
            updateNodeCount();
            drawEdges();
            saveToStorage();
        } catch (err) {
            showModal({ title: 'Import Failed', message: 'Could not import project. Make sure the file is a valid FlowForge export.' });
        }
        // Reset file input so same file can be re-imported
        e.target.value = '';
    };
    reader.readAsText(file);
});

/* ═══════════════════════════════════════
   CANVAS TRANSFORM STATE
═══════════════════════════════════════ */
const canvas = document.getElementById('fw-canvas');
const world = document.getElementById('canvas-world');
const svg = document.getElementById('conn-svg');

let tx = 0, ty = 0, scale = 1;

function applyTransform() {
    world.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    world.style.transformOrigin = '0 0';
    saveToStorage();
    document.getElementById('grid-dots').style.backgroundPosition =
        `${tx % 22}px ${ty % 22}px`;
    document.getElementById('zoom-label').textContent = Math.round(scale * 100) + '%';
}

/* ═══════════════════════════════════════
   SCROLL TO ZOOM
═══════════════════════════════════════ */
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.09 : 0.91;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    tx = mx - f * (mx - tx); ty = my - f * (my - ty);
    scale = Math.max(0.15, Math.min(4, scale * f));
    applyTransform(); drawEdges();
}, { passive: false });

document.getElementById('zoom-in-btn').addEventListener('click', () => {
    const r = canvas.getBoundingClientRect(), f = 1.15;
    tx = r.width / 2 - f * (r.width / 2 - tx); ty = r.height / 2 - f * (r.height / 2 - ty);
    scale = Math.min(4, scale * f); applyTransform(); drawEdges();
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
    const r = canvas.getBoundingClientRect(), f = 0.87;
    tx = r.width / 2 - f * (r.width / 2 - tx); ty = r.height / 2 - f * (r.height / 2 - ty);
    scale = Math.max(0.15, scale * f); applyTransform(); drawEdges();
});
document.getElementById('reset-btn').addEventListener('click', () => {
    tx = 0; ty = 0; scale = 1; applyTransform(); drawEdges();
});

/* ═══════════════════════════════════════
   CANVAS PAN — LEFT-CLICK HOLD on empty canvas
═══════════════════════════════════════ */
let panning = false, panSX = 0, panSY = 0, panOTx = 0, panOTy = 0;
canvas.addEventListener('pointerdown', e => {
    // Pan when clicking bare canvas (not a node/notecard/port/menu) OR middle-mouse
    const onEmpty = !e.target.closest('.node') && !e.target.closest('.notecard') &&
        !e.target.closest('.port') && !e.target.closest('.ctx-menu') &&
        !e.target.closest('.fw-toolbar');
    if (e.button === 1 || (e.button === 0 && onEmpty)) {
        panning = true; panSX = e.clientX; panSY = e.clientY;
        panOTx = tx; panOTy = ty;
        canvas.classList.add('panning');
        canvas.setPointerCapture(e.pointerId); e.preventDefault();
    }
});
canvas.addEventListener('pointermove', e => {
    if (!panning) return;
    tx = panOTx + (e.clientX - panSX); ty = panOTy + (e.clientY - panSY);
    applyTransform(); drawEdges();
});
canvas.addEventListener('pointerup', () => { panning = false; canvas.classList.remove('panning'); });
let spaceDown = false;
window.addEventListener('keydown', e => { if (e.code === 'Space') { spaceDown = true; e.preventDefault(); } });
window.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });

/* ═══════════════════════════════════════
   EDGE DRAWING — world-local coords
═══════════════════════════════════════ */
function worldPos(el) {
    const wr = world.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { x: (er.left + er.width / 2 - wr.left) / scale, y: (er.top + er.height / 2 - wr.top) / scale };
}
function makeBezier(p1, p2) {
    const cx = (p1.x + p2.x) / 2;
    return `M${p1.x},${p1.y} C${cx},${p1.y} ${cx},${p2.y} ${p2.x},${p2.y}`;
}

function drawEdges() {
    svg.querySelectorAll('.ec,.eh').forEach(e => e.remove());
    edges.forEach((ed, i) => {
        const fromEl = document.getElementById(ed.fp);
        const toEl = document.getElementById(ed.tp);
        if (!fromEl || !toEl) return;
        const p1 = worldPos(fromEl), p2 = worldPos(toEl);
        const d = makeBezier(p1, p2);
        // hit-test path (invisible, wide)
        const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.setAttribute('d', d); hit.setAttribute('class', 'eh');
        hit.setAttribute('data-edge-idx', i);
        hit.setAttribute('fill', 'none');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '15');
        hit.style.pointerEvents = 'stroke';
        hit.addEventListener('click', e => { e.stopPropagation(); selectEdge(i); });
        hit.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); selectEdge(i); showEdgeCtx(e.clientX, e.clientY); });
        svg.appendChild(hit);
        // visible path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d); path.setAttribute('fill', 'none');
        path.setAttribute('stroke', selectedEdgeIdx === i ? '#ffffff' : ed.color);
        path.setAttribute('stroke-width', selectedEdgeIdx === i ? '2' : '1.5');
        path.setAttribute('marker-end', `url(#${ed.marker})`);
        path.setAttribute('class', 'ec');
        if (selectedEdgeIdx === i) path.setAttribute('opacity', '0.9');
        svg.appendChild(path);
    });
    const ec = document.getElementById('edge-count');
    if (ec) ec.textContent = edges.length;
}

function selectEdge(idx) {
    selectedEdgeIdx = selectedEdgeIdx === idx ? null : idx;
    drawEdges();
}

function showEdgeCtx(x, y) {
    closeAllMenus();
    const m = document.getElementById('edge-ctx');
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.classList.add('open');
}

/* ═══════════════════════════════════════
   FREE NODE DRAG
═══════════════════════════════════════ */
function makeDraggable(nodeEl) {
    let dragging = false, startX, startY, startLeft, startTop;
    nodeEl.addEventListener('pointerdown', e => {
        if (e.target.closest('.port') || e.target.closest('.edit-field')) return;
        if (e.button !== 0) return;
        dragging = true;
        startX = e.clientX; startY = e.clientY;
        startLeft = parseInt(nodeEl.style.left) || 0;
        startTop = parseInt(nodeEl.style.top) || 0;
        nodeEl.classList.add('dragging');
        nodeEl.setPointerCapture(e.pointerId);
        e.stopPropagation();
    });
    nodeEl.addEventListener('pointermove', e => {
        if (!dragging) return;
        nodeEl.style.left = (startLeft + (e.clientX - startX) / scale) + 'px';
        nodeEl.style.top = (startTop + (e.clientY - startY) / scale) + 'px';
        drawEdges();
    });
    nodeEl.addEventListener('pointerup', e => {
        if (!dragging) return;
        dragging = false; nodeEl.classList.remove('dragging');
        saveToStorage();
        if (Math.abs(e.clientX - startX) < 4 && Math.abs(e.clientY - startY) < 4) {
            selNode(nodeEl.dataset.node);
        }
    });
}

function makeFreeMovable(el) {
    let dragging = false, startX, startY, startLeft, startTop;
    el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        dragging = true; startX = e.clientX; startY = e.clientY;
        startLeft = parseInt(el.style.left) || 0; startTop = parseInt(el.style.top) || 0;
        el.classList.add('dragging'); el.setPointerCapture(e.pointerId); e.stopPropagation();
    });
    el.addEventListener('pointermove', e => {
        if (!dragging) return;
        el.style.left = (startLeft + (e.clientX - startX) / scale) + 'px';
        el.style.top = (startTop + (e.clientY - startY) / scale) + 'px';
    });
    el.addEventListener('pointerup', () => { dragging = false; el.classList.remove('dragging'); saveToStorage(); });
}

document.querySelectorAll('.node').forEach(makeDraggable);
document.querySelectorAll('.notecard').forEach(makeFreeMovable);

/* ═══════════════════════════════════════
   RICH NOTEPAD EDITOR FUNCTIONS
═══════════════════════════════════════ */
function rpFmt(cmd) {
    const editor = document.getElementById('rp-editor');
    if (!editor) return;
    editor.focus();
    document.execCommand(cmd, false, null);
    const id = editor.dataset.nodeId;
    if (id) nodeNotes[id] = editor.innerHTML;
    saveToStorage();
    updateToolbarStatus();
}

function rpInsertBullet() {
    const editor = document.getElementById('rp-editor');
    if (!editor) return;
    editor.focus();
    document.execCommand('insertUnorderedList', false, null);
    const id = editor.dataset.nodeId;
    if (id) nodeNotes[id] = editor.innerHTML;
    saveToStorage();
    updateToolbarStatus();
}

function rpInsertCheck() {
    const editor = document.getElementById('rp-editor');
    if (!editor) return;
    editor.focus();
    const id = editor.dataset.nodeId;
    const checkDiv = document.createElement('div');
    checkDiv.className = 'rp-check';
    checkDiv.innerHTML = '<input type="checkbox"><span contenteditable="true">Task item</span>';
    // Toggle done class on check
    checkDiv.querySelector('input').addEventListener('change', function () {
        checkDiv.classList.toggle('done', this.checked);
        if (id) nodeNotes[id] = editor.innerHTML;
        saveToStorage();
    });
    // Insert at cursor or at end
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(checkDiv);
        // Move cursor after inserted element
        range.setStartAfter(checkDiv);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(checkDiv);
    }
    if (id) nodeNotes[id] = editor.innerHTML;
    saveToStorage();
}

function rpInsertCode(nodeId) {
    const editor = document.getElementById('rp-editor');
    if (!editor) return;
    editor.focus();
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-javascript';
    code.setAttribute('contenteditable', 'true');
    code.textContent = '// code here';
    pre.appendChild(code);
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(pre);
        range.setStartAfter(pre);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(pre);
    }
    try { hljs.highlightElement(code); } catch (e) { }
    // Re-highlight on code edit
    code.addEventListener('input', () => {
        // Remove hljs classes before re-highlighting
        code.removeAttribute('data-highlighted');
        code.className = 'language-javascript';
        try { hljs.highlightElement(code); } catch (e) { }
        if (nodeId) nodeNotes[nodeId] = editor.innerHTML;
        saveToStorage();
    });
    if (nodeId) nodeNotes[nodeId] = editor.innerHTML;
    saveToStorage();
}

function updateToolbarStatus() {
    const editor = document.getElementById('rp-editor');
    if (!editor) return;
    const bBold = document.getElementById('edt-bold');
    const bItalic = document.getElementById('edt-italic');
    const bBullet = document.getElementById('edt-bullet');

    if (bBold) bBold.classList.toggle('active', document.queryCommandState('bold'));
    if (bItalic) bItalic.classList.toggle('active', document.queryCommandState('italic'));
    if (bBullet) bBullet.classList.toggle('active', document.queryCommandState('insertUnorderedList'));
}

/* ═══════════════════════════════════════
   NODE SELECTION + DYNAMIC RIGHT PANEL
═══════════════════════════════════════ */
let selId = 'http';

function selNode(id) {
    document.querySelectorAll('.node').forEach(n => n.classList.remove('sel'));
    const el = document.getElementById('n-' + id);
    if (el) el.classList.add('sel');
    selId = id;
    renderDetailPanel(id);
}

function renderDetailPanel(id) {
    const el = document.getElementById('n-' + id);
    if (!el) return;

    // Ensure panel is open if we are selecting a node
    document.getElementById('fw-rp').classList.remove('collapsed');
    const toggleBtnIcon = document.querySelector('#rp-toggle-btn i');
    if (toggleBtnIcon) toggleBtnIcon.className = 'ti ti-chevron-right';

    const rp = document.getElementById('rp-body');
    if (!el || !rp) return;

    const nh = el.querySelector('.nh');
    const ntElem = el.querySelector('.nt');
    const ndTitle = ntElem?.textContent || id;
    const ndDesc = el.querySelector('.nd-desc')?.textContent || '';

    const borderColor = nh ? getComputedStyle(nh).borderLeftColor : '#1d9e75';
    const bHex = rgbToHex(borderColor) || '#1d9e75';

    // Gather tags
    const tagsEls = [...el.querySelectorAll('.nd-tags .tag')];
    const tagsHtml = tagsEls.length ? tagsEls.map((t, i) => `<div class="${t.className.replace('tag', '').trim()}" style="display:flex;align-items:center;gap:8px;padding:3px 10px;border-radius:10px;">
    <span style="font-size:10px;font-weight:600;font-family:var(--font-display);letter-spacing:0.05em;text-transform:uppercase;">${t.textContent}</span>
    <button onclick="removeTag('${id}',${i})" style="background:none;border:none;color:inherit;cursor:pointer;font-size:12px;padding:0;display:flex;align-items:center;opacity:0.7;margin-left:4px;"><i class="ti ti-x"></i></button>
  </div>`).join('') : '<span style="color:var(--text-dim);font-size:12px;font-style:italic;margin-right:8px;">No tags added</span>';

    // Gather field rows
    const fieldRows = [...el.querySelectorAll('.nr')].map(nr => {
        const k = nr.querySelector('.nk')?.textContent || '';
        const v = nr.querySelector('.nv')?.textContent || '';
        const c = nr.querySelector('.nv')?.style.color || '';
        return `<div class="rp-field-row">
      <span class="rp-fk">${k}</span>
      <span class="rp-fv" style="${c ? 'color:' + c : ''}" title="Double-click to edit">${v}</span>
    </div>`;
    }).join('');

    // Connections
    const inEdges = edges.filter(e => e.to === id);
    const outEdges = edges.filter(e => e.from === id);
    const inChips = inEdges.length ? inEdges.map(e => `<span class="conn-chip"><i class="ti ti-arrow-right" style="color:#5a6a88"></i>${e.from}</span>`).join('') : '<span style="color:var(--text-dim);font-size:9px">none</span>';
    const outChips = outEdges.length ? outEdges.map(e => `<span class="conn-chip"><i class="ti ti-arrow-right" style="color:var(--accent)"></i>${e.to}</span>`).join('') : '<span style="color:var(--text-dim);font-size:9px">none</span>';

    rp.innerHTML = `

    <div class="rp-sec">
      <input type="text" id="rp-edit-title" value="${ndTitle}" style="width:100%;font-size:30px;background:transparent;border:0;outline:none;color:var(--text-bright);font-family:var(--font-display);font-weight:600">
    </div>

    <div class="rp-sec">
      <textarea id="rp-edit-desc" style="width:100%;font-size:15px;background:transparent;border:0;outline:none;color:var(--text-bright);font-family:var(--font-display);min-height:40px;resize:none;line-height:1">${ndDesc}</textarea>
    </div>

    <div class="rp-sec">
      <div class="rp-editor-wrap">
        <div id="rp-editor" contenteditable="true" data-placeholder="Write notes here..."
          data-node-id="${id}"></div>
        <div class="rp-editor-toolbar" id="rp-toolbar">
          <button id="edt-bold" title="Bold (Ctrl+B)" onmousedown="event.preventDefault(); rpFmt('bold')"><strong>B</strong></button>
          <button id="edt-italic" title="Italic (Ctrl+I)" onmousedown="event.preventDefault(); rpFmt('italic')"><em>I</em></button>
          <div class="tb-sep"></div>
          <button id="edt-bullet" title="Bullet List" onmousedown="event.preventDefault(); rpInsertBullet()"><i class="ti ti-list"></i></button>
          <button id="edt-check" title="Checkbox" onmousedown="event.preventDefault(); rpInsertCheck()"><i class="ti ti-checkbox"></i></button>
          <div class="tb-sep"></div>
          <button id="edt-code" title="Code Block" onmousedown="event.preventDefault(); rpInsertCode('${id}')"><i class="ti ti-code"></i></button>
        </div>
      </div>
    </div>

    <div class="rp-sec">
      <div class="rp-lbl">Tags</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-start;align-items:center;">
        ${tagsHtml}
        <button id="add-tag-switch" onclick="document.getElementById('add-tag-switch').style.display='none'; document.getElementById('add-tag-container').style.display='flex'; document.getElementById('rp-new-tag').focus();" style="background:none;border:1px dashed var(--border);border-radius:10px;color:var(--text-dim);cursor:pointer;font-size:12px;height:24px;width:24px;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseover="this.style.color='var(--accent)';this.style.borderColor='var(--accent)'" onmouseout="this.style.color='var(--text-dim)';this.style.borderColor='var(--border)'"><i class="ti ti-plus"></i></button>
        <div id="add-tag-container" style="display:none;align-items:center;height:24px;">
          <input type="text" id="rp-new-tag" placeholder="Tag..." style="width:70px;background:none;border:none;outline:none;border-bottom:1px solid var(--accent);color:var(--text-bright);font-size:11px;font-family:var(--font-display);" onkeydown="if(event.key==='Enter') commitAddTag('${id}')" onblur="setTimeout(() => commitAddTag('${id}'), 100)">
        </div>
      </div>
    </div>

    <div class="rp-sec">
      <div class="rp-lbl">Accent Colour</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${['#1d9e75', '#7f77dd', '#ef9f27', '#d85a30', '#e24b4a', '#5dcaa5', '#60a5fa', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#94a3b8']
            .map(c => `<div class="swatch" data-rpswc style="width:22px;height:22px;background:${c};${c === bHex ? 'border-color:#fff8;transform:scale(1.15)' : ''}" data-col="${c}"></div>`).join('')}
      </div>
    </div>

    <div style="margin-top:auto;padding:24px">
      <button onclick="deleteNode('${id}')" style="width:100%;padding:10px;background:hsla(0,72%,51%,0.1);border:1px solid hsla(0,72%,51%,0.3);border-radius:10px;color:#fca5a5;font-size:13px;cursor:pointer;font-family:var(--font-display);font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.2s">
        <i class="ti ti-trash"></i> Delete Node
      </button>
    </div>`;

    // Bind title input
    const titleInput = rp.querySelector('#rp-edit-title');
    if (titleInput) {
        titleInput.addEventListener('input', () => {
            if (ntElem) ntElem.textContent = titleInput.value || ndTitle;
            rpTitles[id] = titleInput.value;
            saveToStorage();
        });
    }

    // Bind description textarea
    const descInput = rp.querySelector('#rp-edit-desc');
    if (descInput) {
        descInput.addEventListener('input', () => {
            const ndEl = document.querySelector(`#n-${id} .nd-desc`);
            if (ndEl) ndEl.textContent = descInput.value;
            saveToStorage();
        });
    }

    // Restore rich notes from per-node store
    const editor = rp.querySelector('#rp-editor');
    if (editor) {
        editor.innerHTML = nodeNotes[id] || '';
        // Re-highlight any existing code blocks
        editor.querySelectorAll('pre code').forEach(b => { try { hljs.highlightElement(b); } catch (e) { } });
        // Save on any input
        editor.addEventListener('input', () => {
            nodeNotes[id] = editor.innerHTML;
            saveToStorage();
            updateToolbarStatus();
        });
        editor.addEventListener('mouseup', updateToolbarStatus);
        editor.addEventListener('keyup', (e) => {
            updateToolbarStatus();
        });
        // Handle tab key to insert 2 spaces
        editor.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'b') { e.preventDefault(); rpFmt('bold'); }
            if (e.ctrlKey && e.key === 'i') { e.preventDefault(); rpFmt('italic'); }
            if (e.key === 'Tab') {
                e.preventDefault();
                document.execCommand('insertText', false, '  ');
            }
        });
    }

    // Bind colour swatches in right panel
    rp.querySelectorAll('[data-rpswc]').forEach(sw => {
        sw.addEventListener('click', () => {
            const nh2 = document.querySelector(`#n-${id} .nh`);
            if (nh2) nh2.style.borderLeftColor = sw.dataset.col;
            renderDetailPanel(id);
            saveToStorage();
        });
    });

    // Bind inline field editing in right panel
    rp.querySelectorAll('.rp-fv').forEach((fv, i) => {
        fv.addEventListener('dblclick', e => {
            e.stopPropagation();
            const orig = fv.textContent;
            const inp = document.createElement('input');
            inp.className = 'edit-field'; inp.value = orig; inp.style.width = '100%';
            if (fv.style.color) inp.style.color = fv.style.color;
            fv.textContent = ''; fv.appendChild(inp);
            inp.focus(); inp.select();
            // Also update mirrored span in the node
            const nodeNvs = document.querySelectorAll(`#n-${id} .nv`);
            const commit = () => {
                const v = inp.value.trim() || orig;
                fv.textContent = v;
                if (nodeNvs[i]) nodeNvs[i].textContent = v;
                saveToStorage();
            };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = orig; inp.blur(); } e.stopPropagation(); });
        });
    });
}

/* ═══════════════════════════════════════
   CLICK-TO-EDIT (dblclick .nv, .nt, .nd-desc)
═══════════════════════════════════════ */
function initEditableValues(root) {
    const qs = (sel) => {
        const elms = [...(root || document).querySelectorAll(sel)];
        if (root && root.matches && root.matches(sel)) elms.push(root);
        return elms;
    };

    qs('.nv').forEach(span => {
        if (span._editInit) return; span._editInit = true;
        span.title = 'Double-click to edit';
        span.addEventListener('dblclick', e => {
            e.stopPropagation();
            if (span.querySelector('input')) return;
            const orig = span.textContent;
            const inp = document.createElement('input');
            inp.className = 'edit-field'; inp.value = orig;
            if (span.style.color) inp.style.color = span.style.color;
            span.textContent = ''; span.appendChild(inp);
            inp.focus(); inp.select();
            const commit = () => { span.textContent = inp.value.trim() || orig; saveToStorage(); };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') inp.blur();
                if (e.key === 'Escape') { inp.value = orig; inp.blur(); }
                e.stopPropagation();
            });
        });
    });

    // Add double-click edit for .nt (heading)
    qs('.nt').forEach(span => {
        if (span._editInit) return; span._editInit = true;
        span.title = 'Double-click to edit';
        span.addEventListener('dblclick', e => {
            e.stopPropagation();
            if (span.querySelector('input')) return;
            const orig = span.textContent;
            const inp = document.createElement('input');
            inp.className = 'edit-field'; inp.value = orig;
            span.textContent = ''; span.appendChild(inp);
            inp.focus(); inp.select();
            const commit = () => { span.textContent = inp.value.trim() || orig; saveToStorage(); };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter') inp.blur();
                if (e.key === 'Escape') { inp.value = orig; inp.blur(); }
                e.stopPropagation();
            });
        });
    });

    // Add double-click edit for .nd-desc
    qs('.nd-desc').forEach(span => {
        if (span._editInit) return; span._editInit = true;
        span.title = 'Double-click to edit';
        span.addEventListener('dblclick', e => {
            e.stopPropagation();
            if (span.querySelector('textarea')) return;
            const orig = span.textContent;
            const inp = document.createElement('textarea');
            inp.className = 'edit-field'; inp.value = orig;
            inp.style.width = '140px'; inp.style.height = '50px'; inp.style.resize = 'none';
            span.textContent = ''; span.appendChild(inp);
            inp.focus(); inp.select();
            const commit = () => { span.textContent = inp.value.trim() || orig; saveToStorage(); };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', e => {
                if (e.key === 'Escape') { inp.value = orig; inp.blur(); }
            });
        });
    });

    // Add double-click edit for .notecard
    qs('.notecard').forEach(nc => {
        if (nc._editInit) return; nc._editInit = true;
        nc.title = 'Double-click to edit';
        nc.addEventListener('dblclick', e => {
            e.stopPropagation();
            const body = nc.querySelector('.nc-body') || nc;
            if (body.querySelector('textarea')) return;
            const orig = body.textContent;
            const inp = document.createElement('textarea');
            inp.className = 'edit-field';
            inp.value = orig;
            inp.style.width = '100%';
            // No more nc-head, so height can be almost full
            inp.style.height = Math.max(80, nc.offsetHeight - 20) + 'px';
            inp.style.resize = 'none';
            body.textContent = '';
            body.appendChild(inp);
            inp.focus();
            inp.select();
            const commit = () => {
                body.textContent = inp.value.trim() || orig;
                saveToStorage();
            };
            inp.addEventListener('blur', commit);
            inp.addEventListener('keydown', ev => {
                if (ev.key === 'Escape') {
                    inp.value = orig;
                    inp.blur();
                }
            });
        });
    });
}
initEditableValues();

/* ═══════════════════════════════════════
   INTERACTIVE EDGE DRAWING
═══════════════════════════════════════ */
const edgeColors = { trig: '#3d5272', http: '#7f77dd', 'if': '#ef9f27', code: '#1d9e75', err: '#e24b4a' };
const edgeMarkers = { trig: 'a-def', http: 'a-pur', 'if': 'a-amb', code: 'a-grn', err: 'a-cor' };
let connectState = null, previewPath = null;

function bindAllPorts(root) {
    (root || document).querySelectorAll('.port').forEach(portEl => {
        if (portEl._connInit) return; portEl._connInit = true;
        portEl.addEventListener('pointerdown', e => {
            e.stopPropagation(); e.preventDefault();
            connectState = { fromPort: portEl, fromId: portEl.dataset.node };
            portEl.classList.add('connecting');
            previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            previewPath.setAttribute('fill', 'none'); previewPath.setAttribute('stroke', '#1d9e75');
            previewPath.setAttribute('stroke-width', '1.5'); previewPath.setAttribute('stroke-dasharray', '6 3');
            previewPath.setAttribute('marker-end', 'url(#a-prev)');
            previewPath.classList.add('preview-edge'); svg.appendChild(previewPath);
            canvas.setPointerCapture(e.pointerId);
        });
    });
}
bindAllPorts();

canvas.addEventListener('pointermove', e => {
    if (!connectState || !previewPath) return;
    const wr = world.getBoundingClientRect();
    const p1 = worldPos(connectState.fromPort);
    const mx = (e.clientX - wr.left) / scale, my = (e.clientY - wr.top) / scale;
    previewPath.setAttribute('d', makeBezier(p1, { x: mx, y: my }));
    document.querySelectorAll('.port').forEach(pi => {
        const r = pi.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        pi.classList.toggle('drop-target', Math.sqrt(dx * dx + dy * dy) < 20);
    });
});

canvas.addEventListener('pointerup', e => {
    if (!connectState) return;
    let landed = null;
    document.querySelectorAll('.port').forEach(pi => {
        pi.classList.remove('drop-target');
        const r = pi.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        if (Math.sqrt(dx * dx + dy * dy) < 20) landed = pi;
    });
    if (landed && landed.dataset.node !== connectState.fromId) {
        const fp = connectState.fromPort.dataset.port, tp = landed.dataset.port;
        if (!edges.some(ed => ed.fp === fp && ed.tp === tp)) {
            const fn = connectState.fromId;
            edges.push({
                from: fn, fp, to: landed.dataset.node, tp,
                color: edgeColors[fn] || '#5a6a88', marker: edgeMarkers[fn] || 'a-def'
            });
            saveToStorage();
        }
    }
    connectState.fromPort.classList.remove('connecting');
    if (previewPath) { previewPath.remove(); previewPath = null; }
    connectState = null; drawEdges();
});

/* ═══════════════════════════════════════
   NODE RIGHT-CLICK CONTEXT MENU
═══════════════════════════════════════ */
const SWATCHES = [
    '#1d9e75', '#7f77dd', '#ef9f27', '#d85a30',
    '#e24b4a', '#5dcaa5', '#60a5fa', '#f472b6',
    '#a78bfa', '#34d399', '#fb923c', '#94a3b8'
];

// Build colour swatches once
const swatchRow = document.getElementById('ctx-colours');
SWATCHES.forEach(col => {
    const sw = document.createElement('div');
    sw.className = 'swatch'; sw.style.background = col; sw.dataset.col = col;
    sw.addEventListener('click', () => {
        if (!ctxTargetNodeId) return;
        const nh = document.querySelector(`#n-${ctxTargetNodeId} .nh`);
        if (nh) nh.style.borderLeftColor = col;
        // update active swatch
        swatchRow.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
    });
    swatchRow.appendChild(sw);
});

function bindNodeContextMenu(nodeEl) {
    if (nodeEl._ctxInit) return; nodeEl._ctxInit = true;
    nodeEl.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        ctxTargetNodeId = nodeEl.dataset.node;
        selNode(ctxTargetNodeId);
        // mark active swatch
        const nh = nodeEl.querySelector('.nh');
        const cur = (nh && getComputedStyle(nh).borderLeftColor) || '';
        swatchRow.querySelectorAll('.swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.col === rgbToHex(cur));
        });
        closeAllMenus();
        const m = document.getElementById('node-ctx');
        m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
        m.classList.add('open');
    });
    // Also bind context menu to nt and nd-desc
    const nt = nodeEl.querySelector('.nt');
    const ndDesc = nodeEl.querySelector('.nd-desc');
    if (nt) {
        nt.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            nodeEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
        });
    }
    if (ndDesc) {
        ndDesc.addEventListener('contextmenu', e => {
            e.preventDefault(); e.stopPropagation();
            nodeEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
        });
    }
}
function bindNoteContextMenu(el) {
    el.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        closeAllMenus();
        const m = document.getElementById('note-ctx');
        m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
        m.classList.add('open');
        document.getElementById('ctx-del-note').onclick = () => {
            showModal({
                title: 'Delete Note?',
                message: 'Are you sure you want to remove this notecard? This action cannot be undone.',
                onConfirm: () => {
                    el.remove();
                }
            });
            closeAllMenus();
        };
    });
}

document.querySelectorAll('.node').forEach(bindNodeContextMenu);
document.querySelectorAll('.notecard').forEach(bindNoteContextMenu);

// Rename action
document.getElementById('ctx-rename').addEventListener('click', () => {
    closeAllMenus();
    if (!ctxTargetNodeId) return;
    const nt = document.querySelector(`#n-${ctxTargetNodeId} .nt`);
    if (!nt) return;
    const orig = nt.textContent;
    const inp = document.createElement('input');
    inp.className = 'edit-field'; inp.value = orig;
    inp.style.width = '120px'; inp.style.fontSize = '11px';
    nt.textContent = ''; nt.appendChild(inp);
    inp.focus(); inp.select();
    const commit = () => { const v = inp.value.trim() || orig; nt.textContent = v; rpTitles[ctxTargetNodeId] = v; };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = orig; inp.blur(); } e.stopPropagation(); });
});

// Edit description action
document.getElementById('ctx-edit-desc').addEventListener('click', () => {
    closeAllMenus();
    if (!ctxTargetNodeId) return;
    const nd = document.querySelector(`#n-${ctxTargetNodeId} .nd-desc`);
    if (!nd) return;
    const orig = nd.textContent;
    const inp = document.createElement('textarea');
    inp.className = 'edit-field'; inp.value = orig;
    inp.style.width = '140px'; inp.style.fontSize = '10px'; inp.style.height = '60px';
    inp.style.resize = 'none'; inp.style.fontFamily = 'var(--font-mono)';
    nd.textContent = ''; nd.appendChild(inp);
    inp.focus(); inp.select();
    const commit = () => { const v = inp.value.trim() || orig; nd.textContent = v; };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') { inp.value = orig; inp.blur(); } });
});

// Edit fields — put first .nv into inline edit
document.getElementById('ctx-edit-fields')?.addEventListener('click', () => {
    closeAllMenus();
    if (!ctxTargetNodeId) return;
    const nv = document.querySelector(`#n-${ctxTargetNodeId} .nv`);
    if (nv) nv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
});

// Delete card
document.getElementById('ctx-del-node').addEventListener('click', () => {
    showModal({
        title: 'Delete Card?',
        message: 'Are you sure you want to remove this node and all its connections?',
        onConfirm: () => {
            deleteNode(ctxTargetNodeId);
        }
    });
    closeAllMenus();
});

// Delete edge from edge ctx
document.getElementById('ctx-del-edge').addEventListener('click', () => {
    if (selectedEdgeIdx === null) return;
    showModal({
        title: 'Remove Connection?',
        message: 'Are you sure you want to delete this connection?',
        onConfirm: () => {
            edges.splice(selectedEdgeIdx, 1);
            selectedEdgeIdx = null;
            drawEdges();
        }
    });
    closeAllMenus();
});

/* ═══════════════════════════════════════
   CANVAS RIGHT-CLICK — ADD NODE
═══════════════════════════════════════ */
let canvasCtxPos = { x: 0, y: 0 };
canvas.addEventListener('contextmenu', e => {
    if (e.target.closest('.node') || e.target.closest('.notecard') || e.target.closest('.ctx-menu')) return;
    e.preventDefault();
    closeAllMenus();
    // Store world coords for placement
    const r = world.getBoundingClientRect();
    canvasCtxPos = { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    const m = document.getElementById('canvas-ctx');
    m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
    m.classList.add('open');
});

const NODE_TEMPLATES = {
    default: { label: 'Heading', desc: 'Description', badge: 'node', icon: 'ti-plus', color: '#1d9e75', fields: [], tags: [] },
};

document.querySelectorAll('#canvas-ctx [data-add]').forEach(item => {
    item.addEventListener('click', () => {
        if (!activeProjectId) {
            showModal({
                title: 'Project Required',
                message: 'You need to create a project in the sidebar before adding nodes to the canvas.',
            });
            closeAllMenus();
            return;
        }
        const type = item.dataset.add;
        closeAllMenus();
        if (type === 'note') { addNotecard(canvasCtxPos.x, canvasCtxPos.y); return; }
        const tpl = NODE_TEMPLATES[type]; if (!tpl) return;
        addNode(type, tpl, canvasCtxPos.x, canvasCtxPos.y);
    });
});

function addNode(type, tpl, wx, wy) {
    const id = 'u' + (nodeCounter++);
    const el = document.createElement('div');
    el.className = 'node'; el.id = 'n-' + id; el.dataset.node = id;
    el.style.left = wx + 'px'; el.style.top = wy + 'px';
    const fields = tpl.fields.map(f => `<div class="nr"><span class="nk">${f.k}</span><span class="nv">${f.v}</span></div>`).join('');
    const tagsHtml = tpl.tags.map((tag, i) => {
        const tagClasses = {
            'active': 't-teal', '200 OK': 't-purp', '48 items': 't-teal', 'transform': 't-cor', 'mapped': 't-teal'
        }[tag] || 't-amb';
        return `<span class="tag ${tagClasses}" data-tag-idx="${i}">${tag}</span>`;
    }).join('');

    el.innerHTML = `
    <div class="port port-i" id="pi-${id}" data-port="pi-${id}" data-type="in" data-node="${id}"></div>
    <div class="port port-o" id="po-${id}" data-port="po-${id}" data-type="out" data-node="${id}"></div>
    <div class="nh" style="border-left:4px solid ${tpl.color}">
      <i class="ti ${tpl.icon}" style="font-size:16px;color:${tpl.color}"></i>
      <span class="nt">${tpl.label}</span>

    </div>
    <div class="nb">
      <div class="nd-desc">${tpl.desc}</div>
      <div class="nd-tags">${tagsHtml}</div>
      <div>${fields}</div>
    </div>`;
    world.appendChild(el);
    rpTitles[id] = tpl.label;
    makeDraggable(el);
    bindNodeContextMenu(el);
    bindAllPorts(el);
    initEditableValues(el);
    updateNodeCount();
    selNode(id);
    drawEdges();
    saveToStorage();
}

function addNotecard(wx, wy) {
    const id = 'nc-' + Date.now();
    const el = document.createElement('div');
    el.className = 'notecard'; el.id = id;
    el.style.left = wx + 'px'; el.style.top = wy + 'px';
    el.innerHTML = `<div class="nc-body"> </div>`; // No more nc-head
    world.appendChild(el);
    makeFreeMovable(el);
    bindNoteContextMenu(el);
    initEditableValues(el);
    saveToStorage();
}

/* ═══════════════════════════════════════
   TAG MANAGEMENT
═══════════════════════════════════════ */
window.commitAddTag = function (id) {
    const inp = document.getElementById('rp-new-tag');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) {
        renderDetailPanel(id);
        return;
    }

    const tagEl = document.querySelector(`#n-${id} .nd-tags`);
    if (!tagEl) return;

    const tagDiv = document.createElement('span');
    tagDiv.className = 'tag t-amb';
    tagDiv.textContent = val;
    tagDiv.dataset.tagIdx = tagEl.children.length;
    tagEl.appendChild(tagDiv);

    renderDetailPanel(id);
};

function removeTag(id, idx) {
    const tagEl = document.querySelector(`#n-${id} .nd-tags`);
    if (!tagEl) return;
    const tags = [...tagEl.querySelectorAll('.tag')];
    if (tags[idx]) tags[idx].remove();
    renderDetailPanel(id);
}

/* ═══════════════════════════════════════
   DELETE (node + edges, select+Del key)
═══════════════════════════════════════ */
function deleteNode(id) {
    // Remove all edges connected to this node
    for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i].from === id || edges[i].to === id) edges.splice(i, 1);
    }
    if (selectedEdgeIdx !== null && selectedEdgeIdx >= edges.length) selectedEdgeIdx = null;
    const el = document.getElementById('n-' + id);
    if (el) el.remove();
    if (selId === id) selId = null;
    updateNodeCount(); drawEdges();
}


function updateNodeCount() {
    const nc = document.getElementById('node-count');
    const count = document.querySelectorAll('.node').length;
    if (nc) nc.textContent = count;

    if (activeProjectId) {
        const p = PROJECTS.find(x => x.id === activeProjectId);
        if (p) {
            p.nodes = count;
            p.modified = 'just now';
            renderProjects();
        }
    }

    const emptyPlaceholder = document.getElementById('canvas-empty');
    if (emptyPlaceholder) emptyPlaceholder.style.display = count > 0 ? 'none' : 'flex';
}

/* ═══════════════════════════════════════
   CLOSE ALL MENUS
═══════════════════════════════════════ */
function closeAllMenus() {
    document.querySelectorAll('.ctx-menu').forEach(m => m.classList.remove('open'));
}
document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.ctx-menu')) closeAllMenus();
});

/* ═══════════════════════════════════════
   HELPER — rgb string → hex
═══════════════════════════════════════ */
function rgbToHex(rgb) {
    const m = rgb.match(/\d+/g); if (!m || m.length < 3) return '';
    return '#' + [m[0], m[1], m[2]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
}


/* FULL SCREEN */
document.getElementById('fs-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
    else document.exitFullscreen();
});

/* CLICK on empty canvas deselects edge */
canvas.addEventListener('click', e => {
    if (!e.target.closest('.node') && !e.target.closest('.ctx-menu')) {
        selectedEdgeIdx = null; drawEdges();
    }
});

document.getElementById('compact-btn').addEventListener('click', function () {
    canvas.classList.toggle('compact');
    if (canvas.classList.contains('compact')) {
        this.innerHTML = '<i class="ti ti-layout-bottombar" style="font-size:12px" aria-hidden="true"></i> Expand';
        this.style.color = 'var(--accent)';
    } else {
        this.innerHTML = '<i class="ti ti-layout-align-top" style="font-size:12px" aria-hidden="true"></i> Compact';
        this.style.color = '';
    }
    setTimeout(drawEdges, 50); // allow layout shift
});

document.getElementById('rp-toggle-btn').addEventListener('click', function () {
    const rp = document.getElementById('fw-rp');
    const isCollapsed = rp.classList.toggle('collapsed');

    const icon = this.querySelector('i');
    if (isCollapsed) {
        icon.className = 'ti ti-chevron-left';
    } else {
        icon.className = 'ti ti-chevron-right';
    }
    setTimeout(drawEdges, 210);
});

/* ─ Panel resize drag ─ */
(function () {
    const rp = document.getElementById('fw-rp');
    const resizer = document.getElementById('rp-resizer');
    const MIN_W = 200, MAX_W = 640, DEFAULT_W = 320;
    let dragging = false, startX = 0, startW = 0;

    resizer.addEventListener('pointerdown', e => {
        if (rp.classList.contains('collapsed')) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startW = rp.offsetWidth;
        resizer.classList.add('dragging');
        resizer.setPointerCapture(e.pointerId);
    });

    resizer.addEventListener('pointermove', e => {
        if (!dragging) return;
        const delta = startX - e.clientX; // dragging left = bigger panel
        const newW = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
        rp.style.width = newW + 'px';
        drawEdges();
    });

    resizer.addEventListener('pointerup', () => {
        dragging = false;
        resizer.classList.remove('dragging');
    });

    resizer.addEventListener('dblclick', () => {
        rp.style.width = DEFAULT_W + 'px';
        drawEdges();
    });
})();

/* ── Modal Logic ── */
function showModal({ title, message, prompt = false, defaultValue = '', onConfirm, onCancel }) {
    const overlay = document.getElementById('modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const inputEl = document.getElementById('modal-input');
    const okBtn = document.getElementById('modal-ok');
    const cancelBtn = document.getElementById('modal-cancel');

    titleEl.textContent = title;
    bodyEl.textContent = message;
    inputEl.style.display = prompt ? 'block' : 'none';
    inputEl.value = defaultValue;
    cancelBtn.style.display = (prompt || onCancel) ? 'inline-block' : 'none';

    overlay.classList.add('open');
    if (prompt) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);

    const close = () => {
        overlay.classList.remove('open');
        // Clean up listeners
        okBtn.onclick = null;
        cancelBtn.onclick = null;
    };

    okBtn.onclick = () => {
        if (onConfirm) onConfirm(prompt ? inputEl.value : true);
        close();
    };
    cancelBtn.onclick = () => {
        if (onCancel) onCancel();
        close();
    };
}

// Project context menu actions
document.getElementById('ctx-proj-export').addEventListener('click', () => {
    closeAllMenus();
    if (!ctxTargetProjectId) return;
    saveToStorage(); // ensure active project is synced first

    const p = PROJECTS.find(x => x.id === ctxTargetProjectId);
    if (!p) return;

    const cs = p.canvasState || {
        nodes: [], notecards: [], edges: [], nodeNotes: {}, rpTitles: {}, nodeCounter: 10
    };

    const exportData = {
        version: 1,
        project: { ...p, canvasState: undefined }, // export meta without redundancy
        ...cs
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (p.name || 'project').replace(/\s+/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('ctx-proj-rename').addEventListener('click', () => {
    closeAllMenus();
    if (!ctxTargetProjectId) return;
    const p = PROJECTS.find(x => x.id === ctxTargetProjectId);
    if (!p) return;
    showModal({
        title: 'Rename Project',
        message: 'Enter a new name for the project:',
        prompt: true,
        defaultValue: p.name,
        onConfirm: (newName) => {
            if (newName) {
                p.name = newName;
                renderProjects();
                if (activeProjectId === p.id) {
                    const fn = document.querySelector('.fw-status span:last-child');
                    if (fn) fn.textContent = p.name + '.json';
                }
                saveToStorage();
            }
        }
    });
});

document.getElementById('ctx-proj-del').addEventListener('click', () => {
    closeAllMenus();
    if (!ctxTargetProjectId) return;
    const idx = PROJECTS.findIndex(x => x.id === ctxTargetProjectId);
    if (idx === -1) return;
    showModal({
        title: 'Delete Project?',
        message: 'Are you sure you want to delete this project? All associated nodes and notes will be lost.',
        onConfirm: () => {
            const wasActive = (activeProjectId === ctxTargetProjectId);
            PROJECTS.splice(idx, 1);
            if (wasActive) {
                activeProjectId = null;
                // Clear canvas
                document.querySelectorAll('.node, .notecard').forEach(el => el.remove());
                edges.length = 0;
                Object.keys(nodeNotes).forEach(k => delete nodeNotes[k]);
                updateNodeCount();
                drawEdges();
            }
            renderProjects();
            saveToStorage();
        }
    });
});

/* INIT */
window.addEventListener('load', () => {
    const loaded = loadFromStorage();
    if (!loaded) {
        renderProjects();
    }
    applyTransform();
    drawEdges();
    updateNodeCount();

    // Hide loader
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        const hasShown = sessionStorage.getItem('loader-shown');
        if (hasShown) {
            // Already shown in this session, hide immediately
            loader.style.display = 'none';
        } else {
            // First time, show animation and set flag
            setTimeout(() => {
                loader.classList.add('loader-hidden');
                sessionStorage.setItem('loader-shown', 'true');
            }, 3000);
        }
    }
});

// Add periodic save for safety
setInterval(saveToStorage, 5000);

window.addEventListener('resize', drawEdges);
setTimeout(() => { applyTransform(); drawEdges(); }, 80);