/**
 * LittleLink - Living Anime Sky (2.5D Depth Parallax & Living Cloud Flow Shader)
 * Bringing hand-drawn anime sky artwork to life with depth field estimation,
 * organic curl noise cloud billowing, differential wind drift, and 3D parallax.
 */

(function () {
    'use strict';

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
            let skyBgPath = '/images/anime_sky_bg.jpg';
            if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
                const isSubdir = window.location.pathname.indexOf('/guides/') !== -1 ||
                    document.querySelector('link[rel="stylesheet"][href*="../css/"]') !== null;
                skyBgPath = isSubdir ? '../images/anime_sky_bg.jpg' : 'images/anime_sky_bg.jpg';
            }
            textureLoader.load(
                skyBgPath,
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
                    // Zoom slightly and shift down-left so the top-right sun flare in texture is placed outside the screen
                    float margin = 1.14;
                    vec2 offset = vec2(-0.05, -0.05);
                    vec2 coverUV = (uv - 0.5) / margin + 0.5 + offset;
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

                    // --- DAYLIGHT MODE: NATURAL DIFFUSE AMBIENT SKY (光源在页面之外) ---
                    // Tone down any direct corner glare into rich uniform anime sky blue
                    float trDist = length(vec2(1.0, 1.0) - uv);
                    if (trDist < 0.45) {
                        float flareDamp = smoothstep(0.45, 0.05, trDist) * smoothstep(0.85, 1.0, lum);
                        vec3 ambientSkyBlue = vec3(0.24, 0.58, 0.92);
                        finalColor.rgb = mix(finalColor.rgb, ambientSkyBlue, flareDamp * 0.75);
                    }

                    // Subtle daytime crest breathing shimmer
                    float sunShimmer = sin(uTime * 1.0 + finalUV.x * 3.5 + finalUV.y * 2.5) * 0.025 * crest;
                    vec3 dayColor = finalColor.rgb + vec3(1.0, 0.97, 0.90) * sunShimmer;

                    // --- DARK MODE: REALISTIC STATIC MOONLIGHT (真实月光，无条纹，月光静止不动) ---
                    // Cloud density factor
                    float cloudDensity = smoothstep(0.38, 0.82, lum);

                    // Deep anime midnight sky gradient (zenith to horizon)
                    vec3 nightSkyTop = vec3(0.035, 0.060, 0.14);
                    vec3 nightSkyBottom = vec3(0.070, 0.125, 0.24);
                    vec3 nightSky = mix(nightSkyBottom, nightSkyTop, clamp(uv.y, 0.0, 1.0));

                    // Nocturnal cloud body tones (smooth velvety dark-blue cloud base)
                    vec3 cloudShadow = vec3(0.075, 0.120, 0.22);
                    vec3 cloudBody = mix(cloudShadow, vec3(0.17, 0.26, 0.40), smoothstep(0.42, 0.85, lum));
                    vec3 nightBase = mix(nightSky, cloudBody, cloudDensity);

                    // Realistic moonlight: off-screen light source outside the page (top-right, above)
                    // Completely STATIC (月光静止不动，模拟真实的月光，无条纹散开)
                    vec2 offscreenMoonPos = vec2(0.92, 1.15);
                    vec2 moonVector = finalUV - offscreenMoonPos;
                    float moonDist = length(moonVector * vec2(uResolution.x / uResolution.y * 0.8, 1.0));

                    // 1. Broad, smooth, serene ambient moonlight wash across the sky and clouds (no radial bands)
                    float moonAmbient = clamp(1.0 - moonDist * 0.58, 0.0, 1.0);
                    vec3 moonWash = vec3(0.62, 0.78, 0.94) * (moonAmbient * moonAmbient * 0.32);

                    // 2. Realistic lunar silver lining (月华银边 / crest rim lighting) on cloud tops
                    float silverRim = smoothstep(0.72, 0.98, lum);
                    vec3 moonRim = vec3(0.72, 0.86, 0.98) * (silverRim * 0.48);

                    // Assemble realistic night color
                    vec3 nightColor = nightBase;
                    nightColor += moonWash * (0.45 + cloudDensity * 0.55);
                    nightColor += moonRim;

                    // 3. Delicate static stars in open deep sky (peaceful starry night, completely static)
                    float starNoise = snoise(uv * 52.0);
                    float star = step(0.972, starNoise) * 0.45;
                    nightColor += vec3(0.85, 0.92, 1.0) * star * (1.0 - cloudDensity);

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

            window.addEventListener('pageshow', (event) => {
                this.onWindowResize();
                const isDark = document.documentElement.classList.contains('theme-dark') ||
                    (document.documentElement.classList.contains('theme-auto') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
                this.setDarkMode(isDark, true);
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
            this.width = window.innerWidth || document.documentElement.clientWidth || 1920;
            this.height = window.innerHeight || document.documentElement.clientHeight || 1080;
            if (this.renderer) {
                this.renderer.setSize(this.width, this.height);
                this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
            }

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

    function initWhenReady() {
        if (typeof THREE === 'undefined') {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (typeof THREE !== 'undefined') {
                    clearInterval(timer);
                    new LivingAnimeSkySystem();
                } else if (attempts >= 60) {
                    clearInterval(timer);
                    console.error('Three.js is required for the living sky shader.');
                }
            }, 50);
            return;
        }
        new LivingAnimeSkySystem();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWhenReady);
    } else {
        initWhenReady();
    }
})();
