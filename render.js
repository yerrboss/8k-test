const { ipcRenderer } = require("electron");

/* ==========================================================================
   GLOBAL STATE
   ========================================================================== */
let activeElement = null;
let highestZ = 1000;
let warpActive = false; 

// Diagnostic Heartbeat
console.log("Salrayworks VaDA Engine: Booting...");

document.addEventListener("DOMContentLoaded", () => {
    console.log("Salrayworks Core // Interaction Engine Online");

    try {
        initSystemWindowControls();
        initImportEngine();
        initCanvasResizers();
        initCustomDropdowns();
        initTemplateSelection();
        initGlobalContextHandlers();
        
        // CRITICAL FIX: These must exist or the script crashes here!
        initMediaCollapse(); 
        console.log("Initialization Complete. Engine Ready.");
    } catch (err) {
        console.error("CRITICAL BOOT ERROR:", err);
    }

    // Navigation Bindings
    ["backBtn", "exitInspBtn"].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = goHome;
    });

    const lockToggle = document.getElementById("lockToggle");
    if (lockToggle) {
        lockToggle.onchange = (e) => window.toggleElementLock(e.target.checked);
    }

    goHome();
});

/* ==========================================================================
   1. CONTEXT MENU & ACTION ENGINE
   ========================================================================== */

function initGlobalContextHandlers() {
    const ctxMenu = document.getElementById("contextMenu");
    if (!ctxMenu) return;

    document.addEventListener("contextmenu", (e) => {
        const target = e.target.closest(".video-layer");
        if (target) {
            e.preventDefault();
            selectElement(target);

            const isLocked = target.dataset.locked === "true";
            const isMainCanvas = target.id === "activeSurface";

            const lockItem = document.getElementById("ctxLock");
            const unlockItem = document.getElementById("ctxUnlock");
            if (lockItem) lockItem.style.display = isLocked ? "none" : "block";
            if (unlockItem) unlockItem.style.display = isLocked ? "block" : "none";

            const frontItem = document.getElementById("ctxFront");
            const backItem = document.getElementById("ctxBack");
            const deleteItem = document.getElementById("ctxDelete");

            if (isMainCanvas) {
                if (frontItem) frontItem.style.display = "none";
                if (backItem) backItem.style.display = "none";
                if (deleteItem) deleteItem.style.display = "none";
            } else {
                if (frontItem) frontItem.style.display = "block";
                if (backItem) backItem.style.display = "block";
                if (deleteItem) deleteItem.style.display = "block";
            }

            ctxMenu.style.display = "block";
            ctxMenu.style.left = `${e.clientX}px`;
            ctxMenu.style.top = `${e.clientY}px`;
        } else {
            ctxMenu.style.display = "none";
        }
    });

    ctxMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => {
        ctxMenu.style.display = "none";
    });

    const bindMenuBtn = (id, func) => {
        const el = document.getElementById(id);
        if (el)
            el.onclick = () => {
                func();
                ctxMenu.style.display = "none";
            };
    };

    bindMenuBtn("ctxFront", window.bringToFront);
    bindMenuBtn("ctxBack", window.sendToBack);
    bindMenuBtn("ctxDelete", window.deleteSelected);
    bindMenuBtn("ctxLock", () => window.toggleElementLock(true));
    bindMenuBtn("ctxUnlock", () => window.toggleElementLock(false));
    bindMenuBtn("ctxReset", window.resetTransform);
}

/* ==========================================================================
   2. GLOBAL EXPORTED ACTIONS
   ========================================================================== */

window.bringToFront = () => {
    if (activeElement && activeElement.id !== "activeSurface") {
        highestZ++;
        activeElement.style.zIndex = highestZ;
    }
};

window.sendToBack = () => {
    if (activeElement && activeElement.id !== "activeSurface") {
        activeElement.style.zIndex = 101;
    }
};

window.deleteSelected = () => {
    if (activeElement && activeElement.id !== "activeSurface") {
        if (activeElement.dataset.locked === "true") return;
        activeElement.remove();
        activeElement = null;
        if (document.getElementById("inspectorPanel")) document.getElementById("inspectorPanel").style.display = "none";
        if (document.getElementById("architectPanel")) document.getElementById("architectPanel").style.display = "block";
        if (document.getElementById("lockSection")) document.getElementById("lockSection").style.display = "none";
    }
};

window.toggleElementLock = (shouldLock) => {
    if (!activeElement) return;
    activeElement.dataset.locked = shouldLock ? "true" : "false";
    if (shouldLock) {
        activeElement.classList.add("is-locked");
        activeElement.style.borderColor = "#ff4444";
    } else {
        activeElement.classList.remove("is-locked");
        activeElement.style.borderColor = "var(--vada-accent)";
    }
    const lockToggle = document.getElementById("lockToggle");
    if (lockToggle) lockToggle.checked = shouldLock;
};

window.resetTransform = () => {
    if (!activeElement || activeElement.dataset.locked === "true") return;
    activeElement.style.transform = "rotate(0deg)";
    activeElement.dataset.rotation = "0";
    if (activeElement.id === "activeSurface") {
        activeElement.style.width = "75%";
        activeElement.style.left = "100px";
        activeElement.style.top = "100px";
    } else {
        activeElement.style.width = "480px";
        activeElement.style.height = "270px";
    }
    syncInspector();
};

/* ==========================================================================
   3. TRANSFORM ENGINE (Rotation-Aware & Pivot-Stable)
   ========================================================================== */

function spawnSourceOnCanvas(name, dropX = 150, dropY = 150) {
    const stage = document.querySelector(".canvas-stage");
    if (!stage) return;

    const layer = document.createElement("div");
    layer.className = "video-layer moveable-source";
    layer.dataset.locked = "false";
    layer.dataset.rotation = "0";

    highestZ++;

    layer.style.cssText = `
        width: 480px; height: 270px; left: ${dropX}px; top: ${dropY}px; 
        position: absolute; z-index: ${highestZ};
        border: 2px solid var(--vada-accent);
        background: rgba(0, 240, 255, 0.05);
        transform: rotate(0deg);
    `;

    layer.innerHTML = `
        <div class="layer-info">${name}</div>
        <div class="transform-nodes">
            <div class="rotate-node"></div>
            <div class="node nw"></div><div class="node n"></div><div class="node ne"></div>
            <div class="node w"></div><div class="node e"></div>
            <div class="node sw"></div><div class="node s"></div><div class="node se"></div>
        </div>
    `;

    stage.appendChild(layer);
    makeTransformable(layer);
    selectElement(layer);
}

function makeTransformable(el) {
    let isResizing = false, isMoving = false, isRotating = false;
    let currentHandle = null;

    el.onmousedown = (e) => {
        // Prevent layer movement if we are warping specific points
        if (warpActive) return;

        selectElement(el);
        if (el.dataset.locked === "true") return;

        const handle = e.target.closest(".node");
        const rotateHandle = e.target.closest(".rotate-node");

        if (rotateHandle) isRotating = true;
        else if (handle) {
            isResizing = true;
            currentHandle = handle.classList[1];
        } else isMoving = true;

        let startX = e.clientX;
        let startY = e.clientY;
        let initialWidth = el.offsetWidth;
        let initialHeight = el.offsetHeight;
        let initialLeft = el.offsetLeft;
        let initialTop = el.offsetTop;

        const startRotation = parseFloat(el.dataset.rotation) || 0;
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const startMouseAngle = Math.atan2(startY - centerY, startX - centerX);

        const rad = startRotation * (Math.PI / 180);
        const initialCenterX = initialLeft + initialWidth / 2;
        const initialCenterY = initialTop + initialHeight / 2;

        let pivotLocalX = 0, pivotLocalY = 0;
        if (currentHandle) {
            if (currentHandle.includes("e")) pivotLocalX = -initialWidth / 2;
            else if (currentHandle.includes("w")) pivotLocalX = initialWidth / 2;
            if (currentHandle.includes("s")) pivotLocalY = -initialHeight / 2;
            else if (currentHandle.includes("n")) pivotLocalY = initialHeight / 2;
        }

        const worldPivotX = initialCenterX + (pivotLocalX * Math.cos(rad) - pivotLocalY * Math.sin(rad));
        const worldPivotY = initialCenterY + (pivotLocalX * Math.sin(rad) + pivotLocalY * Math.cos(rad));

        const onMouseMove = (moveEvent) => {
            moveEvent.preventDefault();
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            if (isMoving) {
                el.style.left = `${initialLeft + dx}px`;
                el.style.top = `${initialTop + dy}px`;
            }

            if (isResizing) {
                const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
                const localDy = -dx * Math.sin(rad) + dy * Math.cos(rad);
                let newW = Math.max(20, initialWidth + (currentHandle.includes("w") ? -localDx : localDx));
                let newH = Math.max(20, initialHeight + (currentHandle.includes("n") ? -localDy : localDy));

                let newPivotLocalX = currentHandle.includes("e") ? -newW / 2 : (currentHandle.includes("w") ? newW / 2 : 0);
                let newPivotLocalY = currentHandle.includes("s") ? -newH / 2 : (currentHandle.includes("n") ? newH / 2 : 0);

                const newCenterX = worldPivotX - (newPivotLocalX * Math.cos(rad) - newPivotLocalY * Math.sin(rad));
                const newCenterY = worldPivotY - (newPivotLocalX * Math.sin(rad) + newPivotLocalY * Math.cos(rad));

                el.style.width = `${newW}px`;
                el.style.height = `${newH}px`;
                el.style.left = `${newCenterX - newW / 2}px`;
                el.style.top = `${newCenterY - newH / 2}px`;
            }

            if (isRotating) {
                const currentMouseAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
                el.dataset.rotation = startRotation + (currentMouseAngle - startMouseAngle) * (180 / Math.PI);
                el.style.transform = `rotate(${el.dataset.rotation}deg)`;
            }
            syncInspector();
        };

        const onMouseUp = () => {
            isResizing = isMoving = isRotating = false;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };
}

/* ==========================================================================
   4. UI NAVIGATION & SYNC
   ========================================================================== */

function enterWorkspace(name, w, h) {
    document.getElementById("galleryView").style.display = "none";
    document.getElementById("workspaceView").style.display = "flex";
    document.getElementById("architectPanel").style.display = "none";
    document.getElementById("inspectorPanel").style.display = "block";
    document.getElementById("lockSection").style.display = "block";
    document.getElementById("resetSection").style.display = "block";

    document.getElementById("activeTaskName").innerText = "ACTIVE: " + name.toUpperCase();
    document.getElementById("liveRes").innerText = `${w} x ${h}`;

    const surface = document.getElementById("activeSurface");
    if (surface) {
        surface.style.width = "75%";
        surface.style.aspectRatio = `${w}/${h}`;
        surface.style.left = "100px";
        surface.style.top = "100px";
        selectElement(surface);
        makeTransformable(surface);
    }
}

function goHome() {
    ["galleryView", "architectPanel"].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).style.display = "block";
    });
    ["workspaceView", "inspectorPanel", "lockSection", "resetSection"].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).style.display = "none";
    });
    warpActive = false;
}

function selectElement(el) {
    if (activeElement) {
        activeElement.classList.remove("active");
        removeWarpPoints(activeElement);
    }
    activeElement = el;
    activeElement.classList.add("active");
    warpActive = false; 

    document.getElementById("architectPanel").style.display = "none";
    document.getElementById("inspectorPanel").style.display = "block";
    document.getElementById("lockSection").style.display = "block";

    if (document.getElementById("lockToggle")) 
        document.getElementById("lockToggle").checked = el.dataset.locked === "true";

    const title = document.getElementById("inspectorTitle");
    const info = el.querySelector(".layer-info");
    if (title && info) title.innerText = info.innerText;
    
    syncInspector();
}

function syncInspector() {
    if (!activeElement) return;
    const inputs = { posX: activeElement.offsetLeft, posY: activeElement.offsetTop };
    Object.keys(inputs).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = Math.round(inputs[id]);
    });
}

/* ==========================================================================
   5. SYSTEM MODULES
   ========================================================================== */

function initImportEngine() {
    const addBtn = document.querySelector(".btn-mini-add");
    const tray = document.getElementById("sourceTray");
    if (!addBtn || !tray) return;

    addBtn.onclick = (e) => {
        e.stopPropagation();
        tray.classList.toggle("open");
    };

    document.querySelectorAll(".tray-opt").forEach((opt) => {
        opt.onclick = async () => {
            const type = opt.dataset.type;
            if (type === "FILE") {
                const result = await ipcRenderer.invoke("open-file-dialog");
                if (result) addNewMediaToPool("FILE", result.split(/[\\/]/).pop());
            } else {
                addNewMediaToPool(type, `${type}_STREAM_${Math.floor(Math.random() * 100)}`);
            }
            tray.classList.remove("open");
        };
    });
}

function addNewMediaToPool(type, name) {
    const list = document.getElementById("mediaPoolList");
    if (!list) return;
    const item = document.createElement("div");
    item.className = "media-item";
    item.innerHTML = `<div class="media-thumb">${type}</div><div class="media-meta"><label>${name}</label><span>7680x4320</span></div>`;
    item.onclick = () => {
        document.querySelectorAll(".media-item").forEach(i => i.classList.remove("active"));
        item.classList.add("active");
        spawnSourceOnCanvas(name);
    };
    list.appendChild(item);
}

function initCanvasResizers() {
    const resizer = document.getElementById("canvasResizer");
    const deck = document.getElementById("bottomControlDeck");
    if (!resizer || !deck) return;

    resizer.onmousedown = () => {
        const onMove = (me) => {
            const h = window.innerHeight - me.clientY;
            if (h > 100 && h < window.innerHeight * 0.8) deck.style.height = h + "px";
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    };
}

function initCustomDropdowns() {
    const dropdown = document.getElementById("mappingDropdown");
    if (!dropdown) return;
    const selected = dropdown.querySelector(".dropdown-selected");
    selected.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle("open"); };
    dropdown.querySelectorAll(".option").forEach(opt => {
        opt.onclick = () => {
            selected.innerText = opt.innerText;
            dropdown.classList.remove("open");
        };
    });
}

function initTemplateSelection() {
    document.addEventListener("mousedown", (e) => {
        const card = e.target.closest(".template-card");
        if (!card || e.detail !== 2) return;
        const res = card.querySelector(".res").innerText.match(/\d+/g);
        enterWorkspace(card.querySelector(".type").innerText, res[0], res[1]);
    });
}

function initSystemWindowControls() {
    const btn = (id, cmd) => {
        const el = document.getElementById(id);
        if (el) el.onclick = () => ipcRenderer.send(cmd);
    };
    btn("minBtn", "window-minimize");
    btn("closeBtn", "window-close");
    btn("maxBtn", "window-maximize");
}

function initMediaCollapse() { console.log("Media Subsystem: Online"); }

/* ==========================================================================
   6. WARP ENGINE: FIGMA-STYLE CURVING
   ========================================================================== */

window.toggleWarpEditor = () => {
    console.log("VaDA Action: Toggle Warp Editor");
    if (!activeElement) return alert("Please select a video layer first.");

    warpActive = !warpActive;
    const btn = document.getElementById("warpToggleBtn");
    activeElement.classList.toggle("warp-mode", warpActive);
    
    if (warpActive) {
        if (btn) btn.innerText = "EXIT MESH EDITOR";
        activeElement.style.overflow = "visible"; 
        createWarpPoints(activeElement);
    } else {
        if (btn) btn.innerText = "ENABLE MESH EDITING";
        removeWarpPoints(activeElement);
    }
};

function createWarpPoints(el) {
    removeWarpPoints(el);
    const points = ["tl", "tr", "bl", "br"];
    points.forEach((pos) => {
        const dot = document.createElement("div");
        dot.className = `warp-dot ${pos}`;
        dot.dataset.x = dot.dataset.x || "0";
        dot.dataset.y = dot.dataset.y || "0";

        // Inject Figma-style handlebars for curving
        dot.innerHTML = `
            <div class="tangent t-left" data-x="0" data-y="0"></div>
            <div class="tangent t-right" data-x="0" data-y="0"></div>
        `;

        dot.onmousedown = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const target = e.target;
            const isTangent = target.classList.contains("tangent");

            let startX = e.clientX, startY = e.clientY;
            let baseOffsetX = parseFloat(target.dataset.x || 0);
            let baseOffsetY = parseFloat(target.dataset.y || 0);

            const onMouseMove = (mE) => {
                const totalX = baseOffsetX + (mE.clientX - startX);
                const totalY = baseOffsetY + (mE.clientY - startY);
                target.style.transform = `translate(${totalX}px, ${totalY}px)`;
                target.dataset.movingX = totalX; target.dataset.movingY = totalY;
                
                ipcRenderer.send(isTangent ? "vada-curve-update" : "vada-warp-update", {
                    targetId: el.id, point: pos, x: totalX, y: totalY, side: target.classList.contains("t-left") ? "L" : "R"
                });
            };

            const onMouseUp = () => {
                target.dataset.x = target.dataset.movingX || target.dataset.x;
                target.dataset.y = target.dataset.movingY || target.dataset.y;
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            };
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };
        el.appendChild(dot);
    });
}

function removeWarpPoints(el) {
    if (!el) return;
    el.style.overflow = "hidden";
    el.querySelectorAll(".warp-dot").forEach(d => d.remove());
}

/* ==========================================================================
   7. AUXILIARY TOOLS
   ========================================================================== */

window.toggleBgRemoval = (isEnabled) => {
    if (!activeElement) return;
    activeElement.classList.toggle("ai-bg-removing", isEnabled);
    ipcRenderer.send("vada-bg-segmentation", { target: activeElement.id, state: isEnabled });
};

window.hardResetWorkspace = () => {
    if (window.confirm("Purge all layers?")) {
        document.querySelectorAll(".moveable-source").forEach(el => el.remove());
        goHome();
    }
};

window.createCanvas = () => {
    const btn = document.querySelector(".btn-primary-action");
    if (btn) btn.innerText = "CANVAS ACTIVE ✓";
};

window.toggleScanner = () => { document.body.classList.toggle("scanning"); };
