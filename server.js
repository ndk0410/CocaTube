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
    ytdl = require('ytdl-core');
} catch (e) { 
    console.error('ytsr/ytpl/ytdl-core not installed. Run: npm install ytsr ytpl ytdl-core'); 
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
async function handleTrending(region) {
    const cacheKey = `trending:${region}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    if (!ytsr) throw new Error('ytsr not available');

    // Simulate trending by searching for popular music
    const queries = [
        'nhạc trending Việt Nam mới nhất',
        'bài hát hot nhất hiện nay'
    ];

    let allResults = [];
    for (const q of queries) {
        try {
            const results = await ytsr(q, { limit: 20 });
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
        } catch (e) {
            console.error(`[API] Trending search failed for "${q}":`, e.message);
        }
    }

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

    const cacheKey = `playlist:${url}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const playlistId = await ytpl.getPlaylistID(url);
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
        throw new Error('Link playlist không hợp lệ hoặc playlist ở chế độ riêng tư');
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

    // Special handling for audio streaming which doesn't return JSON
    if (pathname === '/api/stream') {
        const videoId = params.id;
        if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing video id parameter' }));
            return;
        }
        
        if (!ytdl) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ytdl-core not available' }));
            return;
        }

        try {
            // Tell the browser this is an audio stream, and support partial content blocks
            res.setHeader('Content-Type', 'audio/webm');
            
            // Pipe the audio stream directly to the response
            ytdl(`http://www.youtube.com/watch?v=${videoId}`, {
                filter: 'audioonly',
                quality: 'highestaudio',
                highWaterMark: 1 << 25 // 32MB buffer
            })
            .on('error', (err) => {
                console.error(`[STREAM ERROR] ${videoId}:`, err.message);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: err.message }));
                }
            })
            .pipe(res);
            
            console.log(`[API] Streaming audio for ${videoId}`);
        } catch (err) {
            console.error(`[STREAM SETUP ERROR] ${videoId}:`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return; // Don't continue to the JSON handler below
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
            data = await handleTrending(region);
            console.log(`[API] Trending (${region}) → ${data.length} results`);

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
