/**
 * server.js - Local development server with YouTube search API
 * Uses ytsr (YouTube Search) for reliable music search
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let ytsr, ytpl, ytdl;
try { 
    ytsr = require('ytsr'); 
    ytpl = require('ytpl');
    ytdl = require('@distube/ytdl-core');
} catch (e) { 
    console.error('Dependencies not installed. Run: npm install ytsr ytpl @distube/ytdl-core'); 
}

const PORT = 3000;

// MIME types
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff'
};

// Simple in-memory cache
const apiCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
    const entry = apiCache.get(key);
    if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
    apiCache.delete(key);
    return null;
}

function setCache(key, data) {
    apiCache.set(key, { data, time: Date.now() });
    if (apiCache.size > 200) {
        const first = apiCache.keys().next().value;
        apiCache.delete(first);
    }
}

// ===== API HANDLERS =====

// Search YouTube
async function handleSearch(query, filter) {
    const cacheKey = `search:${query}:${filter}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    if (!ytsr) throw new Error('ytsr not available');

    const options = { limit: 30 };
    const searchQuery = filter === 'music_songs' ? `${query} music` : query;

    const results = await ytsr(searchQuery, options);

    const items = results.items
        .filter(item => item.type === 'video')
        .map(item => ({
            id: item.id,
            title: item.title || 'Không có tiêu đề',
            artist: item.author ? item.author.name : 'Không rõ nghệ sĩ',
            duration: parseDuration(item.duration),
            durationText: item.duration || '0:00',
            thumbnail: item.bestThumbnail ? item.bestThumbnail.url : `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
            views: item.views || 0,
            uploaded: item.uploadedAt || '',
            uploaderUrl: item.author ? item.author.url : ''
        }));

    setCache(cacheKey, items);
    return items;
}

// Trending (search-based since ytsr doesn't have trending endpoint)
async function handleTrending(region, type = 'youtube') {
    const cacheKey = `trending:${region}:${type}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    if (!ytsr) throw new Error('ytsr not available');

    // Simulate trending by searching for popular music based on type
    const queries = type === 'tiktok' 
        ? ['nhạc tiktok mới nhất 2026', 'tiktok trending music việt nam', 'top nhạc tiktok remix'] 
        : ['nhạc trending Việt Nam mới nhất', 'bài hát hot nhất hiện nay', 'youtube music trending vietnam'];

    let allResults = [];
    const resultsArr = await Promise.all(queries.map(q => 
        ytsr(q, { limit: 20 }).catch(e => {
            console.error(`[API] Trending search failed for "${q}":`, e.message);
            return { items: [] };
        })
    ));

    resultsArr.forEach(results => {
        const items = results.items
            .filter(item => item.type === 'video')
            .map(item => ({
                id: item.id,
                title: item.title || 'Không có tiêu đề',
                artist: item.author ? item.author.name : 'Không rõ nghệ sĩ',
                duration: parseDuration(item.duration),
                durationText: item.duration || '0:00',
                thumbnail: item.bestThumbnail ? item.bestThumbnail.url : `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
                views: item.views || 0,
                uploaded: item.uploadedAt || '',
                uploaderUrl: item.author ? item.author.url : ''
            }));
        allResults = allResults.concat(items);
    });

    // Remove duplicates
    const seen = new Set();
    allResults = allResults.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });

    setCache(cacheKey, allResults);
    return allResults;
}

// Search suggestions
async function handleSuggestions(query) {
    if (!ytsr) throw new Error('ytsr not available');

    const cacheKey = `suggest:${query}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const results = await ytsr.getFilters(query);
        const suggestions = [];
        // Return the query itself as suggestion since ytsr doesn't have autocomplete
        suggestions.push(query);
        setCache(cacheKey, suggestions);
        return suggestions;
    } catch (e) {
        return [query];
    }
}

// Fetch Playlist by URL
async function handlePlaylist(url) {
    if (!ytpl) throw new Error('ytpl not available');

    // Clean URL
    let cleanUrl = url.trim();
    
    const cacheKey = `playlist:${cleanUrl}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        let playlistId;
        if (ytpl.validateID(cleanUrl)) {
            playlistId = cleanUrl;
        } else {
            try {
                playlistId = await ytpl.getPlaylistID(cleanUrl);
            } catch (e) {
                // Fallback: manual extraction if ytpl helper fails
                const match = cleanUrl.match(/[?&]list=([^#\&\?]+)/);
                if (match) playlistId = match[1];
                else throw e;
            }
        }

        const playlist = await ytpl(playlistId, { limit: 100 });
        
        const data = {
            id: playlist.id,
            title: playlist.title,
            author: playlist.author ? playlist.author.name : 'Unknown',
            items: playlist.items.map(item => ({
                id: item.id,
                title: item.title,
                artist: item.author ? item.author.name : 'Unknown',
                duration: parseDuration(item.duration),
                durationText: item.duration || '0:00',
                thumbnail: item.bestThumbnail ? item.bestThumbnail.url : `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
            }))
        };

        setCache(cacheKey, data);
        return data;
    } catch (e) {
        console.error('handlePlaylist error:', e);
        if (e.message && e.message.includes('private')) {
            throw new Error('Playlist này đang ở chế độ riêng tư, không thể lấy dữ liệu');
        }
        throw new Error('Link playlist không hợp lệ hoặc không tìm thấy nội dung');
    }
}

// Parse duration string "3:45" or "1:02:30" to seconds
function parseDuration(str) {
    if (!str) return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

// ===== REQUEST ROUTER =====

async function handleApiRequest(req, res, parsedUrl) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    const pathname = parsedUrl.pathname;
    const params = parsedUrl.query || {};

    // Special handling for audio URL extraction
    if (pathname === '/api/stream') {
        const videoId = params.id;
        if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing video id parameter' }));
            return;
        }
        
        if (!ytdl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '@distube/ytdl-core not available' }));
            return;
        }

        // Check cache first
        const cacheKey = `stream:${videoId}`;
        const cached = getCached(cacheKey);
        if (cached) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(cached));
            return;
        }

        try {
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const info = await ytdl.getInfo(videoUrl);
            
            // Pick the best audio-only format, preferring m4a/mp4 for iOS compatibility
            const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
            
            // Sort: prefer mp4/m4a over webm, then by bitrate
            const sorted = audioFormats.sort((a, b) => {
                const aIsMp4 = a.container === 'mp4' || a.container === 'm4a' ? 1 : 0;
                const bIsMp4 = b.container === 'mp4' || b.container === 'm4a' ? 1 : 0;
                if (aIsMp4 !== bIsMp4) return bIsMp4 - aIsMp4;
                return (b.audioBitrate || 0) - (a.audioBitrate || 0);
            });

            const bestFormat = sorted[0];
            if (!bestFormat || !bestFormat.url) {
                throw new Error('No audio format found');
            }

            const result = { 
                url: bestFormat.url, 
                contentType: bestFormat.mimeType || 'audio/mp4',
                duration: parseInt(info.videoDetails.lengthSeconds) || 0
            };
            setCache(cacheKey, result);
            
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
            console.log(`[API] Audio URL for ${videoId} (${bestFormat.container}, ${bestFormat.audioBitrate}kbps)`);
        } catch (err) {
            console.error(`[STREAM ERROR] ${videoId}:`, err.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        }
        return;
    }

    // Default JSON handler for other endpoints
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
        let data;

        if (pathname === '/api/search') {
            const query = params.q || '';
            const filter = params.filter || 'music_songs';
            if (!query) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing query parameter: q' }));
                return;
            }
            data = await handleSearch(query, filter);
            console.log(`[API] Search "${query}" → ${data.length} results`);

        } else if (pathname === '/api/trending') {
            const region = params.region || 'VN';
            const type = params.type || 'youtube';
            data = await handleTrending(region, type);
            console.log(`[API] Trending (${region}, ${type}) → ${data.length} results`);

        } else if (pathname === '/api/suggestions') {
            const query = params.query || params.q || '';
            data = await handleSuggestions(query);

        } else if (pathname === '/api/playlist') {
            const url = params.url || '';
            if (!url) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing url parameter' }));
                return;
            }
            data = await handlePlaylist(url);
            console.log(`[API] Fetch Playlist → ${data.title} (${data.items.length} items)`);

        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        res.writeHead(200);
        res.end(JSON.stringify(data));

    } catch (e) {
        console.error(`[API ERROR] ${pathname}:`, e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
    }
}

// ===== STATIC FILE SERVER =====

function handleStaticFile(req, res, parsedUrl) {
    let filePath = parsedUrl.pathname;
    if (filePath === '/') filePath = '/index.html';

    // Security: prevent path traversal
    const fullPath = path.resolve(path.join(__dirname, filePath));
    if (!fullPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Server Error');
            }
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// ===== EXPORT FOR VERCEL & RUN LOCALLY =====

const requestHandler = async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // API routes
    if (parsedUrl.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, parsedUrl);
        return;
    }

    // Static files
    handleStaticFile(req, res, parsedUrl);
};

// Export for Vercel serverless function
module.exports = requestHandler;

// Only start the server locally if not running on Vercel
if (!process.env.VERCEL) {
    const server = http.createServer(requestHandler);
    server.listen(PORT, () => {
        console.log(`
🎵 MusicFlow Server running at http://localhost:${PORT}

   Static files: ./
   API endpoints:
     GET /api/search?q=QUERY&filter=music_songs
     GET /api/trending?region=VN
     GET /api/suggestions?query=QUERY
`);
    });
}
