// ==========================================
// 1. キャンバスの準備（スケーリング対応）
// ==========================================
const canvas = document.getElementById('waterSurface');
const ctx = canvas.getContext('2d');
const RENDER_SCALE = 0.5; 

function resizeCanvas() {
    canvas.width = window.innerWidth * RENDER_SCALE;
    canvas.height = window.innerHeight * RENDER_SCALE;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); 

// ==========================================
// 2. 音色設定（三線・蛇味線風チューニング）
// ==========================================
const masterLimiter = new Tone.Limiter(-6).toDestination();

// ★音階を全体的に1オクターブ高く（+12）設定：琉球音階
const RYUKYU_SCALE = [
    48, 52, 53, 55, 59, // C3, E3, F3, G3, B3
    60, 64, 65, 67, 71, // C4...
    72, 76, 77, 79, 83, // C5...
    84, 88, 89, 91, 95  // C6...
];

const highSynth = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 8,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 1.5 }
}).connect(masterLimiter);

const lowSynth = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: { type: "square" }, 
    envelope: { 
        attack: 0.005, decay: 0.3, sustain: 0.05, release: 1.0 
    }
}).connect(masterLimiter);

highSynth.volume.value = -18;
lowSynth.volume.value = -10;

// ==========================================
// 3. 波紋クラス
// ==========================================
class Ripple {
    constructor(x, y, speed, notes) {
        this.x = x; this.y = y; this.r = 0; this.speed = speed;
        this.hitFlags = [false, false, false, false];
        this.hitCount = 0;
        this.myNotes = notes;
    }

    update() {
        this.r += this.speed;
        const walls = [this.y, canvas.height - this.y, this.x, canvas.width - this.x];
        for (let i = 0; i < 4; i++) {
            if (this.r >= walls[i] && !this.hitFlags[i]) {
                if (this.hitCount < 4) {
                    const midi = this.myNotes[this.hitCount];
                    lowSynth.triggerAttackRelease(Tone.Frequency(midi, "midi"), "16n");
                    if (this.hitCount === 0) {
                        highSynth.triggerAttackRelease(Tone.Frequency(midi + 12, "midi"), "16n");
                    }
                    this.hitCount++;
                }
                this.hitFlags[i] = true;
            }
        }
    }

    draw(ctx) {
        const maxR = Math.sqrt(canvas.width**2 + canvas.height**2);
        let alpha = Math.max(0, 1 - (this.r / maxR));
        // ★鮮やかな背景に映える純白の波紋
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.stroke();
    }

    isDead() { return this.hitFlags.every(f => f) && this.r > Math.max(canvas.width, canvas.height); }
}

// ==========================================
// 4. 光の軌跡（しなやかな曲線）クラス
// ==========================================
class LightTrail {
    constructor() {
        this.points = [];
    }
    addPoint(x, y, time) {
        this.points.push({ x, y, time });
    }
    draw(ctx, currentTime) {
        // ★約2/3の長さ（660ms）でスッと消えるように
        this.points = this.points.filter(p => currentTime - p.time < 660);
        if (this.points.length < 2) return;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // ★軌跡を波紋より少し太くして滑らかさを強調
        ctx.lineWidth = 2.5; 

        for (let i = 1; i < this.points.length - 1; i++) {
            const p0 = this.points[i - 1];
            const p1 = this.points[i];
            const p2 = this.points[i + 1];

            const xc = (p1.x + p2.x) / 2;
            const yc = (p1.y + p2.y) / 2;

            const age = currentTime - p1.time;
            let alpha = Math.max(0, 1 - (age / 660));

            // ★Ryu-Ka の純白の軌跡
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`; 
            ctx.beginPath();

            if (i === 1) {
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
            } else {
                const prevXc = (p0.x + p1.x) / 2;
                const prevYc = (p0.y + p1.y) / 2;
                ctx.moveTo(prevXc, prevYc);
                ctx.quadraticCurveTo(p1.x, p1.y, xc, yc);
            }
            ctx.stroke();
        }
    }
    isDead() { return this.points.length === 0; }
}

// ==========================================
// 5. 操作系（マウス・タッチ ＆ 軌跡の記録）
// ==========================================
let ripples = [];
let lightTrails = []; 
let isAudioStarted = false;

const activePointers = new Map();
const pointerTrails = new Map(); 
const activeLightTrails = new Map(); 

function spawnRipple(x, y, isHighRes = true) {
    if (ripples.length > 25) ripples.shift();
    const yRatio = 1 - (y / canvas.height);
    const startIdx = Math.floor(yRatio * (RYUKYU_SCALE.length - 5));
    const currentNotes = RYUKYU_SCALE.slice(startIdx, startIdx + 5);

    lowSynth.triggerAttackRelease(Tone.Frequency(currentNotes[0], "midi"), "16n");
    if (isHighRes) {
        highSynth.triggerAttackRelease(Tone.Frequency(currentNotes[0] + 12, "midi"), "16n");
    }

    ripples.push(new Ripple(x, y, (1.5 + (x / canvas.width)) * RENDER_SCALE, currentNotes.slice(1)));
}

canvas.addEventListener('pointerdown', async (e) => {
    if (activePointers.size >= 4) return;
    if (Tone.context.state !== 'running') await Tone.context.resume();
    if (!isAudioStarted) { await Tone.start(); isAudioStarted = true; }
    
    const pos = { x: e.clientX * RENDER_SCALE, y: e.clientY * RENDER_SCALE };
    activePointers.set(e.pointerId, pos);
    pointerTrails.set(e.pointerId, { lastPos: pos, lastTime: performance.now(), points: [pos] });
    
    const newTrail = new LightTrail();
    newTrail.addPoint(pos.x, pos.y, performance.now());
    activeLightTrails.set(e.pointerId, newTrail);
    lightTrails.push(newTrail);

    spawnRipple(pos.x, pos.y, true);
});

canvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    const pos = { x: e.clientX * RENDER_SCALE, y: e.clientY * RENDER_SCALE };
    
    if (activeLightTrails.has(e.pointerId)) {
        activeLightTrails.get(e.pointerId).addPoint(pos.x, pos.y, performance.now());
    }

    const trail = pointerTrails.get(e.pointerId);
    trail.points.push(pos);
    const dist = Math.sqrt((pos.x - trail.lastPos.x)**2 + (pos.y - trail.lastPos.y)**2);

    if (dist > 100) {
        const duration = performance.now() - trail.lastTime;
        if (duration < 200) {
            const midPoint = trail.points[Math.floor(trail.points.length / 2)];
            const safeMid = midPoint ? { x: midPoint.x, y: midPoint.y } : null;
            const safeEnd = { x: pos.x, y: pos.y };

            if (safeMid) setTimeout(() => spawnRipple(safeMid.x, safeMid.y, false), 40);
            setTimeout(() => spawnRipple(safeEnd.x, safeEnd.y, false), 80);
        } else {
            spawnRipple(pos.x, pos.y, true);
        }
        trail.lastPos = pos; trail.lastTime = performance.now(); trail.points = [pos];
    }
});

function endPointer(e) { 
    activePointers.delete(e.pointerId); 
    pointerTrails.delete(e.pointerId); 
    activeLightTrails.delete(e.pointerId); 
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', endPointer); 
canvas.addEventListener('pointerout', endPointer);   
window.addEventListener('blur', () => {              
    activePointers.clear();
    pointerTrails.clear();
    activeLightTrails.clear();
});

// ==========================================
// 6. キーボード入力（3x3グリッド・マルチタッチ疑似対応）
// ==========================================
const activeKeys = new Set();
const keyMap = {
    'Numpad7': { col: 0, row: 0 }, 'Numpad8': { col: 1, row: 0 }, 'Numpad9': { col: 2, row: 0 },
    'Numpad4': { col: 0, row: 1 }, 'Numpad5': { col: 1, row: 1 }, 'Numpad6': { col: 2, row: 1 },
    'Numpad1': { col: 0, row: 2 }, 'Numpad2': { col: 1, row: 2 }, 'Numpad3': { col: 2, row: 2 },
    'Digit8': { col: 0, row: 0 }, 'Digit9': { col: 1, row: 0 }, 'Digit0': { col: 2, row: 0 },
    'KeyI':   { col: 0, row: 1 }, 'KeyO':   { col: 1, row: 1 }, 'KeyP':   { col: 2, row: 1 },
    'KeyK':   { col: 0, row: 2 }, 'KeyL':   { col: 1, row: 2 }, 'Semicolon': { col: 2, row: 2 }
};

window.addEventListener('keydown', async (e) => {
    if (!keyMap[e.code] || activeKeys.has(e.code)) return;
    if (activeKeys.size >= 4) return;

    if (Tone.context.state !== 'running') await Tone.context.resume();
    if (!isAudioStarted) { await Tone.start(); isAudioStarted = true; }

    activeKeys.add(e.code);
    const grid = keyMap[e.code];
    const x = canvas.width * ((grid.col * 2) + 1) / 6;
    const y = canvas.height * ((grid.row * 2) + 1) / 6;

    spawnRipple(x, y, true);
});

window.addEventListener('keyup', (e) => {
    if (activeKeys.has(e.code)) activeKeys.delete(e.code);
});

// ==========================================
// 7. アニメーションループ ＆ 呼吸するガイド演出
// ==========================================
function drawGuide(ctx, time) {
    if (isAudioStarted) return; 
    if (time < 3000) return;    

    const cycleTime = (time - 3000) % 16000;
    if (cycleTime > 6000) return; 

    let alpha = 0;
    let shrinkRatio = 0;

    if (cycleTime < 1500) {
        alpha = cycleTime / 1500;
    } else if (cycleTime < 4500) {
        alpha = 1.0;
        const pulseTime = cycleTime - 1500;
        shrinkRatio = (1 - Math.cos(pulseTime / 1500 * Math.PI * 2)) * 0.5; 
    } else {
        alpha = 1.0 - ((cycleTime - 4500) / 1500);
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    const baseR = Math.max(30, Math.min(canvas.width, canvas.height) * 0.1); 
    const r = baseR * (1 - shrinkRatio * 0.15);
    const innerR = r * 0.6; 

    // ★純白のガイドサークル
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, innerR), 0, Math.PI * 2);
    ctx.fill();
}

function loop(time) {
    if (!time) time = performance.now();

    // ★沖縄の箸（うめーし）を模した赤・黄ツートンカラー
    const g = ctx.createLinearGradient(0, canvas.height, canvas.width, 0);
    g.addColorStop(0, '#cc0000');     // 濃い赤（左下）
    g.addColorStop(0.3, '#e63946');   // 赤の境界
    g.addColorStop(0.35, '#f4d03f');  // 黄色の境界
    g.addColorStop(1, '#ffcc00');     // 鮮やかな黄色（右上）

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].update();
        ripples[i].draw(ctx);
        if (ripples[i].isDead()) {
            ripples.splice(i, 1);
        }
    }

    for (let i = lightTrails.length - 1; i >= 0; i--) {
        lightTrails[i].draw(ctx, time);
        if (lightTrails[i].isDead()) {
            lightTrails.splice(i, 1);
        }
    }

    drawGuide(ctx, time);

    requestAnimationFrame(loop);
}

// ループ開始
requestAnimationFrame(loop);