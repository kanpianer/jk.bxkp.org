/**
 * LittleLink - Living Anime Sky (2.5D Depth Parallax & Living Cloud Flow Shader)
 * Bringing hand-drawn anime sky artwork to life with depth field estimation,
 * organic curl noise cloud billowing, differential wind drift, and 3D parallax.
 */

(function () {
    'use strict';

    if (typeof THREE === 'undefined') {
        console.error('Three.js is required for the living sky shader.');
        return;
    }

    class LivingAnimeSkySystem {
        constructor() {
            this.container = document.getElementById('sky-canvas-container') || document.body;
            this.canvas = document.getElementById('sky-canvas');

            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

            // Three.js Scene Setup
            this.scene = new THREE.Scene();
            this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

            this.renderer = new THREE.WebGLRenderer({
                canvas: this.canvas,
                antialias: true,
                powerPreference: 'high-performance'
            });
            this.renderer.setSize(this.width, this.height);
            this.renderer.setPixelRatio(this.dpr);

            this.clock = new THREE.Clock();

            // Dark Mode Transition State
            const isDarkInit = document.documentElement.classList.contains('theme-dark') ||
                (document.documentElement.classList.contains('theme-auto') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
            this.targetDarkMode = isDarkInit ? 1.0 : 0.0;
            this.currentDarkMode = this.targetDarkMode;

            window.__skySystem = this;

            this.init();
        }

        init() {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                'images/anime_sky_bg.jpg',
                (texture) => {
                    texture.wrapS = THREE.MirroredRepeatWrapping;
                    texture.wrapT = THREE.MirroredRepeatWrapping;
                    texture.generateMipmaps = true;
                    texture.minFilter = THREE.LinearMipmapLinearFilter;
                    texture.magFilter = THREE.LinearFilter;

                    if (this.renderer && this.renderer.capabilities) {
                        const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
                        if (maxAnisotropy > 0) {
                            texture.anisotropy = Math.min(maxAnisotropy, 16);
                        }
                    }

                    const imageWidth = texture.image ? (texture.image.naturalWidth || texture.image.width) : 3840;
                    const imageHeight = texture.image ? (texture.image.naturalHeight || texture.image.height) : 2144;

                    this.createSkyMaterial(texture, imageWidth, imageHeight);
                    this.bindEvents();
                    this.animate();
                },
                undefined,
                (err) => {
                    console.error('Failed to load anime sky image:', err);
                }
            );
        }

        createSkyMaterial(texture, imgW, imgH) {
            const vertexShader = `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `;

            const fragmentShader = `
                precision highp float;

                uniform sampler2D uTexture;
                uniform vec2 uResolution;
                uniform vec2 uImageResolution;
                uniform float uTime;
                uniform float uDarkMode;

                varying vec2 vUv;

                // 2D Simplex Noise for natural fluid turbulence
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                                        0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                                        -0.577350269189626, // -1.0 + 2.0 * C.x
                                        0.024390243902439); // 1.0 / 41.0
                    vec2 i  = floor(v + dot(v, C.yy));
                    vec2 x0 = v -   i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;
                    i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                        + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                    m = m*m;
                    m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g;
                    g.x  = a0.x  * x0.x  + h.x  * x0.y;
                    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }

                // Aspect ratio preserving cover UV mapping with overscan safety margin
                vec2 getCoverUV(vec2 uv, vec2 screenRes, vec2 imgRes) {
                    float sAspect = screenRes.x / screenRes.y;
                    float iAspect = imgRes.x / imgRes.y;
                    // 8% overscan safety margin to ensure drift and curl noise never touch image borders
                    float margin = 1.08;
                    vec2 coverUV = (uv - 0.5) / margin + 0.5;
                    if (sAspect > iAspect) {
                        float scale = sAspect / iAspect;
                        coverUV.y = (coverUV.y - 0.5) / scale + 0.5;
                    } else {
                        float scale = iAspect / sAspect;
                        coverUV.x = (coverUV.x - 0.5) / scale + 0.5;
                    }
                    return coverUV;
                }

                void main() {
                    vec2 uv = getCoverUV(vUv, uResolution, uImageResolution);
                    float depth = clamp(1.0 - uv.y * 0.4, 0.0, 1.0);

                    // 1. Multi-Octave Organic Curl Noise Fluid Motion (Cloud Billowing & Breathing)
                    float t = uTime * 0.18;
                    vec2 nCoord = uv * 3.2;

                    // Primary slow volumetric swell
                    vec2 flow1 = vec2(
                        snoise(vec2(nCoord.x + t * 0.25, nCoord.y + t * 0.15)),
                        snoise(vec2(nCoord.x - t * 0.20, nCoord.y + t * 0.30))
                    );

                    // Secondary delicate ripple
                    vec2 flow2 = vec2(
                        snoise(vec2(nCoord.x * 2.4 - t * 0.35, nCoord.y * 2.4 + t * 0.40)),
                        snoise(vec2(nCoord.x * 2.4 + t * 0.30, nCoord.y * 2.4 - t * 0.25))
                    );

                    vec2 totalFlow = (flow1 * 0.68 + flow2 * 0.32) * 0.008;

                    // 2. Autonomous Periodic Layered Wave Floating (Never diverges or drifts off-screen)
                    vec2 windDrift = vec2(
                        (sin(uTime * 0.22 + uv.y * 2.0) * 0.012 + cos(uTime * 0.14 + uv.x * 1.2) * 0.008) * (0.4 + depth * 0.6),
                        (cos(uTime * 0.26 + uv.x * 1.5) * 0.008 + sin(uTime * 0.16) * 0.005) * (0.3 + depth * 0.7)
                    );

                    // Final distorted sample coordinates
                    vec2 finalUV = uv + totalFlow + windDrift;

                    // High-clarity adaptive texture sampling with micro-contrast detail preservation
                    vec2 texel = 1.0 / uImageResolution;
                    vec4 centerCol = texture2D(uTexture, finalUV);

                    // Cross-neighborhood sampling for subtle sharpness enhancement
                    vec4 sN = texture2D(uTexture, finalUV + vec2(0.0, texel.y));
                    vec4 sS = texture2D(uTexture, finalUV - vec2(0.0, texel.y));
                    vec4 sE = texture2D(uTexture, finalUV + vec2(texel.x, 0.0));
                    vec4 sW = texture2D(uTexture, finalUV - vec2(texel.x, 0.0));
                    vec4 localMean = (sN + sS + sE + sW) * 0.25;

                    // Crisp unsharp mask (enhances cloud contours and brush strokes)
                    vec4 finalColor = clamp(centerCol + (centerCol - localMean) * 0.30, 0.0, 1.0);

                    // Luminance calculation
                    float lum = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
                    float crest = smoothstep(0.85, 1.0, lum);

                    // --- DAYLIGHT MODE LIGHTING ---
                    // Subtle Sunlit Crest Breathing Shimmer (Warm sunlight subsurface scattering)
                    float sunShimmer = sin(uTime * 1.0 + finalUV.x * 3.5 + finalUV.y * 2.5) * 0.03 * crest;
                    vec3 dayColor = finalColor.rgb + vec3(1.0, 0.97, 0.90) * sunShimmer;

                    // --- DARK MODE: MOONLIGHT RAYS & NOCTURNE SKY ---
                    // Cloud density factor
                    float cloudDensity = smoothstep(0.38, 0.82, lum);

                    // Deep anime midnight sky gradient
                    vec3 nightSkyTop = vec3(0.035, 0.065, 0.15);
                    vec3 nightSkyBottom = vec3(0.075, 0.13, 0.26);
                    vec3 nightSky = mix(nightSkyBottom, nightSkyTop, clamp(uv.y, 0.0, 1.0));

                    // Nocturnal cloud body tones
                    vec3 cloudShadow = vec3(0.08, 0.13, 0.23);
                    vec3 cloudBody = mix(cloudShadow, vec3(0.18, 0.28, 0.44), smoothstep(0.42, 0.85, lum));
                    vec3 nightBase = mix(nightSky, cloudBody, cloudDensity);

                    // Moonlight Rays (emanating from top-right moon position)
                    vec2 moonPos = vec2(0.88, 0.90);
                    vec2 rayOffset = finalUV - moonPos;
                    vec2 aspectOffset = rayOffset * vec2(uResolution.x / uResolution.y, 1.0);
                    float moonDist = length(aspectOffset);
                    float rayAngle = atan(rayOffset.y, rayOffset.x);

                    // Volumetric moonlight shafts / crepuscular rays
                    float rayShafts = sin(rayAngle * 10.0 + uTime * 0.08) * 0.35
                                    + sin(rayAngle * 21.0 - uTime * 0.05) * 0.25
                                    + sin(rayAngle * 33.0 + uTime * 0.12) * 0.15;
                    rayShafts = clamp(rayShafts + 0.35, 0.0, 1.0);

                    // Gentle undulating beam noise
                    float rayCurl = snoise(vec2(rayAngle * 3.5, moonDist * 1.5 - uTime * 0.06)) * 0.2 + 0.8;
                    float rayAttenuation = (1.0 / (1.0 + moonDist * 1.6)) * 0.85;
                    float moonRays = rayShafts * rayCurl * rayAttenuation;

                    // Soft luminous moonlight color
                    vec3 moonColor = vec3(0.70, 0.85, 1.0);

                    // Atmospheric lunar glow
                    float moonGlow = exp(-moonDist * 3.5) * 0.55 + exp(-moonDist * 1.2) * 0.25;

                    // Moonlit cloud crest shimmer (silver lunar highlight)
                    float moonShimmer = sin(uTime * 0.9 + finalUV.x * 3.5 + finalUV.y * 2.5) * 0.04 * crest;
                    vec3 moonCrest = vec3(0.78, 0.90, 1.0) * (crest * 0.50 + moonShimmer);

                    // Assemble night color
                    vec3 nightColor = nightBase;
                    nightColor += moonColor * (moonRays * (0.35 + cloudDensity * 0.45));
                    nightColor += moonColor * moonGlow;
                    nightColor += moonCrest;

                    // Subtle twinkling stars in open sky regions
                    float starNoise = snoise(uv * 48.0);
                    float star = step(0.965, starNoise) * (sin(uTime * 2.2 + starNoise * 80.0) * 0.4 + 0.6);
                    nightColor += vec3(0.85, 0.92, 1.0) * star * (1.0 - cloudDensity) * 0.45;

                    // Final blend between day and night based on uDarkMode
                    vec3 resultColor = mix(dayColor, nightColor, uDarkMode);
                    gl_FragColor = vec4(resultColor, 1.0);
                }
            `;

            this.uniforms = {
                uTexture: { value: texture },
                uResolution: { value: new THREE.Vector2(this.width, this.height) },
                uImageResolution: { value: new THREE.Vector2(imgW, imgH) },
                uTime: { value: 0 },
                uDarkMode: { value: this.currentDarkMode }
            };

            const geo = new THREE.PlaneGeometry(2, 2);
            const mat = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms: this.uniforms,
                depthWrite: false,
                depthTest: false
            });

            this.mesh = new THREE.Mesh(geo, mat);
            this.scene.add(this.mesh);
        }

        setDarkMode(isDark, instant = false) {
            this.targetDarkMode = isDark ? 1.0 : 0.0;
            if (instant) {
                this.currentDarkMode = this.targetDarkMode;
                if (this.uniforms && this.uniforms.uDarkMode) {
                    this.uniforms.uDarkMode.value = this.currentDarkMode;
                }
            }
        }

        bindEvents() {
            window.addEventListener('resize', this.onWindowResize.bind(this), { passive: true });

            window.addEventListener('themechange', (e) => {
                if (e.detail && typeof e.detail.isDark === 'boolean') {
                    this.setDarkMode(e.detail.isDark);
                }
            });

            if (typeof MutationObserver !== 'undefined') {
                const observer = new MutationObserver(() => {
                    const isDark = document.documentElement.classList.contains('theme-dark');
                    this.setDarkMode(isDark);
                });
                observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            }
        }

        onWindowResize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.renderer.setSize(this.width, this.height);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));

            if (this.uniforms && this.uniforms.uResolution) {
                this.uniforms.uResolution.value.set(this.width, this.height);
            }
        }

        animate() {
            requestAnimationFrame(this.animate.bind(this));

            const elapsedTime = this.clock.getElapsedTime();

            // Smooth day/night interpolation
            const diff = this.targetDarkMode - this.currentDarkMode;
            if (Math.abs(diff) > 0.0005) {
                this.currentDarkMode += diff * 0.06;
            } else {
                this.currentDarkMode = this.targetDarkMode;
            }

            if (this.uniforms) {
                this.uniforms.uTime.value = elapsedTime;
                if (this.uniforms.uDarkMode) {
                    this.uniforms.uDarkMode.value = this.currentDarkMode;
                }
            }

            this.renderer.render(this.scene, this.camera);
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new LivingAnimeSkySystem());
    } else {
        new LivingAnimeSkySystem();
    }
})();
