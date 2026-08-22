/**
 * LittleLink - Ultra-Dense Non-Overlapping Foam Bubbles & Optical Refraction System
 * 
 * Features:
 * - Ultra-high density screen packing with minimal gaps (honeycomb foam lattice)
 * - Slow, graceful, relaxing Brownian drift
 * - Optical Refraction: Background image (sky & clouds) magnified & refracted through convex lenses
 * - Plateau Foam Geometry: Squeezed flat contact membranes with strict ZERO overlap
 * - Realistic Film Rupture: Instant membrane collapse, shattered micro-droplets & tearing film shards
 * - Elastic Decompression: Neighbors recoil and expand into space when bubbles pop
 * - Real-time synthesized acoustic pop audio via Web Audio API
 * - Permanent popping without regeneration
 */

(function () {
    'use strict';

    // --- Web Audio API Pop Sound Synthesizer ---
    class BubbleSoundSynthesizer {
        constructor() {
            this.ctx = null;
            this.summerMelody = [
                392.00, 440.00, 493.88, 392.00, 587.33, 493.88,
                440.00, 392.00, 440.00, 493.88, 392.00, 293.66,
                329.63, 293.66, 329.63, 392.00, 329.63, 293.66,
                261.63, 246.94, 261.63, 293.66, 246.94, 196.00
            ];
            this.noteIndex = 0;
        }

        init() {
            if (!this.ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    this.ctx = new AudioCtx();
                }
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
        }

        playPop(radius, minR = 30, maxR = 100) {
            try {
                this.init();
                if (!this.ctx) return;

                const now = this.ctx.currentTime;

                // Joe Hisaishi's Summer melody played sequentially
                const baseFreq = this.summerMelody[this.noteIndex % this.summerMelody.length];
                this.noteIndex++;
                
                const timbres = ['sine', 'triangle', 'square', 'sawtooth'];
                const timbre = timbres[Math.floor(Math.random() * timbres.length)];

                const duration = 0.04 + Math.random() * 0.03; // 40ms to 70ms

                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                const filter = this.ctx.createBiquadFilter();

                // Lowpass filter to soften harsh waveforms
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(baseFreq * 3, now);
                filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + duration);

                osc.type = timbre;
                // Quick pitch drop for a percussive "pop" feel
                osc.frequency.setValueAtTime(baseFreq * 1.5, now);
                osc.frequency.exponentialRampToValueAtTime(baseFreq, now + duration * 0.5);

                // For square/sawtooth, lower the volume to avoid being too loud
                const maxVol = (timbre === 'square' || timbre === 'sawtooth') ? 0.2 : 0.45;
                gain.gain.setValueAtTime(maxVol, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(now);
                osc.stop(now + duration + 0.01);

                // High transient click
                const snapOsc = this.ctx.createOscillator();
                const snapGain = this.ctx.createGain();
                const snapDur = 0.012;

                const snapTimbres = ['triangle', 'sine', 'square'];
                snapOsc.type = snapTimbres[Math.floor(Math.random() * snapTimbres.length)];
                
                snapOsc.frequency.setValueAtTime(baseFreq * 2.5, now);
                snapOsc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + snapDur);

                const snapVol = snapOsc.type === 'square' ? 0.15 : 0.3;
                snapGain.gain.setValueAtTime(snapVol, now);
                snapGain.gain.exponentialRampToValueAtTime(0.0001, now + snapDur);

                snapOsc.connect(snapGain);
                snapGain.connect(this.ctx.destination);

                snapOsc.start(now);
                snapOsc.stop(now + snapDur + 0.01);
            } catch (e) {
                // Ignore audio context restriction errors
            }
        }
    }

    // --- Realistic Film Rupture Effects ---
    class RuptureParticle {
        constructor(x, y, vx, vy, size) {
            this.x = x;
            this.y = y;
            this.vx = vx;
            this.vy = vy;
            this.size = size;
            this.life = 1.0;
            this.decay = 0.075 + Math.random() * 0.05; // Fast life: 90-150ms
            this.drag = 0.90; // High air resistance
            this.gravity = 0.12;
        }

        update() {
            this.life -= this.decay;
            this.vx *= this.drag;
            this.vy = this.vy * this.drag + this.gravity;
            this.x += this.vx;
            this.y += this.vy;
            return this.life > 0;
        }

        draw(ctx) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x, this.y, Math.max(0.3, this.size * this.life), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${this.life * 0.95})`;
            ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
            ctx.shadowBlur = 3;
            ctx.fill();
            ctx.restore();
        }
    }

    class RuptureShard {
        constructor(x, y, r, startAngle, endAngle) {
            this.x = x;
            this.y = y;
            this.r = r;
            this.startAngle = startAngle;
            this.endAngle = endAngle;
            this.midAngle = (startAngle + endAngle) * 0.5;
            const speed = 1.8 + Math.random() * 3.5;
            this.vx = Math.cos(this.midAngle) * speed;
            this.vy = Math.sin(this.midAngle) * speed;
            this.life = 1.0;
            this.decay = 0.14 + Math.random() * 0.07; // Ultra-fast collapse: ~50-80ms
        }

        update() {
            this.life -= this.decay;
            this.x += this.vx;
            this.y += this.vy;
            this.r *= 0.95;
            return this.life > 0;
        }

        draw(ctx) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.x, this.y, Math.max(1, this.r), this.startAngle, this.endAngle);
            ctx.strokeStyle = `rgba(255, 255, 255, ${this.life * 0.85})`;
            ctx.lineWidth = Math.max(1, this.life * 1.8);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Geometry vertex resolution for Plateau contact membrane deformation
    const VERTEX_COUNT = 24;
    const COS_TABLE = new Float32Array(VERTEX_COUNT);
    const SIN_TABLE = new Float32Array(VERTEX_COUNT);
    for (let k = 0; k < VERTEX_COUNT; k++) {
        const a = (k / VERTEX_COUNT) * Math.PI * 2;
        COS_TABLE[k] = Math.cos(a);
        SIN_TABLE[k] = Math.sin(a);
    }

    // --- Bubble Entity ---
    class Bubble {
        constructor(x, y, r) {
            this.x = x;
            this.y = y;
            this.r = r;
            this.baseR = r;

            // Very slow initial drift velocity
            this.vx = (Math.random() - 0.5) * 0.03;
            this.vy = (Math.random() - 0.5) * 0.03;

            // Persistent drift direction for when the bubble is isolated
            this.driftAngle = Math.random() * Math.PI * 2;
            this.driftSpeed = 0.01 + Math.random() * 0.015;

            // Internal wobble phase
            this.wobblePhase = Math.random() * Math.PI * 2;
            this.wobbleSpeed = 0.003 + Math.random() * 0.004;

            // Squeeze & contact tracking
            this.squeezeFactor = 0;
            this.contactCount = 0;

            // Flattened boundary radii per vertex
            this.radii = new Float32Array(VERTEX_COUNT);
        }

        applyBrownian() {
            // When bubbles squeeze against each other, their motion slows down to an extreme crawl (流动速度降到极慢)
            const squeezeDamp = Math.max(0.004, 1 / (1 + this.squeezeFactor * 25 + this.contactCount * 4.0));

            // Slowly rotate the drift angle
            this.driftAngle += (Math.random() - 0.5) * 0.05;
            
            // Add continuous thrust for isolated floating, scaled down when squeezed
            const thrust = this.driftSpeed * squeezeDamp;
            this.vx += Math.cos(this.driftAngle) * thrust;
            this.vy += Math.sin(this.driftAngle) * thrust - 0.005 * squeezeDamp; // slight upward buoyancy

            // Ultra-gentle Brownian random walk scaled down by squeeze damping
            const scale = 0.005 * squeezeDamp;
            this.vx += (Math.random() - 0.5) * scale;
            this.vy += (Math.random() - 0.5) * scale;

            // Heavy viscous drag when crowded / squeezed, lighter drag when free
            const fluidDamping = 0.96 - (1 - squeezeDamp) * 0.25;
            this.vx *= fluidDamping;
            this.vy *= fluidDamping;

            // Strict speed clamp: free bubble ~0.4 px/frame, crowded/squeezed bubble ~0.0016 px/frame
            const speed = Math.hypot(this.vx, this.vy);
            const maxSpeed = 0.4 * squeezeDamp;
            if (speed > maxSpeed && speed > 0.000001) {
                this.vx = (this.vx / speed) * maxSpeed;
                this.vy = (this.vy / speed) * maxSpeed;
            }

            this.x += this.vx;
            this.y += this.vy;

            this.wobblePhase += this.wobbleSpeed * (0.1 + 0.9 * squeezeDamp);
        }

        constrainBounds(w, h) {
            const pad = this.r * 0.7;
            if (this.x < pad) {
                this.x = pad;
                this.vx = Math.abs(this.vx) * 0.5;
            } else if (this.x > w - pad) {
                this.x = w - pad;
                this.vx = -Math.abs(this.vx) * 0.5;
            }

            if (this.y < pad) {
                this.y = pad;
                this.vy = Math.abs(this.vy) * 0.5;
            } else if (this.y > h - pad) {
                this.y = h - pad;
                this.vy = -Math.abs(this.vy) * 0.5;
            }
        }

        computeDeformation(neighbors, w, h) {
            const wobble = 1 + Math.sin(this.wobblePhase) * 0.012;
            const currentR = this.r * wobble;

            const targetRadii = new Float32Array(VERTEX_COUNT);
            for (let k = 0; k < VERTEX_COUNT; k++) {
                targetRadii[k] = currentR;
            }

            // 1. Plateau contact membrane truncation against touching neighbors (minimal gap tight foam)
            const nLen = neighbors.length;
            for (let i = 0; i < nLen; i++) {
                const other = neighbors[i];
                if (other === this) continue;

                const dx = other.x - this.x;
                const dy = other.y - this.y;
                const dist = Math.hypot(dx, dy);
                const sumR = this.r + other.r;

                if (dist < sumR + 8 && dist > 0.001) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    // Contact plane position between centers
                    const dContact = (dist * this.r) / sumR;

                    for (let k = 0; k < VERTEX_COUNT; k++) {
                        const cosP = COS_TABLE[k] * nx + SIN_TABLE[k] * ny;
                        if (cosP > 0.01) {
                            const lPlane = dContact / cosP;
                            if (lPlane < targetRadii[k]) {
                                targetRadii[k] = lPlane;
                            }
                        }
                    }
                }
            }

            // 2. Flatten against viewport boundaries (screen walls)
            const dLeft = this.x;
            const dRight = w - this.x;
            const dTop = this.y;
            const dBottom = h - this.y;

            for (let k = 0; k < VERTEX_COUNT; k++) {
                const cosA = COS_TABLE[k];
                const sinA = SIN_TABLE[k];

                if (cosA < -0.01 && dLeft < this.r + 2) {
                    const l = dLeft / -cosA;
                    if (l < targetRadii[k]) targetRadii[k] = l;
                }
                if (cosA > 0.01 && dRight < this.r + 2) {
                    const l = dRight / cosA;
                    if (l < targetRadii[k]) targetRadii[k] = l;
                }
                if (sinA < -0.01 && dTop < this.r + 2) {
                    const l = dTop / -sinA;
                    if (l < targetRadii[k]) targetRadii[k] = l;
                }
                if (sinA > 0.01 && dBottom < this.r + 2) {
                    const l = dBottom / sinA;
                    if (l < targetRadii[k]) targetRadii[k] = l;
                }
            }

            // Smooth radii interpolation to prevent high-frequency jitter
            for (let k = 0; k < VERTEX_COUNT; k++) {
                if (this.radii[k] === 0) this.radii[k] = targetRadii[k];
                this.radii[k] += (targetRadii[k] - this.radii[k]) * 0.15;
            }
        }

        draw(ctx, bgImage, w, h) {
            ctx.save();
            ctx.translate(this.x, this.y);

            // Construct strictly non-overlapping deformed polygon path
            ctx.beginPath();
            const lastIdx = VERTEX_COUNT - 1;
            const startX = (this.radii[0] * COS_TABLE[0] + this.radii[lastIdx] * COS_TABLE[lastIdx]) * 0.5;
            const startY = (this.radii[0] * SIN_TABLE[0] + this.radii[lastIdx] * SIN_TABLE[lastIdx]) * 0.5;
            ctx.moveTo(startX, startY);

            for (let k = 0; k < VERTEX_COUNT; k++) {
                const nextK = (k + 1) % VERTEX_COUNT;
                const px = this.radii[k] * COS_TABLE[k];
                const py = this.radii[k] * SIN_TABLE[k];
                const midX = (px + this.radii[nextK] * COS_TABLE[nextK]) * 0.5;
                const midY = (py + this.radii[nextK] * SIN_TABLE[nextK]) * 0.5;
                ctx.quadraticCurveTo(px, py, midX, midY);
            }
            ctx.closePath();

            // Save path for clipping optical refraction
            ctx.save();
            ctx.clip();

            // 1. OPTICAL REFRACTION: Magnify & refract the background sky image through the convex lens
            if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
                const bgW = bgImage.naturalWidth;
                const bgH = bgImage.naturalHeight;

                const u = this.x / w;
                const v = this.y / h;

                const srcCenterX = u * bgW;
                const srcCenterY = v * bgH;

                const zoom = 1.35;
                const srcRadiusX = (this.r / w) * bgW / zoom;
                const srcRadiusY = (this.r / h) * bgH / zoom;

                const sx = Math.max(0, Math.min(bgW - srcRadiusX * 2, srcCenterX - srcRadiusX));
                const sy = Math.max(0, Math.min(bgH - srcRadiusY * 2, srcCenterY - srcRadiusY));
                const sw = srcRadiusX * 2;
                const sh = srcRadiusY * 2;

                ctx.drawImage(
                    bgImage,
                    sx, sy, sw, sh,
                    -this.r * 1.05, -this.r * 1.05, this.r * 2.1, this.r * 2.1
                );
            }

            // 2. Glass depth gradient
            const depthGrad = ctx.createRadialGradient(
                -this.r * 0.25, -this.r * 0.25, Math.max(1, this.r * 0.05),
                0, 0, this.r
            );
            depthGrad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
            depthGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
            depthGrad.addColorStop(0.85, 'rgba(210, 235, 255, 0.10)');
            depthGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.32)');

            ctx.fillStyle = depthGrad;
            ctx.fill();

            ctx.restore(); // Restore clip

            // 3. Crisp Crystal Rim Membrane
            ctx.lineWidth = Math.max(0.8, this.r * 0.034);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.68)';
            ctx.stroke();

            // 4. Primary Specular Highlight (Curved Top-Left Glint)
            ctx.beginPath();
            const hx = -this.r * 0.42;
            const hy = -this.r * 0.42;
            const hrx = Math.max(0.5, this.r * 0.26);
            const hry = Math.max(0.5, this.r * 0.12);
            ctx.ellipse(hx, hy, hrx, hry, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
            ctx.fill();

            // 5. Secondary Pinpoint Glint
            ctx.beginPath();
            const h2x = -this.r * 0.55;
            const h2y = -this.r * 0.22;
            ctx.arc(h2x, h2y, Math.max(0.5, this.r * 0.048), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
            ctx.fill();

            // 6. Ambient Bottom-Right Reflection Arc
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(0.5, this.r * 0.82), Math.PI * 0.18, Math.PI * 0.42);
            ctx.lineWidth = Math.max(0.8, this.r * 0.030);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
            ctx.stroke();

            ctx.restore();
        }

        contains(px, py) {
            const dx = px - this.x;
            const dy = py - this.y;
            return (dx * dx + dy * dy) <= (this.r * this.r);
        }
    }

    // --- Spatial Hash Grid for High Performance ---
    class SpatialGrid {
        constructor(cellSize) {
            this.cellSize = cellSize;
            this.cells = new Map();
        }

        clear() {
            this.cells.clear();
        }

        getKey(cx, cy) {
            return `${cx},${cy}`;
        }

        insert(bubble) {
            const cx = Math.floor(bubble.x / this.cellSize);
            const cy = Math.floor(bubble.y / this.cellSize);
            const key = this.getKey(cx, cy);
            let list = this.cells.get(key);
            if (!list) {
                list = [];
                this.cells.set(key, list);
            }
            list.push(bubble);
        }

        getNeighbors(bubble) {
            const cx = Math.floor(bubble.x / this.cellSize);
            const cy = Math.floor(bubble.y / this.cellSize);
            const neighbors = [];

            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const list = this.cells.get(this.getKey(cx + ox, cy + oy));
                    if (list) {
                        for (let i = 0; i < list.length; i++) {
                            const other = list[i];
                            if (other !== bubble) {
                                neighbors.push(other);
                            }
                        }
                    }
                }
            }
            return neighbors;
        }
    }

    // --- Main Bubble System ---
    class BubbleSystem {
        constructor() {
            this.canvas = document.getElementById('bubble-canvas');
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.id = 'bubble-canvas';
                document.body.insertBefore(this.canvas, document.body.firstChild);
            }

            this.ctx = this.canvas.getContext('2d');
            this.sound = new BubbleSoundSynthesizer();
            this.bubbles = [];
            this.ruptureParticles = [];
            this.ruptureShards = [];
            this.width = 0;
            this.height = 0;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.grid = new SpatialGrid(100);

            // Preload Background Image for Optical Refraction
            this.bgImage = new Image();
            this.bgImage.src = 'images/anime_sky_bg.jpg';

            this.init();
        }

        init() {
            this.handleResize();
            window.addEventListener('resize', () => this.handleResize());

            this.populateBubbles();
            this.bindEvents();

            this.animate = this.animate.bind(this);
            requestAnimationFrame(this.animate);
        }

        handleResize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);

            this.canvas.width = this.width * this.dpr;
            this.canvas.height = this.height * this.dpr;
            this.canvas.style.width = `${this.width}px`;
            this.canvas.style.height = `${this.height}px`;

            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this.grid.cellSize = 100;

            this.bubbles.forEach(b => {
                b.constrainBounds(this.width, this.height);
            });
        }

        populateBubbles() {
            // Ultra-dense full screen packing: minimal gaps
            const area = this.width * this.height;
            let targetCount = Math.max(52, Math.floor(area / 6150));
            targetCount = Math.floor(targetCount * 1.045); // Increased by 10% (from previous -5% baseline)

            this.bubbles = [];

            // Seed full screen with jittered grid of bubbles
            const cols = Math.ceil(Math.sqrt(targetCount * (this.width / this.height)));
            const rows = Math.ceil(targetCount / cols);
            const stepX = this.width / cols;
            const stepY = this.height / rows;

            for (let rIdx = 0; rIdx < rows; rIdx++) {
                for (let cIdx = 0; cIdx < cols; cIdx++) {
                    if (this.bubbles.length >= targetCount) break;

                    const rand = Math.random();
                    let r;
                    if (rand < 0.12) {
                        r = 75 + Math.random() * 25; // Large (75-100px)
                    } else if (rand < 0.70) {
                        r = 45 + Math.random() * 25; // Medium (45-70px)
                    } else {
                        r = 30 + Math.random() * 15;  // Small (30-45px)
                    }

                    const baseX = (cIdx + 0.5) * stepX + (Math.random() - 0.5) * stepX * 0.6;
                    const baseY = (rIdx + 0.5) * stepY + (Math.random() - 0.5) * stepY * 0.6;
                    const x = Math.max(r, Math.min(this.width - r, baseX));
                    const y = Math.max(r, Math.min(this.height - r, baseY));

                    this.bubbles.push(new Bubble(x, y, r));
                }
            }

            // Run initial relaxation iterations so bubbles settle into dense honeycomb foam
            for (let iter = 0; iter < 50; iter++) {
                this.resolveCollisions(0.85);
                this.bubbles.forEach(b => b.constrainBounds(this.width, this.height));
            }
            // Zero out initial velocities after layout relaxation
            this.bubbles.forEach(b => {
                b.vx = (Math.random() - 0.5) * 0.02;
                b.vy = (Math.random() - 0.5) * 0.02;
                b.squeezeFactor = 0;
                b.contactCount = 0;
            });
        }

        resolveCollisions(separationFactor = 0.30) {
            this.grid.clear();
            const len = this.bubbles.length;
            for (let i = 0; i < len; i++) {
                this.grid.insert(this.bubbles[i]);
            }

            // Multi-pass strict separation
            for (let i = 0; i < len; i++) {
                const b1 = this.bubbles[i];
                const neighbors = this.grid.getNeighbors(b1);

                for (let j = 0; j < neighbors.length; j++) {
                    const b2 = neighbors[j];
                    if (b1 === b2) continue;

                    const dx = b2.x - b1.x;
                    const dy = b2.y - b1.y;
                    const dist = Math.hypot(dx, dy);
                    const minDist = b1.r + b2.r;

                    // Strictly push apart when overlapping & measure squeezing
                    if (dist < minDist && dist > 0.0001) {
                        const overlap = minDist - dist;
                        const compression = overlap / minDist;

                        b1.squeezeFactor += compression;
                        b1.contactCount++;
                        b2.squeezeFactor += compression;
                        b2.contactCount++;

                        const nx = dx / dist;
                        const ny = dy / dist;

                        const m1 = b1.r * b1.r;
                        const m2 = b2.r * b2.r;
                        const totalM = m1 + m2;
                        const r1 = m2 / totalM;
                        const r2 = m1 / totalM;

                        const sep = overlap * separationFactor;
                        b1.x -= nx * sep * r1;
                        b1.y -= ny * sep * r1;
                        b2.x += nx * sep * r2;
                        b2.y += ny * sep * r2;

                        // Eliminate approach velocity (inelastic squeeze without bouncing)
                        const dvx = b1.vx - b2.vx;
                        const dvy = b1.vy - b2.vy;
                        const normV = dvx * nx + dvy * ny;

                        if (normV > 0) {
                            b1.vx -= nx * normV * r1;
                            b1.vy -= ny * normV * r1;
                            b2.vx += nx * normV * r2;
                            b2.vy += ny * normV * r2;
                        }

                        // High viscous contact damping between squeezing bubbles
                        b1.vx *= 0.75;
                        b1.vy *= 0.75;
                        b2.vx *= 0.75;
                        b2.vy *= 0.75;
                    }
                }
            }
        }

        popBubbleAt(px, py) {
            // Find topmost bubble clicked
            for (let i = this.bubbles.length - 1; i >= 0; i--) {
                const b = this.bubbles[i];
                if (b.contains(px, py)) {
                    // Play realistic pop audio
                    this.sound.playPop(b.r);

                    // 1. Instant Film Rupture: Shattered droplet mist (12-20 micro particles)
                    const particleCount = Math.floor(12 + (b.r / 100) * 8);
                    for (let j = 0; j < particleCount; j++) {
                        const angle = Math.random() * Math.PI * 2;
                        const spawnR = b.r * (0.8 + Math.random() * 0.3);
                        const spawnX = b.x + Math.cos(angle) * spawnR;
                        const spawnY = b.y + Math.sin(angle) * spawnR;

                        const speed = 2.0 + Math.random() * 5.5;
                        const vx = Math.cos(angle) * speed + (Math.random() - 0.5) * 1.5;
                        const vy = Math.sin(angle) * speed + (Math.random() - 0.5) * 1.5;
                        const size = 1.0 + Math.random() * 1.8;

                        this.ruptureParticles.push(new RuptureParticle(spawnX, spawnY, vx, vy, size));
                    }

                    // 2. Rupture Shards (3-4 collapsing film arc fragments)
                    const shardCount = 4;
                    for (let k = 0; k < shardCount; k++) {
                        const startA = (k / shardCount) * Math.PI * 2;
                        const endA = startA + (Math.PI * 2 / shardCount) * 0.6;
                        this.ruptureShards.push(new RuptureShard(b.x, b.y, b.r, startA, endA));
                    }

                    // 3. Instantly delete bubble (NO regeneration)
                    this.bubbles.splice(i, 1);

                    return true;
                }
            }
            return false;
        }

        bindEvents() {
            const handlePointer = (e) => {
                const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
                const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : null);
                if (clientX === null || clientY === null) return;

                this.sound.init();

                // If user clicked directly on an interactive button or card or airplane, let that element handle it
                const el = document.elementFromPoint(clientX, clientY);
                if (el && (el.closest('.button') || el.closest('a') || el.closest('.airplane') || el.closest('.airplane-wrapper'))) {
                    return;
                }

                this.popBubbleAt(clientX, clientY);
            };

            window.addEventListener('click', handlePointer, { passive: true });
            window.addEventListener('touchstart', (e) => {
                this.sound.init();
                const touch = e.touches[0];
                if (touch) {
                    const el = document.elementFromPoint(touch.clientX, touch.clientY);
                    if (el && (el.closest('.button') || el.closest('a') || el.closest('.airplane') || el.closest('.airplane-wrapper'))) {
                        return;
                    }
                    this.popBubbleAt(touch.clientX, touch.clientY);
                }
            }, { passive: true });

            // Cursor styling
            window.addEventListener('mousemove', (e) => {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                if (el && (el.closest('.button') || el.closest('a') || el.closest('.airplane') || el.closest('.airplane-wrapper'))) {
                    this.canvas.style.cursor = 'default';
                    return;
                }

                let hovered = false;
                for (let i = this.bubbles.length - 1; i >= 0; i--) {
                    if (this.bubbles[i].contains(e.clientX, e.clientY)) {
                        hovered = true;
                        break;
                    }
                }

                this.canvas.style.cursor = hovered ? 'pointer' : 'default';
            }, { passive: true });
        }

        animate() {
            this.ctx.clearRect(0, 0, this.width, this.height);

            // 1. Reset squeeze tracking and resolve collisions
            const bLen = this.bubbles.length;
            for (let i = 0; i < bLen; i++) {
                this.bubbles[i].squeezeFactor = 0;
                this.bubbles[i].contactCount = 0;
            }
            this.resolveCollisions(0.05);

            // 2. Physics update: Ultra-slow Brownian motion adjusted by squeeze factor
            for (let i = 0; i < bLen; i++) {
                this.bubbles[i].applyBrownian();
                this.bubbles[i].constrainBounds(this.width, this.height);
            }

            // 3. Rebuild spatial grid for neighbor queries and squeeze deformation
            this.grid.clear();
            for (let i = 0; i < bLen; i++) {
                this.grid.insert(this.bubbles[i]);
            }

            // 4. Compute Plateau deformation and draw each bubble with optical refraction
            for (let i = 0; i < bLen; i++) {
                const b = this.bubbles[i];
                const neighbors = this.grid.getNeighbors(b);
                b.computeDeformation(neighbors, this.width, this.height);
                b.draw(this.ctx, this.bgImage, this.width, this.height);
            }

            // 5. Update and draw fast rupture particles
            for (let i = this.ruptureParticles.length - 1; i >= 0; i--) {
                const p = this.ruptureParticles[i];
                if (p.update()) {
                    p.draw(this.ctx);
                } else {
                    this.ruptureParticles.splice(i, 1);
                }
            }

            // 6. Update and draw retracting film shards
            for (let i = this.ruptureShards.length - 1; i >= 0; i--) {
                const shard = this.ruptureShards[i];
                if (shard.update()) {
                    shard.draw(this.ctx);
                } else {
                    this.ruptureShards.splice(i, 1);
                }
            }

            requestAnimationFrame(this.animate);
        }
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new BubbleSystem());
    } else {
        new BubbleSystem();
    }
})();
