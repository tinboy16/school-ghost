/**
 * van-ban.js — Văn bản Công văn
 *
 * Luồng hoạt động:
 *  1. Đọc dữ liệu JSON từ #vb-raw-data (được Ghost render sẵn)
 *  2. Với mỗi post: gọi Ghost Content API để lấy html, parse ra link PDF đầu tiên
 *  3. Dựng bảng, bộ lọc, phân trang
 *
 * Cấu hình dưới đây — chỉnh nếu cần:
 */

(function () {
    'use strict';

    /* ========== CẤU HÌNH ========== */
    const PER_PAGE  = 15;                     // Số hàng mỗi trang
    const TAG_SKIP  = ['van-ban', 'van ban']; // Tag gốc — loại bỏ khi hiện badge

    /* ========== STATE ========== */
    let allRows     = [];  // Toàn bộ dữ liệu sau khi parse
    let filtered    = [];  // Sau khi lọc
    let currentPage = 1;

    /* ========== DOM ========== */
    const body       = document.getElementById('vbBody');
    const emptyBox   = document.getElementById('vbEmpty');
    const statsEl    = document.getElementById('vbStats');
    const pagination = document.getElementById('vbPagination');
    const pageInfo   = document.getElementById('vbPageInfo');
    const prevBtn    = document.getElementById('vbPrev');
    const nextBtn    = document.getElementById('vbNext');
    const searchEl   = document.getElementById('vbSearch');
    const loaiEl     = document.getElementById('vbLoai');
    const yearEl     = document.getElementById('vbYear');
    const modal      = document.getElementById('pdfModal');
    const iframe     = document.getElementById('pdfViewer');
    const closeBtn   = document.getElementById('closePdf');
    const dlLink     = document.getElementById('downloadPdf');
    const pdfTitle   = document.getElementById('pdfModalTitle');
    const pdfLoading = document.getElementById('pdfLoading');
    const pdfInfo    = document.getElementById('pdfFileInfo');

    /* ========== BADGE CLASS ========== */
    function badgeClass(label) {
        const map = {
            'quyết định': 'type-quyetdinh',
            'quyet dinh': 'type-quyetdinh',
            'công văn'  : 'type-congvan',
            'cong van'  : 'type-congvan',
            'thông báo' : 'type-thongbao',
            'thong bao' : 'type-thongbao',
            'kế hoạch'  : 'type-kethoach',
            'ke hoach'  : 'type-kethoach',
            'báo cáo'   : 'type-baocao',
            'bao cao'   : 'type-baocao',
            'hướng dẫn' : 'type-huongdan',
            'huong dan' : 'type-huongdan',
        };
        const key = label.toLowerCase().trim();
        return map[key] || '';
    }

    /* ========== PARSE DỮ LIỆU THÔ TỪ GHOST ========== */
    function getRawData() {
        try {
            const el = document.getElementById('vb-raw-data');
            if (!el) return [];
            return JSON.parse(el.textContent || '[]');
        } catch (e) {
            console.error('[van-ban] JSON parse error:', e);
            return [];
        }
    }

    /* ========== LẤY LINK PDF TỪ GHOST CONTENT API ========== */
    /**
     * Ghost File Card render thành:
     *   <div class="kg-card kg-file-card">
     *     <a class="kg-file-card-container" href="...pdf">...</a>
     *   </div>
     *
     * Ưu tiên:
     *   1. .kg-file-card-container[href$=".pdf"]   — File Card chính thức
     *   2. a[href$=".pdf"] trong vùng nội dung bài — link thường
     */
    async function fetchPdfUrl(postUrl) {
        try {
            const resp = await fetch(postUrl, { credentials: 'omit' });
            if (!resp.ok) return null;
            const html = await resp.text();
            const parser = new DOMParser();
            const doc    = parser.parseFromString(html, 'text/html');

            // Ưu tiên 1: Ghost File Card
            const fileCard = doc.querySelector(
                '.kg-file-card-container[href], .kg-file-card a[href]'
            );
            if (fileCard) {
                const href = fileCard.getAttribute('href') || '';
                if (/\.pdf(\?.*)?$/i.test(href)) {
                    return new URL(href, postUrl).href;
                }
            }

            // Ưu tiên 2: Bất kỳ thẻ <a> nào trỏ đến .pdf
            // Tìm trong vùng nội dung bài, tránh header/nav/footer
            const contentEl = doc.querySelector(
                '.gh-content, .post-content, .e-content, article, main'
            ) || doc.body;

            const links = contentEl.querySelectorAll('a[href]');
            for (const a of links) {
                const href = a.getAttribute('href') || '';
                if (/\.pdf(\?.*)?$/i.test(href)) {
                    return new URL(href, postUrl).href;
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /* ========== LÀM SẠCH EXCERPT ========== */
    /**
     * Ghost đôi khi tự động lấy text của File Card vào excerpt.
     * Nếu excerpt trông như tên file (có .pdf, hoặc quá dài) → trả về ''
     */
    function cleanExcerpt(raw) {
        if (!raw) return '';
        const s = raw.trim();
        // Chứa đuôi file hoặc dài hơn 60 ký tự → không phải số văn bản
        if (/\.pdf|\.docx|\.xlsx/i.test(s)) return '';
        if (s.length > 60) return '';
        return s;
    }

    /* ========== KHỞI TẠO DỮ LIỆU ========== */
    async function init() {
        const raw = getRawData();
        if (!raw.length) {
            showEmpty();
            statsEl.textContent = 'Chưa có văn bản nào.';
            return;
        }

        // Chuyển raw → enriched (thêm pdfUrl sẽ fetch sau)
        allRows = raw.map(p => {
            // trim() từng tag trước — tránh whitespace do Handlebars xuống dòng
            const loaiTags = (p.tags || []).map(t => t.trim()).filter(t =>
                t && !TAG_SKIP.includes(t.toLowerCase())
            );
            // Chuẩn hoá: capitalize chữ đầu để "công văn" = "Công văn"
            const rawLoai = (loaiTags[0] || '').trim();
            const loai = rawLoai
                ? rawLoai.charAt(0).toUpperCase() + rawLoai.slice(1)
                : '';
            return {
                id          : p.id,
                title       : p.title || '(Không có tiêu đề)',
                excerpt     : cleanExcerpt(p.excerpt),
                url         : p.url,
                date        : p.published_at || '',
                year        : (p.published_at || '').slice(0, 4),
                loai,
                pdfUrl      : null,
                pdfFetched  : false,
            };
        });

        // Sắp xếp mới nhất trước
        allRows.sort((a, b) => b.date.localeCompare(a.date));

        // Điền dropdowns
        buildDropdowns();

        // Render lần đầu (chưa có PDF URL)
        filtered = [...allRows];
        render();

        statsEl.textContent = `Đang tải thông tin tài liệu cho ${allRows.length} văn bản...`;

        // Fetch PDF URLs song song (tối đa 5 cùng lúc để không quá tải)
        await batchFetch(allRows, 5);

        // Render lại sau khi có PDF
        render();
        updateStats();
    }

    async function batchFetch(rows, concurrency) {
        let idx = 0;
        async function worker() {
            while (idx < rows.length) {
                const row = rows[idx++];
                if (!row.pdfFetched) {
                    row.pdfUrl     = await fetchPdfUrl(row.url);
                    row.pdfFetched = true;
                    // Cập nhật nút PDF ngay khi có kết quả
                    updateRowBtn(row);
                }
            }
        }
        const workers = Array.from({ length: concurrency }, worker);
        await Promise.all(workers);
    }

    function updateRowBtn(row) {
        const btn = document.querySelector(`[data-post-id="${row.id}"]`);
        if (!btn) return;
        if (row.pdfUrl) {
            btn.classList.remove('no-pdf');
            btn.textContent = '👁 Xem';
            btn.onclick = () => openPdf(row.pdfUrl, row.title);
        } else {
            btn.classList.add('no-pdf');
            btn.textContent = 'Không có PDF';
        }
    }

    /* ========== BUILD DROPDOWNS ========== */
function buildDropdowns() {
    // 1. Xóa hết option cũ
    loaiEl.innerHTML = '<option value="">Tất cả loại văn bản</option>';
    yearEl.innerHTML  = '<option value="">Tất cả năm</option>';

    // 2. Loại — dedup bằng Map
    const loaiMap = new Map();
    allRows.forEach(r => {
        if (r.loai) loaiMap.set(r.loai.toLowerCase(), r.loai);
    });
    const loais = [...loaiMap.values()].sort((a, b) => a.localeCompare(b, 'vi'));
    loais.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.toLowerCase();
        opt.textContent = l;
        loaiEl.appendChild(opt);
    });

    // 3. Năm
    const years = [...new Set(allRows.map(r => r.year).filter(Boolean))].sort().reverse();
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearEl.appendChild(opt);
    });
}
    /* ========== LỌC ========== */
    function applyFilter() {
        const q    = (searchEl.value || '').toLowerCase().trim();
        const loai = loaiEl.value;
        const year = yearEl.value;

        filtered = allRows.filter(r => {
            if (loai && r.loai.toLowerCase() !== loai) return false;
            if (year && r.year !== year) return false;
            if (q) {
                const hay = (r.title + ' ' + r.excerpt).toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        currentPage = 1;
        render();
        updateStats();
    }

    /* ========== RENDER BẢNG ========== */
    function render() {
        const start = (currentPage - 1) * PER_PAGE;
        const page  = filtered.slice(start, start + PER_PAGE);

        if (!filtered.length) {
            body.innerHTML = '';
            emptyBox.style.display = 'block';
            pagination.style.display = 'none';
            return;
        }

        emptyBox.style.display = 'none';

        body.innerHTML = page.map((r, i) => {
            const dateStr  = formatDate(r.date);
            const badge    = r.loai
                ? `<span class="vb-badge ${badgeClass(r.loai)}">${esc(r.loai)}</span>`
                : '<span class="vb-badge">—</span>';

            const btnClass = r.pdfFetched && r.pdfUrl ? '' : (r.pdfFetched ? 'no-pdf' : '');
            const btnLabel = !r.pdfFetched ? '⏳' : (r.pdfUrl ? '👁 Xem' : 'Không có PDF');

            return `<tr>
                <td><span class="vb-doc-number">${esc(r.excerpt) || '—'}</span></td>
                <td>
                    <div class="vb-title"><a href="${esc(r.url)}">${esc(r.title)}</a></div>
                    <div class="vb-mobile-meta">${dateStr}</div>
                </td>
                <td>${badge}</td>
                <td class="col-date"><span class="vb-date">${dateStr}</span></td>
                <td class="col-pdf-cell">
                    <button
                        class="vb-view-btn ${btnClass}"
                        data-post-id="${esc(r.id)}"
                        ${r.pdfFetched && r.pdfUrl ? `onclick="window.vbOpenPdf('${esc(r.pdfUrl)}', '${esc(r.title).replace(/'/g,"\\'")}')"`
                          : r.pdfFetched ? 'disabled' : ''}
                    >${btnLabel}</button>
                </td>
            </tr>`;
        }).join('');

        // Phân trang
        const total = Math.ceil(filtered.length / PER_PAGE);
        pagination.style.display = total > 1 ? 'flex' : 'none';
        pageInfo.textContent = `Trang ${currentPage} / ${total}`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= total;
    }

    function updateStats() {
        const total   = allRows.length;
        const showing = filtered.length;
        statsEl.textContent = showing < total
            ? `Hiển thị ${showing} / ${total} văn bản`
            : `Tổng cộng ${total} văn bản`;
    }

    /* ========== HELPERS ========== */
    function formatDate(iso) {
        if (!iso) return '—';
        const [y, m, d] = iso.split('-');
        return `${d || '??'}/${m || '??'}/${y || '????'}`;
    }

    function esc(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showEmpty() {
        body.innerHTML = '';
        emptyBox.style.display = 'block';
        pagination.style.display = 'none';
    }

    /* ========== PHÂN TRANG ========== */
    window.vbChangePage = function (dir) {
        const total = Math.ceil(filtered.length / PER_PAGE);
        currentPage = Math.max(1, Math.min(total, currentPage + dir));
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    /* ========== RESET BỘ LỌC ========== */
    window.vbReset = function () {
        searchEl.value = '';
        loaiEl.value   = '';
        yearEl.value   = '';
        applyFilter();
    };

    /* ========== MODAL PDF ========== */
    window.vbOpenPdf = function (url, title) {
        openPdf(url, title);
    };

    function openPdf(url, title) {
        pdfTitle.textContent = title || 'Xem văn bản';
        dlLink.href = url;

        // Lấy tên file từ URL
        try {
            const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
            pdfInfo.textContent = name;
        } catch (_) {
            pdfInfo.textContent = '';
        }

        // Reset iframe & show loading
        iframe.src = '';
        pdfLoading.style.display = 'flex';

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Load PDF vào iframe
        // Google Docs Viewer là fallback nếu trình duyệt không hỗ trợ nhúng PDF
        iframe.onload = () => {
            pdfLoading.style.display = 'none';
        };

        // Thử nhúng trực tiếp trước
        iframe.src = url;

        // Nếu sau 4s vẫn chưa load, thử qua Google Docs Viewer
        const fallbackTimer = setTimeout(() => {
            if (pdfLoading.style.display !== 'none') {
                const encoded = encodeURIComponent(url);
                iframe.src = `https://docs.google.com/viewer?url=${encoded}&embedded=true`;
            }
        }, 4000);

        iframe.onload = () => {
            clearTimeout(fallbackTimer);
            pdfLoading.style.display = 'none';
        };
    }

    function closePdf() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        iframe.src = '';
        pdfLoading.style.display = 'flex';
    }

    closeBtn.addEventListener('click', closePdf);

    modal.addEventListener('click', e => {
        if (e.target === modal) closePdf();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closePdf();
    });

    /* ========== EVENT LISTENERS ========== */
    let searchTimer;
    searchEl.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilter, 280);
    });
    loaiEl.addEventListener('change', applyFilter);
    yearEl.addEventListener('change', applyFilter);

    /* ========== BOOT ========== */
    init();

})();