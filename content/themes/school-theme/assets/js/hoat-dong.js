/**
 * hoat-dong.js — Hỗ trợ cả trang Hoạt động (danh sách) và trang bài viết chi tiết
 * - Trang hoạt động: ai cũng react được (dùng fingerprint)
 * - Trang bài viết: chỉ được react khi có tag "hoat-dong" hoặc đã đăng nhập
 * - Optimistic update, cache 5 phút, đồng bộ member_uuid
 */

(function () {
    'use strict';

    /* ====== CẤU HÌNH ====== */
    const PB_WORKER_URL = (window.PB_URL || '').replace(/\/$/, '');
    const PB_DIRECT_URL = 'https://adminct.tinnguyen.xyz';

    const EMOJI_MAP = {
        '❤️': 'heart',
        '👍': 'thumbs',
        '🎉': 'party',
        '😮': 'wow',
    };
    const VALID_EMOJIS = ['❤️', '👍', '🎉', '😮'];

    /* ====== LẤY MEMBER UUID ====== */
    function getMemberUUID() {
        const el = document.getElementById('member-data');
        if (!el) return null;
        try {
            const data = JSON.parse(el.textContent);
            const memberId = data.uuid || data.id;
            if (memberId && memberId !== 'null') {
                return memberId;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /* ====== USER ID ====== */
    function getUserId() {
        const uuid = getMemberUUID();
        if (uuid) {
            localStorage.setItem('reaction_uid', uuid);
            return uuid;
        }
        let uid = localStorage.getItem('reaction_uid');
        if (!uid) {
            uid = crypto.randomUUID ? crypto.randomUUID() : 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
            localStorage.setItem('reaction_uid', uid);
        }
        return uid;
    }
    const USER_ID = getUserId();

    /* ====== RATE LIMIT ====== */
    const REACT_COOLDOWN = 2000;
    const reactTimestamps = {};

    function isRateLimited(postId, emoji) {
        const key = postId + emoji;
        const last = reactTimestamps[key] || 0;
        if (Date.now() - last < REACT_COOLDOWN) return true;
        reactTimestamps[key] = Date.now();
        return false;
    }

    /* ====== API HELPERS ====== */
    async function pbFetch(path, opts = {}) {
        if (!PB_WORKER_URL) return null;
        try {
            const res = await fetch(PB_WORKER_URL + '/' + path, {
                headers: { 'Content-Type': 'application/json' },
                ...opts,
            });
            if (!res.ok) {
                if (res.status === 409) {
                    const errorData = await res.json();
                    return { conflict: true, existingId: errorData.existingId };
                }
                return { error: true, status: res.status };
            }
            const text = await res.text();
            return text ? JSON.parse(text) : { success: true };
        } catch {
            return null;
        }
    }

    async function fetchAllCounts() {
        const url = `${PB_DIRECT_URL}/api/collections/reactions/records?perPage=9999&fields=post_id,emoji`;
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = await res.json();
            const result = {};
            if (data.items) {
                data.items.forEach(item => {
                    const pid = item.post_id;
                    const emoji = item.emoji;
                    if (!result[pid]) result[pid] = { '❤️':0, '👍':0, '🎉':0, '😮':0 };
                    if (result[pid][emoji] !== undefined) result[pid][emoji]++;
                });
            }
            return result;
        } catch { return null; }
    }

    async function fetchCountsForPost(postId) {
        const counts = { '❤️':0, '👍':0, '🎉':0, '😮':0 };
        for (const emoji of VALID_EMOJIS) {
            const filter = encodeURIComponent(`post_id="${postId}" && emoji="${emoji}"`);
            const url = `${PB_DIRECT_URL}/api/collections/reactions/records?filter=${filter}&perPage=1&skipTotal=false&fields=id`;
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    counts[emoji] = data?.totalItems ?? 0;
                }
            } catch (e) {}
        }
        return counts;
    }

    async function fetchUserReactions() {
        const uuid = getMemberUUID();
        if (!uuid) return;
        const filter = encodeURIComponent(`member_uuid="${uuid}"`);
        const url = `${PB_DIRECT_URL}/api/collections/reactions/records?filter=${filter}&perPage=999&fields=id,post_id,emoji`;
        try {
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            if (data.items) {
                const validKeys = new Set();
                data.items.forEach(item => {
                    const lsKey = `reaction_${item.post_id}_${item.emoji}`;
                    localStorage.setItem(lsKey, item.id);
                    validKeys.add(lsKey);
                });
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('reaction_') && !validKeys.has(key)) {
                        localStorage.removeItem(key);
                    }
                }
            }
        } catch (e) {}
    }

    async function addReact(postId, emoji) {
        const payload = {
            post_id: postId,
            emoji: emoji,
            user_id: USER_ID,
        };
        const uuid = getMemberUUID();
        if (uuid) {
            payload.member_uuid = uuid;
        }
        return await pbFetch('api/collections/reactions/records', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async function removeReact(recordId) {
        return await pbFetch(`api/collections/reactions/records/${recordId}`, { method: 'DELETE' });
    }

    /* ====== HANDLE REACT ====== */
    async function handleReact(btn) {
        if (btn.disabled) return;

        const postContainer = btn.closest('#post-reactions');
        if (postContainer) {
            const hasHoatDong = postContainer.dataset.hasHoatdong === 'true';
            if (!hasHoatDong && !getMemberUUID()) {
                showToast('🔒 Vui lòng đăng nhập để thả cảm xúc!');
                return;
            }
        }

        const postId = btn.dataset.postid;
        const emoji = btn.dataset.emoji;
        if (isRateLimited(postId, emoji)) {
            showToast('⏳ Chờ chút rồi thử lại!');
            return;
        }
        btn.disabled = true;

        const key = EMOJI_MAP[emoji];
        const countId = `count-${postId}-${key}`;
        const countEl = document.getElementById(countId);
        const isReacted = btn.classList.contains('reacted');
        const lsKey = `reaction_${postId}_${emoji}`;

        const oldCount = countEl ? parseInt(countEl.textContent) || 0 : 0;
        const oldReacted = isReacted;
        const oldRecordId = btn.dataset.recordId;

        if (isReacted) {
            btn.classList.remove('reacted');
            if (countEl) countEl.textContent = Math.max(0, oldCount - 1);
            delete btn.dataset.recordId;
        } else {
            btn.classList.add('reacted');
            if (countEl) countEl.textContent = oldCount + 1;
        }
        btn.classList.add('pop');
        btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });

        if (!PB_WORKER_URL) {
            if (isReacted) {
                localStorage.removeItem(lsKey);
            } else {
                localStorage.setItem(lsKey, 'demo');
                btn.dataset.recordId = 'demo';
            }
            showToast(isReacted ? 'Đã bỏ react' : emoji + ' Đã react!');
            btn.disabled = false;
            return;
        }

        let success = false;
        if (isReacted) {
            const recordId = oldRecordId;
            if (recordId && recordId !== 'demo') {
                const result = await removeReact(recordId);
                if (result === null) {
                    success = false;
                } else if (result.error && result.status === 404) {
                    success = true;
                    localStorage.removeItem(lsKey);
                } else if (result.error) {
                    success = false;
                } else {
                    success = true;
                    localStorage.removeItem(lsKey);
                }
            } else {
                success = true;
                localStorage.removeItem(lsKey);
            }
        } else {
            const result = await addReact(postId, emoji);
            if (result && result.id) {
                success = true;
                btn.dataset.recordId = result.id;
                localStorage.setItem(lsKey, result.id);
            } else if (result && result.conflict && result.existingId) {
                success = true;
                btn.dataset.recordId = result.existingId;
                localStorage.setItem(lsKey, result.existingId);
            } else {
                success = false;
            }
        }

        if (!success) {
            btn.classList.toggle('reacted', oldReacted);
            if (countEl) countEl.textContent = oldCount;
            if (oldReacted) {
                btn.dataset.recordId = oldRecordId;
            } else {
                delete btn.dataset.recordId;
            }
            showToast('⚠️ Có lỗi xảy ra, vui lòng thử lại.');
        }
        btn.disabled = false;
    }

    /* ====== RESTORE STATE ====== */
    function restoreReactState(postId) {
        for (const emoji of VALID_EMOJIS) {
            const lsKey = `reaction_${postId}_${emoji}`;
            const recordId = localStorage.getItem(lsKey);
            if (recordId) {
                const btn = document.querySelector(`.post-react-btn[data-emoji="${emoji}"][data-postid="${postId}"]`) || 
                            document.querySelector(`.hd-react-btn[data-emoji="${emoji}"][data-postid="${postId}"]`);
                if (btn) {
                    btn.classList.add('reacted');
                    btn.dataset.recordId = recordId;
                }
            }
        }
    }

    /* ====== LOAD COUNTS ====== */
    async function loadAllCounts(forceRefresh = false) {
        if (!PB_WORKER_URL) {
            document.querySelectorAll('.hd-count, .post-count').forEach(el => (el.textContent = '0'));
            return;
        }

        if (getMemberUUID()) {
            await fetchUserReactions();
        }

        const cards = document.querySelectorAll('.hd-card[data-postid]');
        const postContainer = document.getElementById('post-reactions');

        if (cards.length > 0) {
            await loadCountsForCards(cards, forceRefresh);
        } else if (postContainer) {
            const postId = postContainer.dataset.postid;
            await loadCountsForPost(postId, forceRefresh);
        }
    }

    async function loadCountsForCards(cards, forceRefresh) {
        const CACHE_KEY = 'reaction_counts_cache';
        const CACHE_TTL = 300000;
        const now = Date.now();
        let cachedData = null;

        if (!forceRefresh) {
            try {
                const raw = localStorage.getItem(CACHE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed.timestamp && (now - parsed.timestamp < CACHE_TTL)) {
                        cachedData = parsed.data;
                    }
                }
            } catch (e) {}
        }

        if (cachedData) {
            for (const card of cards) {
                const postId = card.dataset.postid;
                const counts = cachedData[postId] || {};
                for (const [emoji, count] of Object.entries(counts)) {
                    const key = EMOJI_MAP[emoji];
                    const el = document.getElementById(`count-${postId}-${key}`);
                    if (el) el.textContent = count;
                }
                restoreReactState(postId);
            }
            return;
        }

        const allCounts = await fetchAllCounts();
        if (allCounts) {
            const newData = {};
            for (const card of cards) {
                const postId = card.dataset.postid;
                const counts = allCounts[postId] || { '❤️':0, '👍':0, '🎉':0, '😮':0 };
                newData[postId] = counts;
                for (const [emoji, count] of Object.entries(counts)) {
                    const key = EMOJI_MAP[emoji];
                    const el = document.getElementById(`count-${postId}-${key}`);
                    if (el) el.textContent = count;
                }
                restoreReactState(postId);
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: now,
                data: newData
            }));
        }
    }

    async function loadCountsForPost(postId, forceRefresh) {
        const counts = await fetchCountsForPost(postId);
        if (counts) {
            for (const [emoji, count] of Object.entries(counts)) {
                const key = EMOJI_MAP[emoji];
                const el = document.getElementById(`count-${postId}-${key}`);
                if (el) el.textContent = count;
            }
            restoreReactState(postId);
        }
    }

    /* ====== TOAST ====== */
    let toastTimer;
    function showToast(msg) {
        let toast = document.querySelector('.hd-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'hd-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    }

    /* ====== AUTO REFRESH ====== */
    let refreshInterval = null;
    function startAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(() => {
            if (!document.hidden) {
                loadAllCounts(true);
            }
        }, 60000);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
        } else {
            startAutoRefresh();
        }
    });

    /* ====== BOOT ====== */
    if (!PB_WORKER_URL) {
        document.querySelectorAll('.hd-count, .post-count').forEach(el => (el.textContent = '0'));
    } else {
        if (document.readyState === 'complete') {
            loadAllCounts();
        } else {
            window.addEventListener('load', loadAllCounts);
        }
        if (document.querySelector('.hd-react-btn, .post-react-btn')) {
            startAutoRefresh();
        }
    }

    // Gán sự kiện cho tất cả nút react (delegation)
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.hd-react-btn, .post-react-btn');
        if (btn) {
            e.preventDefault();
            handleReact(btn);
        }
    });

    // ====== CÁC CHỨC NĂNG CŨ (gallery, lightbox, filter) ======
    if (document.querySelector('.hd-card')) {
        let lbImages = [];
        let lbIndex = 0;
        const lightbox = document.getElementById('hdLightbox');
        const lbImg = document.getElementById('hdLbImg');
        const lbCap = document.getElementById('hdLbCaption');

        function openLightbox(images, index = 0) {
            lbImages = images;
            lbIndex = index;
            showLbImage();
            if (lightbox) {
                lightbox.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        }

        function closeLightbox() {
            if (lightbox) {
                lightbox.classList.remove('active');
                document.body.style.overflow = '';
            }
            if (lbImg) lbImg.src = '';
        }

        function showLbImage() {
            const item = lbImages[lbIndex] || {};
            if (lbImg) lbImg.src = item.src || '';
            if (lbCap) {
                lbCap.textContent = item.alt
                    ? `${item.alt}  (${lbIndex + 1} / ${lbImages.length})`
                    : `${lbIndex + 1} / ${lbImages.length}`;
            }
            const prevBtn = document.getElementById('hdLbPrev');
            const nextBtn = document.getElementById('hdLbNext');
            if (prevBtn) prevBtn.style.visibility = lbIndex > 0 ? 'visible' : 'hidden';
            if (nextBtn) nextBtn.style.visibility = lbIndex < lbImages.length - 1 ? 'visible' : 'hidden';
        }

        const lbClose = document.getElementById('hdLbClose');
        const lbPrev = document.getElementById('hdLbPrev');
        const lbNext = document.getElementById('hdLbNext');

        if (lbClose) lbClose.addEventListener('click', closeLightbox);
        if (lbPrev) lbPrev.addEventListener('click', () => {
            if (lbIndex > 0) { lbIndex--; showLbImage(); }
        });
        if (lbNext) lbNext.addEventListener('click', () => {
            if (lbIndex < lbImages.length - 1) { lbIndex++; showLbImage(); }
        });
        if (lightbox) {
            lightbox.addEventListener('click', e => {
                if (e.target === lightbox) closeLightbox();
            });
        }
        document.addEventListener('keydown', e => {
            if (!lightbox || !lightbox.classList.contains('active')) return;
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') { if (lbIndex > 0) { lbIndex--; showLbImage(); } }
            if (e.key === 'ArrowRight') { if (lbIndex < lbImages.length - 1) { lbIndex++; showLbImage(); } }
        });

        document.querySelectorAll('.hd-cover-img').forEach(img => {
            img.addEventListener('click', () => openLightbox([{ src: img.src, alt: img.alt }], 0));
        });

        document.querySelectorAll('.hd-pin').forEach(pin => {
            pin.addEventListener('click', () => {
                const img = pin.querySelector('img');
                if (img) {
                    openLightbox([{ src: img.src, alt: img.alt || pin.dataset.id }], 0);
                }
            });
        });

        // Biến cờ toàn cục để đảm bảo chỉ chạy 1 lần
        window._galleryLoaded = window._galleryLoaded || false;

        async function loadGalleryStrips() {
            if (window._galleryLoaded) {
                return;
            }
            window._galleryLoaded = true;

            const cards = document.querySelectorAll('.hd-card[data-postid]');

            for (const card of cards) {
                const link = card.querySelector('.hd-card-title a');
                const stripEl = card.querySelector('.hd-gallery-strip');
                if (!link || !stripEl) continue;

                stripEl.innerHTML = '';

                let isDown = false, startX, scrollLeft;
                stripEl.addEventListener('mousedown', (e) => {
                    isDown = true; stripEl.style.cursor = 'grabbing';
                    startX = e.pageX - stripEl.offsetLeft;
                    scrollLeft = stripEl.scrollLeft;
                });
                stripEl.addEventListener('mouseleave', () => { isDown = false; stripEl.style.cursor = ''; });
                stripEl.addEventListener('mouseup', () => { isDown = false; stripEl.style.cursor = ''; });
                stripEl.addEventListener('mousemove', (e) => {
                    if (!isDown) return;
                    e.preventDefault();
                    const x = e.pageX - stripEl.offsetLeft;
                    stripEl.scrollLeft = scrollLeft - (x - startX) * 2;
                });

                try {
                    const res = await fetch(link.href, { credentials: 'omit' });
                    if (!res.ok) continue;
                    const html = await res.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');

                    const contentArea = doc.querySelector('.gh-content, .post-content, .post-full-content, article') || doc.body;
                    const allImgs = contentArea.querySelectorAll('img');
                    const imgs = [];
                    allImgs.forEach(img => {
                        if (img.closest('.author-list') || img.closest('.hd-card-header') || img.closest('.hd-card-avatar')) return;
                        if (img.closest('.author-avatar') || img.closest('.gh-avatar')) return;
                        if (img.classList.contains('author-profile-image') || img.classList.contains('avatar')) return;
                        if (img.naturalWidth && img.naturalWidth < 80) return;
                        if (img.width && img.width < 50) return;
                        imgs.push(img);
                    });

                    if (imgs.length < 1) continue;

                    const featureImg = card.querySelector('.hd-cover-img');
                    const featureSrc = featureImg ? featureImg.src : null;

                    const addedBaseUrls = new Set();
                    let imageCount = 0;

                    imgs.forEach((img) => {
                        let src = img.getAttribute('src');
                        if (!src) return;

                        let baseSrc = src.replace(/\/size\/w\d+\//i, '/');
                        if (addedBaseUrls.has(baseSrc)) return;
                        addedBaseUrls.add(baseSrc);

                        if (featureSrc && baseSrc === featureSrc.replace(/\/size\/w\d+\//i, '/')) {
                            return;
                        }

                        const thumb = document.createElement('img');
                        thumb.src = src;
                        thumb.alt = img.alt || '';
                        thumb.loading = 'lazy';
                        thumb.ondragstart = () => false;

                        thumb.addEventListener('click', () => {
                            if (isDown) return;
                            const allImgs = [...stripEl.querySelectorAll('img')].map(i => ({ src: i.src, alt: i.alt }));
                            openLightbox(allImgs, allImgs.findIndex(i => i.src === thumb.src));
                        });

                        stripEl.appendChild(thumb);
                        imageCount++;
                    });
                } catch (err) {
                    // silent fail
                }
            }
        }
        loadGalleryStrips();

        document.querySelectorAll('.hd-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.hd-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tag = btn.dataset.tag;
                document.querySelectorAll('.hd-card').forEach(card => {
                    const tags = (card.dataset.tags || '').trim().split(/\s+/);
                    if (!tag || tags.includes(tag)) {
                        card.classList.remove('hd-hidden');
                    } else {
                        card.classList.add('hd-hidden');
                    }
                });
                document.querySelectorAll('.hd-pin').forEach(pin => {
                    const tags = (pin.dataset.tags || '').trim().split(/\s+/);
                    pin.style.display = (!tag || tags.includes(tag)) ? '' : 'none';
                });
            });
        });
    }

})();