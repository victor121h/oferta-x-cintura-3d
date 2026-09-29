(function() {
    'use strict';

    // ========================================
    // CONFIGURATION
    // ========================================
    const CONFIG = {
        VSL_ID: 'CJP002_PORT_V1',
        VSL_DURATION: 1302, // 21:42
        PITCH_SECOND: 1013, // 16:53
        FALLBACK_SECONDS: 60,
        STORAGE_KEY: 'meister_cta_v1',
        CHECKOUT_URL: 'https://pay.contraste.ly/pay/bc6170eb-2749-4985-ad17-067d050a4139',
        PLAYER_ID: '695b4c65cfe85232737b1f9d',

        // A/B Testing
        AB_ENABLED: true,
        AB_ASSIGNMENTS_KEY: 'meister_ab_v1'
    };

    // Supabase Config - MEISTER-APP
    const SUPABASE = {
        URL: 'https://qqlakdpgllrjhesxidqj.supabase.co',
        KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxbGFrZHBnbGxyamhlc3hpZHFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk3Njk2MTMsImV4cCI6MjA2NTM0NTYxM30.Hg0sj9og6dys3PdWQdH-3XJL7ySZ2X6FF1w3KgNlnVw',
        TABLE: 'meisterpages_analytics'
    };

    // ========================================
    // STATE
    // ========================================
    let state = {
        // Session
        sessionId: null,
        visitorId: null,

        // UTM & Click IDs
        utmParams: {},
        referrer: null,
        fbclid: null, // Facebook Click ID (for offline conversions)
        gclid: null,  // Google Click ID (for offline conversions)

        // Page
        pageLoadTime: Date.now(),
        tabVisible: true,
        tabHiddenTime: 0,
        maxScrollDepth: 0,

        // Video
        playStarted: false,
        watchedSeconds: 0,
        totalWatchTime: 0,
        lastTrackedSecond: -10,
        lastVideoTime: 0,
        rewatchCount: 0,
        bufferCount: 0,
        pauseCount: 0,

        // CTA
        ctaRevealed: false,
        exitShown: false,
        exitDestination: null,
        theaterMode: false,

        // Queue
        eventQueue: [],

        // A/B Testing
        activeTests: [],
        testAssignments: {},
        testVariantCode: 'CTRL'
    };

    // ========================================
    // UTILITIES
    // ========================================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ========================================
    // THEATER MODE
    // ========================================
    let theaterExitTimeout = null;
    let theaterActive = false;
    let isBuffering = false;
    let userInitiatedPlay = false;
    let theaterEnteredAt = 0; // Timestamp when theater mode was entered
    const THEATER_GRACE_PERIOD = 3000; // 3 seconds grace period before allowing exit

    const enterTheaterMode = () => {
        theaterActive = true;
        theaterEnteredAt = Date.now();
        // Cancel any pending exit
        if (theaterExitTimeout) {
            clearTimeout(theaterExitTimeout);
            theaterExitTimeout = null;
        }
        console.log('[Theater] Entering theater mode');
        const overlay = document.getElementById('theater-overlay');
        const wrapper = document.querySelector('.video-wrapper');
        console.log('[Theater] overlay:', overlay, 'wrapper:', wrapper);
        if (overlay) overlay.classList.add('active');
        if (wrapper) wrapper.classList.add('theater');

        // Block scroll
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
    };

    const exitTheaterMode = (immediate = false, force = false) => {
        // Don't exit during grace period unless forced (video ended)
        const timeSinceEnter = Date.now() - theaterEnteredAt;
        if (timeSinceEnter < THEATER_GRACE_PERIOD && !force) {
            console.log('[Theater] Ignoring exit during grace period:', timeSinceEnter, 'ms');
            return;
        }

        // Don't exit during buffering unless forced
        if (isBuffering && !force) {
            console.log('[Theater] Ignoring exit during buffering');
            return;
        }

        // Cancel any pending exit first
        if (theaterExitTimeout) {
            clearTimeout(theaterExitTimeout);
            theaterExitTimeout = null;
        }

        const doExit = () => {
            // Double check we're not buffering before exiting
            if (isBuffering && !force) {
                console.log('[Theater] Cancelled exit - buffering started');
                return;
            }
            console.log('[Theater] Exiting theater mode');
            theaterActive = false;
            const overlay = document.getElementById('theater-overlay');
            const wrapper = document.querySelector('.video-wrapper');
            if (overlay) overlay.classList.remove('active');
            if (wrapper) wrapper.classList.remove('theater');

            // Unlock scroll
            document.body.style.overflow = '';
            document.body.style.touchAction = '';
        };

        if (immediate) {
            doExit();
        } else {
            // Delay exit to handle mobile buffering pauses
            console.log('[Theater] Scheduling exit in 600ms');
            theaterExitTimeout = setTimeout(doExit, 600);
        }
    };

    // Click on overlay exits theater mode (but doesn't pause video)
    document.addEventListener('DOMContentLoaded', () => {
        const overlay = document.getElementById('theater-overlay');

        if (overlay) {
            overlay.addEventListener('click', () => exitTheaterMode(true));
        }

        // Watch for video element and attach events directly
        const watchForVideo = () => {
            const video = document.querySelector('video');
            if (video && !video._theaterAttached) {
                video._theaterAttached = true;
                console.log('[Theater] Video element found, attaching events');
                console.log('[Theater] Initial state - muted:', video.muted, 'paused:', video.paused);

                // Track buffering state
                video.addEventListener('waiting', () => {
                    console.log('[Theater] Video waiting/buffering');
                    isBuffering = true;
                });

                video.addEventListener('canplay', () => {
                    console.log('[Theater] Video canplay');
                    isBuffering = false;
                });

                video.addEventListener('playing', () => {
                    console.log('[Theater] Video playing');
                    isBuffering = false;
                    // Re-enter theater if user initiated play
                    if (userInitiatedPlay && !video.muted) {
                        enterTheaterMode();
                    }
                });

                // VTurb autoplays muted, so we detect unmute as "user started watching"
                video.addEventListener('volumechange', () => {
                    console.log('[Theater] Volume change - muted:', video.muted);
                    if (!video.muted) {
                        userInitiatedPlay = true;
                        enterTheaterMode();
                    }
                });

                video.addEventListener('play', () => {
                    console.log('[Theater] Video play event, muted:', video.muted);
                    if (!video.muted && userInitiatedPlay) {
                        enterTheaterMode();
                    }
                });

                video.addEventListener('pause', () => {
                    console.log('[Theater] Video pause event, buffering:', isBuffering);
                    // Only exit if not buffering (real user pause)
                    if (!isBuffering) {
                        exitTheaterMode();
                    }
                });

                video.addEventListener('ended', () => {
                    console.log('[Theater] Video ended event');
                    isBuffering = false;
                    exitTheaterMode(true, true); // force exit
                });
            }
        };

        // Check periodically until video is found
        const videoCheckInterval = setInterval(() => {
            watchForVideo();
            if (document.querySelector('video')?._theaterAttached) {
                clearInterval(videoCheckInterval);
            }
        }, 500);

        // Capture click on video-wrapper before VTurb intercepts it
        const wrapper = document.querySelector('.video-wrapper');
        if (wrapper) {
            wrapper.addEventListener('click', (e) => {
                console.log('[Theater] Wrapper clicked, theaterActive:', theaterActive);
                userInitiatedPlay = true;
                if (!theaterActive) {
                    state.theaterMode = true;
                    enterTheaterMode();
                    track('theater_mode_activated', { seconds: state.watchedSeconds });
                }
            }, { capture: true });
        }
    });

    // Generate UUID
    const uuid = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    };

    // ========================================
    // FINGERPRINT - Unique Visitor ID
    // ========================================
    const generateFingerprint = () => {
        const components = [];

        // Screen
        components.push(screen.width + 'x' + screen.height);
        components.push(screen.colorDepth);
        components.push(window.devicePixelRatio || 1);

        // Timezone
        components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
        components.push(new Date().getTimezoneOffset());

        // Language
        components.push(navigator.language);
        components.push(navigator.languages?.join(',') || '');

        // Platform
        components.push(navigator.platform);
        components.push(navigator.hardwareConcurrency || 0);
        components.push(navigator.maxTouchPoints || 0);

        // Canvas fingerprint
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('MeisterPages', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('MeisterPages', 4, 17);
            components.push(canvas.toDataURL().slice(-50));
        } catch (e) {
            components.push('no-canvas');
        }

        // WebGL
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    components.push(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
                    components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
                }
            }
        } catch (e) {
            components.push('no-webgl');
        }

        // Hash the components
        const str = components.join('|||');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }

        return 'fp_' + Math.abs(hash).toString(36);
    };

    // Get or create visitor ID (persistent across sessions)
    // IMPORTANTE: Usa UUID v4 para garantir unicidade absoluta
    // O fingerprint é mantido separadamente para analytics
    const getVisitorId = () => {
        let vid = localStorage.getItem('mp_visitor');
        if (!vid) {
            // UUID v4 garante que NUNCA se repete (probabilidade ~0)
            vid = uuid();
            localStorage.setItem('mp_visitor', vid);
            // Salva fingerprint separadamente para analytics/anti-fraude
            localStorage.setItem('mp_fingerprint', generateFingerprint());
        }
        return vid;
    };

    // Get or create session ID
    const getSessionId = () => {
        let sid = sessionStorage.getItem('mp_session');
        if (!sid) {
            sid = uuid();
            sessionStorage.setItem('mp_session', sid);
        }
        return sid;
    };

    // Device detection
    const getDevice = () => {
        const ua = navigator.userAgent;
        if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
        if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
        return 'desktop';
    };

    // Browser detection
    const getBrowser = () => {
        const ua = navigator.userAgent;
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('SamsungBrowser')) return 'Samsung';
        if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
        if (ua.includes('Edge')) return 'Edge';
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Safari')) return 'Safari';
        return 'Other';
    };

    // ========================================
    // SUPABASE TRACKING
    // ========================================
    const queueEvent = (event, seconds = 0, metadata = {}) => {
        const timeOnPage = Math.floor((Date.now() - state.pageLoadTime) / 1000);

        // Replace {uid} placeholder in page URL (handle both decoded and URL-encoded)
        const pageUrl = window.location.href
            .replace(/\{uid\}/gi, state.visitorId || 'unknown')
            .replace(/%7Buid%7D/gi, state.visitorId || 'unknown');

        state.eventQueue.push({
            // Campos que existem no schema
            session_id: state.sessionId,
            visitor_id: state.visitorId,
            event_type: event,
            utm_source: state.utmParams.utm_source || null,
            utm_medium: state.utmParams.utm_medium || null,
            utm_campaign: state.utmParams.utm_campaign || null,
            utm_content: state.utmParams.utm_content || null,
            mdk: buildMDK() || state.utmParams.mdk || null,
            fbclid: state.fbclid || null,
            gclid: state.gclid || null,
            user_agent: navigator.userAgent,
            // Dados extras vão no event_data (JSONB)
            event_data: {
                ...metadata,
                page_url: pageUrl,
                referrer: state.referrer,
                seconds,
                video_id: CONFIG.VSL_ID,
                device: getDevice(),
                browser: getBrowser(),
                duration: CONFIG.VSL_DURATION,
                time_on_page: timeOnPage,
                total_watch_time: state.totalWatchTime,
                max_scroll_depth: state.maxScrollDepth,
                rewatch_count: state.rewatchCount,
                buffer_count: state.bufferCount,
                pause_count: state.pauseCount,
                tab_hidden_time: state.tabHiddenTime,
                theater_mode: state.theaterMode
            }
        });
    };

    const flushEvents = (useBeacon = false) => {
        if (state.eventQueue.length === 0) return;

        const events = [...state.eventQueue];
        state.eventQueue = [];

        const url = `${SUPABASE.URL}/rest/v1/${SUPABASE.TABLE}`;
        const headers = {
            'Content-Type': 'application/json',
            'apikey': SUPABASE.KEY,
            'Authorization': `Bearer ${SUPABASE.KEY}`,
            'Prefer': 'return=minimal'
        };

        if (useBeacon && navigator.sendBeacon) {
            fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(events),
                keepalive: true
            }).catch(() => {});
        } else {
            fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(events)
            }).catch(() => {});
        }

        console.log('[Supabase] Flushed', events.length, 'events');
    };

    // Flush every 30 seconds
    setInterval(() => flushEvents(), 30000);

    // ========================================
    // TAB VISIBILITY TRACKING
    // ========================================
    let tabHiddenStart = null;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            state.tabVisible = false;
            tabHiddenStart = Date.now();
            queueEvent('tab_hidden', state.watchedSeconds);
            flushEvents(true);
        } else {
            state.tabVisible = true;
            if (tabHiddenStart) {
                state.tabHiddenTime += Math.floor((Date.now() - tabHiddenStart) / 1000);
                tabHiddenStart = null;
            }
            queueEvent('tab_visible', state.watchedSeconds);
        }
    });

    // ========================================
    // SCROLL DEPTH TRACKING
    // ========================================
    const trackScroll = () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;

        if (scrollPercent > state.maxScrollDepth) {
            state.maxScrollDepth = scrollPercent;

            // Track milestones
            if (scrollPercent >= 25 && state.maxScrollDepth < 30) {
                queueEvent('scroll_25', state.watchedSeconds);
            } else if (scrollPercent >= 50 && state.maxScrollDepth < 55) {
                queueEvent('scroll_50', state.watchedSeconds);
            } else if (scrollPercent >= 75 && state.maxScrollDepth < 80) {
                queueEvent('scroll_75', state.watchedSeconds);
            } else if (scrollPercent >= 100) {
                queueEvent('scroll_100', state.watchedSeconds);
            }
        }
    };

    window.addEventListener('scroll', trackScroll, { passive: true });

    // ========================================
    // EXIT TRACKING
    // ========================================
    const trackExit = () => {
        const timeOnPage = Math.floor((Date.now() - state.pageLoadTime) / 1000);

        queueEvent('page_exit', state.watchedSeconds, {
            exit_destination: state.exitDestination || 'closed',
            drop_off_second: state.watchedSeconds,
            final_watch_time: state.totalWatchTime,
            final_scroll_depth: state.maxScrollDepth,
            time_on_page: timeOnPage
        });

        flushEvents(true);
    };

    window.addEventListener('pagehide', trackExit);
    window.addEventListener('beforeunload', trackExit);

    // ========================================
    // TRACKING
    // ========================================
    const track = (event, data = {}) => {
        // Supabase only (GTM removed for performance)
        queueEvent(event, state.watchedSeconds, data);
        console.log('[Track]', event, data);
    };

    // ========================================
    // URL PARAMS
    // ========================================
    const getParams = () => {
        const params = new URLSearchParams(window.location.search);
        return {
            cta: params.get('cta'),
            utm_source: params.get('utm_source'),
            utm_medium: params.get('utm_medium'),
            utm_campaign: params.get('utm_campaign'),
            utm_content: params.get('utm_content'),
            utm_term: params.get('utm_term'),
            mdk: params.get('mdk') || params.get('utm_term'),
            // Click IDs for offline conversions
            fbclid: params.get('fbclid'),  // Facebook Click ID
            gclid: params.get('gclid')     // Google Click ID
        };
    };

    // ========================================
    // A/B TESTING
    // ========================================

    // Load active tests from Supabase
    const loadActiveTests = async () => {
        if (!CONFIG.AB_ENABLED) return;

        try {
            const response = await fetch(
                `${SUPABASE.URL}/rest/v1/meisterpages_tests?status=eq.active&select=*`,
                {
                    headers: {
                        'apikey': SUPABASE.KEY,
                        'Authorization': `Bearer ${SUPABASE.KEY}`
                    }
                }
            );
            if (response.ok) {
                state.activeTests = await response.json();
                console.log('[AB Test] Loaded', state.activeTests.length, 'active tests');
            }
        } catch (e) {
            console.error('[AB Test] Failed to load tests:', e);
        }
    };

    // Get or assign a variant for a test
    const getOrAssignVariant = (test) => {
        // Check localStorage for existing assignment
        let assignments = {};
        try {
            const stored = localStorage.getItem(CONFIG.AB_ASSIGNMENTS_KEY);
            assignments = stored ? JSON.parse(stored) : {};
        } catch (e) {
            // localStorage corrupted, start fresh
            assignments = {};
        }

        if (assignments[test.id]) {
            console.log(`[AB Test] ${test.test_code}: Using stored variant ${assignments[test.id]}`);
            return assignments[test.id];
        }

        // Assign new variant based on split
        const split = test.split || { A: 50, B: 50 };
        const random = Math.random() * 100;
        let cumulative = 0;
        let assignedVariant = 'A';

        for (const [variant, weight] of Object.entries(split)) {
            cumulative += weight;
            if (random <= cumulative) {
                assignedVariant = variant;
                break;
            }
        }

        // Store assignment
        assignments[test.id] = assignedVariant;
        localStorage.setItem(CONFIG.AB_ASSIGNMENTS_KEY, JSON.stringify(assignments));

        // Record assignment in Supabase (fire-and-forget)
        fetch(`${SUPABASE.URL}/rest/v1/meisterpages_test_assignments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE.KEY,
                'Authorization': `Bearer ${SUPABASE.KEY}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                visitor_id: state.visitorId,
                test_id: test.id,
                variant: assignedVariant
            })
        }).catch(() => {});

        console.log(`[AB Test] ${test.test_code}: Assigned variant ${assignedVariant}`);
        return assignedVariant;
    };

    // Apply variant modifications to the page
    const applyVariant = (test, variant) => {
        const variantData = test.variants?.[variant];
        if (!variantData) return;

        switch (test.type) {
            case 'headline':
                const headlineEl = document.querySelector('[data-test="headline"], .headline, h1');
                if (headlineEl && variantData.text) {
                    headlineEl.textContent = variantData.text;
                    console.log(`[AB Test] Applied headline variant ${variant}`);
                }
                break;

            case 'button':
            case 'cta_text':
                const ctaEls = document.querySelectorAll('[data-cta], .cta-button');
                ctaEls.forEach(el => {
                    if (variantData.text) el.textContent = variantData.text;
                    if (variantData.color) el.style.background = variantData.color;
                });
                console.log(`[AB Test] Applied CTA variant ${variant}`);
                break;

            case 'color':
                if (variantData.primary) {
                    document.documentElement.style.setProperty('--color-primary', variantData.primary);
                }
                if (variantData.accent) {
                    document.documentElement.style.setProperty('--color-accent', variantData.accent);
                }
                console.log(`[AB Test] Applied color variant ${variant}`);
                break;

            case 'video':
                // Video variants would require player ID swap - handled separately
                console.log(`[AB Test] Video variant ${variant} - player ID: ${variantData.player_id}`);
                break;

            default:
                console.log(`[AB Test] Unknown test type: ${test.type}`);
        }
    };

    // Build test variant code for MDK (e.g., HL01A, HL02B)
    const buildTestVariantCode = () => {
        if (state.activeTests.length === 0) return 'CTRL';

        const codes = [];
        let assignments = {};
        try {
            const stored = localStorage.getItem(CONFIG.AB_ASSIGNMENTS_KEY);
            assignments = stored ? JSON.parse(stored) : {};
        } catch (e) {
            assignments = {};
        }

        for (const test of state.activeTests) {
            const variant = assignments[test.id] || 'A';
            codes.push(`${test.test_code}${variant}`);
        }

        return codes.join('-') || 'CTRL';
    };

    // Initialize A/B Testing
    const initABTesting = async () => {
        if (!CONFIG.AB_ENABLED) return;

        await loadActiveTests();

        for (const test of state.activeTests) {
            const variant = getOrAssignVariant(test);
            state.testAssignments[test.id] = variant;
            applyVariant(test, variant);
        }

        // Build variant code for MDK
        state.testVariantCode = buildTestVariantCode();
        console.log(`[AB Test] Variant code: ${state.testVariantCode}`);
    };

    // Build MDK with visitor ID replacement
    // MDK format: CO-SOURCE-MEDIUM-PRODUTO-CAMPANHA-BASE-DATA-CANAL-TESTE-JOKER-OUTRO
    // {uid} placeholder is replaced with actual visitor_id
    // {teste} placeholder is replaced with test variant code (e.g., HL01A)
    const buildMDK = () => {
        const baseMdk = state.utmParams.mdk || '';
        if (!baseMdk) return '';

        // Replace placeholders (handle both decoded and URL-encoded versions)
        let mdk = baseMdk
            .replace(/\{uid\}/gi, state.visitorId || 'unknown')
            .replace(/%7Buid%7D/gi, state.visitorId || 'unknown')
            .replace(/\{teste\}/gi, state.testVariantCode || 'CTRL')
            .replace(/%7Bteste%7D/gi, state.testVariantCode || 'CTRL');

        return mdk;
    };

    const buildCheckoutUrl = () => {
        const url = new URL(CONFIG.CHECKOUT_URL);

        // Build updated MDK
        const updatedMdk = buildMDK();

        // Set UTM params
        if (state.utmParams.utm_source) url.searchParams.set('utm_source', state.utmParams.utm_source);
        if (state.utmParams.utm_medium) url.searchParams.set('utm_medium', state.utmParams.utm_medium);
        if (state.utmParams.utm_campaign) url.searchParams.set('utm_campaign', state.utmParams.utm_campaign);
        if (state.utmParams.utm_content) url.searchParams.set('utm_content', state.utmParams.utm_content);

        // Set MDK (updated with TESTE and JOKER)
        if (updatedMdk) {
            url.searchParams.set('utm_term', updatedMdk);
            url.searchParams.set('mdk', updatedMdk);
        }

        // Add session for attribution
        url.searchParams.set('sid', state.sessionId);
        url.searchParams.set('vid', state.visitorId);

        // Pass click IDs for offline conversions
        if (state.fbclid) url.searchParams.set('fbclid', state.fbclid);
        if (state.gclid) url.searchParams.set('gclid', state.gclid);

        return url.toString();
    };

    // ========================================
    // CTA REVEAL
    // ========================================
    const revealCTA = (source = 'unknown') => {
        if (state.ctaRevealed) return;
        state.ctaRevealed = true;

        // Facebook Pixel - ViewContent no pitch
        if (typeof fbq === 'function') {
            fbq('track', 'ViewContent', {
                content_name: CONFIG.VSL_ID,
                content_category: 'VSL Pitch'
            });
        }

        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify({
            revealed: true,
            timestamp: Date.now()
        }));

        const checkoutUrl = buildCheckoutUrl();
        $$('[data-cta]').forEach(el => {
            if (el.tagName === 'A') el.href = checkoutUrl;
        });

        $('#cta-section').classList.add('visible');
        $('#below-fold').classList.add('visible');

        setTimeout(() => {
            if (window.innerWidth < 768) {
                $('#sticky-cta').classList.add('visible');
            }
        }, 1000);

        track('cta_revealed', { source, watchedSeconds: state.watchedSeconds });
    };

    // ========================================
    // EXIT INTENT
    // ========================================

    // Calculate time until 23:59 local time
    const getTimeUntilMidnight = () => {
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(23, 59, 59, 999);

        // If already past 23:59, show next day
        if (now > midnight) {
            midnight.setDate(midnight.getDate() + 1);
        }

        const diff = midnight - now;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        return {
            hours: String(hours).padStart(2, '0'),
            minutes: String(minutes).padStart(2, '0'),
            seconds: String(seconds).padStart(2, '0')
        };
    };

    // Update countdown every second
    let countdownInterval = null;
    const startCountdown = () => {
        const updateCountdown = () => {
            const time = getTimeUntilMidnight();
            const countdownEl = $('#urgency-countdown');
            if (countdownEl) {
                countdownEl.textContent = `${time.hours}:${time.minutes}:${time.seconds}`;
            }
        };
        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
    };

    // Show urgency popup (before CTA)
    const showUrgencyPopup = () => {
        if (state.exitShown) return;
        state.exitShown = true;
        startCountdown();
        $('#urgency-popup').classList.add('visible');
        track('urgency_popup_shown', { seconds: state.watchedSeconds });
    };

    const hideUrgencyPopup = () => {
        $('#urgency-popup').classList.remove('visible');
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    };

    // Show exit popup (after CTA)
    const showExitPopup = () => {
        if (state.exitShown) return;
        state.exitShown = true;
        $('#exit-popup').classList.add('visible');
        track('exit_intent_shown');
    };

    const hideExitPopup = () => {
        $('#exit-popup').classList.remove('visible');
    };

    // Exit intent handler - shows different popup based on CTA state
    const handleExitIntent = () => {
        if (state.exitShown) return;

        if (state.ctaRevealed) {
            showExitPopup();
        } else {
            showUrgencyPopup();
        }
    };

    document.addEventListener('mouseleave', (e) => {
        if (e.clientY < 10) handleExitIntent();
    });

    if (window.history && window.history.pushState) {
        window.history.pushState(null, '', window.location.href);
        window.addEventListener('popstate', () => {
            window.history.pushState(null, '', window.location.href);
            handleExitIntent();
        });
    }

    // Exit popup (after CTA) handlers
    $('#popup-close')?.addEventListener('click', hideExitPopup);
    $('#exit-popup')?.addEventListener('click', (e) => {
        if (e.target === $('#exit-popup')) hideExitPopup();
    });

    // Urgency popup (before CTA) handlers
    $('#urgency-watch')?.addEventListener('click', () => {
        hideUrgencyPopup();
        state.exitShown = false; // Allow showing again later
        track('urgency_popup_watch_clicked');
    });

    $('#urgency-leave')?.addEventListener('click', () => {
        hideUrgencyPopup();
        track('urgency_popup_leave_clicked');
        // Let user leave naturally
    });

    $('#urgency-popup')?.addEventListener('click', (e) => {
        if (e.target === $('#urgency-popup')) {
            hideUrgencyPopup();
            state.exitShown = false;
        }
    });

    // ========================================
    // INIT TRACKING
    // ========================================
    const initTracking = () => {
        state.sessionId = getSessionId();
        state.visitorId = getVisitorId();
        state.referrer = document.referrer || null;

        const params = getParams();

        state.utmParams = {
            utm_source: params.utm_source,
            utm_medium: params.utm_medium,
            utm_campaign: params.utm_campaign,
            utm_content: params.utm_content,
            utm_term: params.utm_term,
            mdk: params.mdk
        };

        // Store click IDs for offline conversions
        state.fbclid = params.fbclid;
        state.gclid = params.gclid;

        track('page_view', {
            referrer: state.referrer,
            visitor_id: state.visitorId,
            fbclid: state.fbclid,
            gclid: state.gclid
        });
    };

    // ========================================
    // VTURB PLAYER EVENTS
    // ========================================
    const initPlayer = () => {
        let progressTracked = {};
        let vturbPlayer = null;
        let watchStartTime = null;

        // Track watch time
        const updateWatchTime = () => {
            if (watchStartTime && state.playStarted) {
                state.totalWatchTime += Math.floor((Date.now() - watchStartTime) / 1000);
                watchStartTime = Date.now();
            }
        };

        // VTurb New Player API - player:ready event
        document.addEventListener('player:ready', (event) => {
            const detail = event.detail || {};
            const config = detail.config || {};
            vturbPlayer = detail.player || document.querySelector('vturb-smartplayer');

            console.log('[VTurb] Player ready', config.id);
            track('player_ready');

            if (vturbPlayer) {
                // Play event
                vturbPlayer.addEventListener('play', () => {
                    isBuffering = false;
                    if (!state.playStarted) {
                        state.playStarted = true;
                        track('video_play');
                    }
                    watchStartTime = Date.now();
                    if (userInitiatedPlay) {
                        enterTheaterMode();
                    }
                });

                // Pause event
                vturbPlayer.addEventListener('pause', () => {
                    updateWatchTime();
                    watchStartTime = null;
                    // Only track and exit theater if NOT buffering (real pause)
                    if (!isBuffering) {
                        state.pauseCount++;
                        track('video_pause', {
                            seconds: state.watchedSeconds,
                            pause_count: state.pauseCount
                        });
                        flushEvents();
                        exitTheaterMode();
                    }
                });

                // Ended event
                vturbPlayer.addEventListener('ended', () => {
                    updateWatchTime();
                    isBuffering = false;
                    exitTheaterMode(true, true); // force exit
                    if (!progressTracked.complete) {
                        progressTracked.complete = true;
                        track('video_complete', {
                            total_watch_time: state.totalWatchTime
                        });
                        revealCTA('complete');
                        flushEvents();
                    }
                });

                // Waiting/buffering event
                vturbPlayer.addEventListener('waiting', () => {
                    isBuffering = true;
                    state.bufferCount++;
                    queueEvent('video_buffer', state.watchedSeconds, {
                        buffer_count: state.bufferCount
                    });
                });

                // Playing event - buffering ended
                vturbPlayer.addEventListener('playing', () => {
                    isBuffering = false;
                    if (userInitiatedPlay) {
                        enterTheaterMode();
                    }
                });

                // Seeking event (rewatch detection)
                vturbPlayer.addEventListener('seeking', () => {
                    // Will check in timeupdate if they went back
                });

                // Timeupdate event
                vturbPlayer.addEventListener('timeupdate', (e) => {
                    const currentTime = Math.floor(e.detail?.currentTime || vturbPlayer.currentTime || 0);

                    // Rewatch detection
                    if (currentTime < state.lastVideoTime - 2) {
                        state.rewatchCount++;
                        queueEvent('video_rewatch', currentTime, {
                            from_second: state.lastVideoTime,
                            to_second: currentTime,
                            rewatch_count: state.rewatchCount
                        });
                    }

                    state.lastVideoTime = currentTime;
                    state.watchedSeconds = currentTime;
                    updateWatchTime();

                    // Track progress every 10 seconds
                    if (currentTime > 0 && currentTime - state.lastTrackedSecond >= 10) {
                        state.lastTrackedSecond = currentTime;
                        queueEvent('progress', currentTime, {
                            total_watch_time: state.totalWatchTime
                        });
                    }

                    // CTA reveal at pitch
                    if (currentTime >= CONFIG.PITCH_SECOND) {
                        revealCTA('pitch');
                    }

                    // Complete near end of video
                    if (currentTime >= CONFIG.VSL_DURATION - 10 && !progressTracked.complete) {
                        progressTracked.complete = true;
                        track('video_complete', {
                            total_watch_time: state.totalWatchTime
                        });
                        revealCTA('complete');
                        flushEvents();
                    }
                });
            }
        });

        // Fallback: also try smartplayer.instances API (old player)
        const checkOldPlayer = () => {
            if (typeof window.smartplayer !== 'undefined' &&
                window.smartplayer.instances &&
                window.smartplayer.instances.length > 0) {

                const player = window.smartplayer.instances[0];
                console.log('[VTurb] Old player API detected');

                player.on('play', () => {
                    isBuffering = false;
                    if (!state.playStarted) {
                        state.playStarted = true;
                        track('video_play');
                    }
                    watchStartTime = Date.now();
                    if (userInitiatedPlay) {
                        enterTheaterMode();
                    }
                });

                player.on('pause', () => {
                    updateWatchTime();
                    watchStartTime = null;
                    // Only track and exit if NOT buffering
                    if (!isBuffering) {
                        state.pauseCount++;
                        track('video_pause', {
                            seconds: state.watchedSeconds,
                            pause_count: state.pauseCount
                        });
                        flushEvents();
                        exitTheaterMode();
                    }
                });

                player.on('ended', () => {
                    updateWatchTime();
                    isBuffering = false;
                    exitTheaterMode(true, true); // force exit
                    if (!progressTracked.complete) {
                        progressTracked.complete = true;
                        track('video_complete', {
                            total_watch_time: state.totalWatchTime
                        });
                        revealCTA('complete');
                        flushEvents();
                    }
                });

                player.on('timeupdate', () => {
                    const currentTime = Math.floor(player.video?.currentTime || 0);

                    // Rewatch detection
                    if (currentTime < state.lastVideoTime - 2) {
                        state.rewatchCount++;
                        queueEvent('video_rewatch', currentTime, {
                            from_second: state.lastVideoTime,
                            to_second: currentTime,
                            rewatch_count: state.rewatchCount
                        });
                    }

                    state.lastVideoTime = currentTime;
                    state.watchedSeconds = currentTime;
                    updateWatchTime();

                    if (currentTime > 0 && currentTime - state.lastTrackedSecond >= 10) {
                        state.lastTrackedSecond = currentTime;
                        queueEvent('progress', currentTime, {
                            total_watch_time: state.totalWatchTime
                        });
                    }

                    if (currentTime >= CONFIG.PITCH_SECOND) {
                        revealCTA('pitch');
                    }

                    if (currentTime >= CONFIG.VSL_DURATION - 10 && !progressTracked.complete) {
                        progressTracked.complete = true;
                        track('video_complete', {
                            total_watch_time: state.totalWatchTime
                        });
                        revealCTA('complete');
                        flushEvents();
                    }
                });

                return true;
            }
            return false;
        };

        // Check for old player API periodically
        let oldPlayerChecks = 0;
        const oldPlayerInterval = setInterval(() => {
            if (checkOldPlayer() || oldPlayerChecks++ > 20) {
                clearInterval(oldPlayerInterval);
            }
        }, 500);

        // Fallback CTA reveal
        let fallbackInterval;
        const startFallback = () => {
            if (fallbackInterval) return;
            fallbackInterval = setInterval(() => {
                if (state.playStarted && state.watchedSeconds >= CONFIG.FALLBACK_SECONDS) {
                    revealCTA('fallback');
                    clearInterval(fallbackInterval);
                }
            }, 1000);
        };

        setTimeout(startFallback, 5000);

        // Load player script
        const script = document.createElement('script');
        script.src = `https://scripts.converteai.net/40eff44f-f7c6-4321-a7c6-b39c3f353230/players/${CONFIG.PLAYER_ID}/v4/player.js`;
        script.async = true;
        document.head.appendChild(script);
    };

    // ========================================
    // CTA CLICK TRACKING
    // ========================================
    const initCTATracking = () => {
        $$('[data-cta]').forEach(el => {
            el.addEventListener('click', (e) => {
                const location = el.dataset.cta;
                state.exitDestination = 'checkout';

                track('cta_clicked', {
                    location,
                    watchedSeconds: state.watchedSeconds,
                    total_watch_time: state.totalWatchTime,
                    time_on_page: Math.floor((Date.now() - state.pageLoadTime) / 1000)
                });
                flushEvents(true);
            });
        });
    };

    // ========================================
    // ADMIN SHORTCUT (DDD)
    // ========================================
    const initAdminShortcut = () => {
        let keys = '';
        let timeout;

        document.addEventListener('keydown', (e) => {
            clearTimeout(timeout);
            keys += e.key.toUpperCase();

            if (keys.includes('DDD')) {
                revealCTA('admin');
                keys = '';
            }

            timeout = setTimeout(() => keys = '', 1000);
        });
    };

    // ========================================
    // INIT
    // ========================================
    const init = async () => {
        initTracking();

        // Update URL to replace {uid} placeholder with actual visitor ID
        // Handle both decoded {uid} and URL-encoded %7Buid%7D
        const currentUrl = window.location.href;
        if (currentUrl.includes('{uid}') || currentUrl.includes('%7Buid%7D')) {
            const newUrl = currentUrl
                .replace(/\{uid\}/gi, state.visitorId || 'unknown')
                .replace(/%7Buid%7D/gi, state.visitorId || 'unknown');
            window.history.replaceState({}, '', newUrl);
        }

        // Initialize A/B Testing (loads tests and assigns variants)
        await initABTesting();

        const params = getParams();

        if (params.cta === '1') {
            revealCTA('url_param');
        } else {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    if (data.revealed) {
                        revealCTA('localStorage');
                    }
                } catch (e) {}
            }
        }

        initPlayer();
        initCTATracking();
        initAdminShortcut();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
