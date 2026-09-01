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
            this.dpr = Math.min(window.devicePixelRatio || 1, 2);

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

            this.init();
        }

        init() {
            const textureLoader = new THREE.TextureLoader();
            textureLoader.load(
                'images/anime_sky_bg.jpg',
                (texture) => {
                    texture.wrapS = THREE.MirroredRepeatWrapping;
                    texture.wrapT = THREE.MirroredRepeatWrapping;
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.generateMipmaps = false;

                    const imageWidth = texture.image ? (texture.image.naturalWidth || texture.image.width) : 2560;
                    const imageHeight = texture.image ? (texture.image.naturalHeight || texture.image.height) : 1440;

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

                    vec4 finalColor = texture2D(uTexture, finalUV);

                    // 3. Subtle Sunlit Crest Breathing Shimmer (Warm sunlight subsurface scattering)
                    float lum = dot(finalColor.rgb, vec3(0.299, 0.587, 0.114));
                    float crest = smoothstep(0.85, 1.0, lum);
                    float sunShimmer = sin(uTime * 1.0 + finalUV.x * 3.5 + finalUV.y * 2.5) * 0.03 * crest;
                    finalColor.rgb += vec3(1.0, 0.97, 0.90) * sunShimmer;

                    gl_FragColor = finalColor;
                }
            `;

            this.uniforms = {
                uTexture: { value: texture },
                uResolution: { value: new THREE.Vector2(this.width, this.height) },
                uImageResolution: { value: new THREE.Vector2(imgW, imgH) },
                uTime: { value: 0 }
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

        bindEvents() {
            window.addEventListener('resize', this.onWindowResize.bind(this), { passive: true });
        }

        onWindowResize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.renderer.setSize(this.width, this.height);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

            if (this.uniforms && this.uniforms.uResolution) {
                this.uniforms.uResolution.value.set(this.width, this.height);
            }
        }

        animate() {
            requestAnimationFrame(this.animate.bind(this));

            const elapsedTime = this.clock.getElapsedTime();

            if (this.uniforms) {
                this.uniforms.uTime.value = elapsedTime;
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
