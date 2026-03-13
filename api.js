/**
 * api.js - YouTube Music Search API via local server
 * Routes requests through server.js which uses ytsr for YouTube search
 */

const MusicAPI = (() => {
    // Local API base
    const API_BASE = window.location.origin + '/api';

    const cache = new Map();
    const CACHE_TTL = 5 * 60 * 1000;

    // ===== UTILITY =====

    function getCached(key) {
        const entry = cache.get(key);
        if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
        cache.delete(key);
        return null;
    }

    function setCache(key, data) {
        cache.set(key, { data, time: Date.now() });
        if (cache.size > 100) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
        }
    }

    async function fetchJSON(url, timeout = 20000, maxRetries = 2) {
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            try {
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(id);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (e) {
                clearTimeout(id);
                lastError = e;
                if (attempt < maxRetries) {
                    console.warn(`[Retry ${attempt + 1}/${maxRetries}] Fetch failed: ${url}`, e);
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
                }
            }
        }
        throw lastError;
    }

    // ===== HELPERS =====

    function getThumbnail(videoId, quality = 'medium') {
        const qualities = {
            default: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
            medium: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            high: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            max: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
        };
        return qualities[quality] || qualities.medium;
    }

    function extractVideoId(url) {
        if (!url) return null;
        const match = url.match(/(?:\/watch\?v=|\/v\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : url;
    }

    function formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function formatViews(views) {
        if (!views) return '';
        if (views >= 1e9) return (views / 1e9).toFixed(1) + ' tỷ lượt xem';
        if (views >= 1e6) return (views / 1e6).toFixed(1) + ' tr lượt xem';
        if (views >= 1e3) return (views / 1e3).toFixed(1) + 'N lượt xem';
        return views + ' lượt xem';
    }

    // ===== SEARCH =====

    async function search(query, filter = 'all') {
        if (!query || !query.trim()) return [];

        const cacheKey = `search:${query}:${filter}`;
        const cached = getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await fetchJSON(`${API_BASE}/search?q=${encodeURIComponent(query)}&filter=${filter}`);
            const results = Array.isArray(data) ? data : [];
            setCache(cacheKey, results);
            return results;
        } catch (e) {
            console.error('Search failed:', e);
            return [];
        }
    }

    // ===== SUGGESTIONS =====

    async function getSuggestions(query) {
        if (!query || query.trim().length < 2) return [];
        try {
            const data = await fetchJSON(`${API_BASE}/suggestions?query=${encodeURIComponent(query)}`);
            return Array.isArray(data) ? data : [];
        } catch (e) {
            return [];
        }
    }

    // ===== TRENDING =====

    async function getTrending(region = 'VN', type = 'youtube') {
        const cacheKey = `trending:${region}:${type}`;
        const cached = getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await fetchJSON(`${API_BASE}/trending?region=${region}&type=${type}`);
            const results = Array.isArray(data) ? data : [];
            setCache(cacheKey, results);
            return results;
        } catch (e) {
            console.error('Trending failed:', e);
            return [];
        }
    }

    // ===== VIDEO DETAILS (via search) =====

    async function getVideoDetails(videoId) {
        if (!videoId) return null;

        const cacheKey = `video:${videoId}`;
        const cached = getCached(cacheKey);
        if (cached) return cached;

        // Use search to find related videos
        try {
            const related = await search(videoId);
            const result = {
                id: videoId,
                relatedStreams: related.slice(0, 20)
            };
            setCache(cacheKey, result);
            return result;
        } catch (e) {
            return null;
        }
    }

    // ===== RELATED =====

    async function getRelated(videoId) {
        const details = await getVideoDetails(videoId);
        return details ? details.relatedStreams : [];
    }

    // ===== CATEGORIES =====

    async function searchCategory(category) {
        const queries = {
            'vpop': 'nhạc Việt Nam mới nhất hay nhất',
            'kpop': 'K-Pop hits trending',
            'usuk': 'US UK pop hits trending',
            'edm': 'EDM electronic dance music hits',
            'lofi': 'lofi hip hop chill beats study',
            'ballad': 'ballad Việt Nam hay nhất',
            'rap': 'rap Việt Nam mới nhất',
            'indie': 'indie music chill vibes',
            'acoustic': 'acoustic cover nhạc hay',
            'remix': 'nhạc remix EDM Việt Nam'
        };
        return search(queries[category] || category);
    }

    // ===== IMPORT PLAYLIST =====

    async function importPlaylist(url) {
        if (!url || !url.trim()) return null;
        try {
            const response = await fetch(`${API_BASE}/playlist?url=${encodeURIComponent(url.trim())}`);
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Link không hợp lệ hoặc lỗi kết nối');
            }
            return data;
        } catch (e) {
            console.error('Import playlist failed:', e);
            throw e;
        }
    }

    async function getChannel(channelId) {
        if (!channelId) return null;
        const cacheKey = `channel:${channelId}`;
        const cached = getCached(cacheKey);
        if (cached) return cached;

        try {
            const data = await fetchJSON(`${API_BASE}/channel?id=${encodeURIComponent(channelId)}`);
            setCache(cacheKey, data);
            return data;
        } catch (e) {
            console.error('Get channel failed:', e);
            return null;
        }
    }

    async function updateDiscordPresence(data) {
        // Use Electron IPC if available (desktop app)
        if (window.electronAPI && window.electronAPI.isElectron) {
            try {
                return await window.electronAPI.updateDiscordPresence(data);
            } catch (e) {
                return false;
            }
        }

        // Fallback to HTTP endpoint (localhost server)
        try {
            const params = new URLSearchParams();
            for (const key in data) {
                if (data[key] !== undefined && data[key] !== null) {
                    params.append(key, data[key]);
                }
            }
            const res = await fetch(`${API_BASE}/discord/presence?${params.toString()}`, { cache: 'no-store' });
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    // ===== PUBLIC API =====

    return {
        search,
        getSuggestions,
        getTrending,
        getVideoDetails,
        getRelated,
        searchCategory,
        getThumbnail,
        formatDuration,
        formatViews,
        extractVideoId,
        importPlaylist,
        getChannel,
        updateDiscordPresence
    };
})();
