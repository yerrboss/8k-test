// ==================================================
// Salrayworks VaDA Switcher - ELECTRON MAIN PROCESS
// ==================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Optional: Hot Reload for development
try {
    require('electron-reload')(__dirname, {
        electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
    });
} catch (e) {
    console.log("Salrayworks: Hot reload skipped (Production Mode).");
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        frame: false, // Frameless UI for custom branding
        backgroundColor: '#050213',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false, // CRITICAL: Keeps 8K processing active in background
            webgl: true,
            offscreen: false 
        }
    });

    mainWindow.loadFile('index.html');

    // --- WINDOW CONTROL IPC HANDLERS ---
    ipcMain.on('window-minimize', () => mainWindow.minimize());
    
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });

    ipcMain.on('window-close', () => mainWindow.close());

    // --- FILE SYSTEM HANDLERS (Media Selection) ---
    ipcMain.handle('open-file-dialog', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'SALRAYWORKS // SELECT SOURCE MEDIA',
            buttonLabel: 'Import to Bin',
            properties: ['openFile'],
            filters: [
                { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'prores'] },
                { name: 'Graphics', extensions: ['png', 'jpg', 'tga', 'tiff'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        
        return (!result.canceled && result.filePaths.length > 0) ? result.filePaths[0] : null;
    });

    /* ==========================================================================
        VA-DA CORE ENGINE HOOKS (GPU & AI BRIDGES)
        ========================================================================== */

    // 1. Warp Point Bridge (Main Corner Movement)
    ipcMain.on('vada-warp-update', (event, data) => {
        // console.log(`Warp -> ID: ${data.targetId} Point: ${data.point} X: ${data.x} Y: ${data.y}`);
        
        // DEVELOPER HOOK: 
        // Pass these coordinates to your C++ Node addon or GLSL Vertex Shader 
        // to handle Homographic Transformation (4-point corner pinning).
    });

    // 2. Curve/Spline Bridge (Tangent Handle Movement)
    ipcMain.on('vada-curve-update', (event, data) => {
        // console.log(`Curve -> ID: ${data.targetId} Point: ${data.point} Side: ${data.side} X: ${data.x} Y: ${data.y}`);

        // DEVELOPER HOOK:
        // Use these offsets to calculate Bézier/B-Spline weights.
        // This allows for non-linear deformation of the video texture.
    });

    // 3. AI Background Removal Bridge
    ipcMain.on('vada-bg-segmentation', (event, data) => {
        console.log(`VaDA AI -> Target: ${data.target} State: ${data.state ? 'ACTIVE' : 'IDLE'}`);
        
        // DEVELOPER HOOK:
        // Trigger your segmentation model (Mediapipe, TensorRT, or ONNX).
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});