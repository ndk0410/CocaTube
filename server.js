/**
 * server.js - Local development server with YouTube search API
 * Uses ytsr (YouTube Search) for reliable music search
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const DiscordRPC = require('discord-rpc');

// Discord RPC Configuration
const DISCORD_CLIENT_ID = '1216346215017254952'; // Generic Music Client ID
let rpcClient = null;
let rpcReady = false;

function initDiscordRPC() {
    if (rpcClient) return;
    
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' });
    
    rpcClient.on('ready', () => {
        console.log('[DISCORD] Rich Presence is ready');
        rpcReady = true;
    });

    rpcClient.on('disconnected', () => {
        console.log('[DISCORD] Disconnected. Reconnecting in 15s...');
        rpcReady = false;
        rpcClient = null;
        setTimeout(initDiscordRPC, 15000);
    });

    rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
        console.warn('[DISCORD] Failed to connect to Discord RPC. Is Discord open?');
        rpcClient = null;
        rpcReady = false;
        // Try again in 30s
        setTimeout(initDiscordRPC, 30000);
    });
}

// Start Discord RPC attempt
if (!process.env.VERCEL) {
    initDiscordRPC();
}

// Gzip helper: compress response if client supports it
function sendCompressed(req, res, statusCode, headers, body) {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (acceptEncoding.includes('gzip')) {
        zlib.gzip(body, (err, compressed) => {
            if (err) { res.writeHead(statusCode, headers); res.end(body); return; }
            headers['Content-Encoding'] = 'gzip';
            headers['Vary'] = 'Accept-Encoding';
            res.writeHead(statusCode, headers);
            res.end(compressed);
        });
    } else {
        res.writeHead(statusCode, headers);
        res.end(body);
    }
}

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
    const searchQuery = query;

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
            isLive: item.isLive || item.duration === null || item.durationText === '0:00',
            uploaded: item.uploadedAt || '',
            uploaderUrl: item.author ? item.author.url : '',
            uploaderId: item.author ? item.author.channelID : ''
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

    // Simulate trending by searching for popular content based on type
    const queries = type === 'tiktok' 
        ? ['nhạc tiktok mới nhất 2026', 'tiktok trending music việt nam', 'top nhạc tiktok remix'] 
        : ['xu hướng youtube việt nam mới nhất', 'video hot nhất hiện nay', 'youtube trending vietnam'];

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
                isLive: item.isLive || item.duration === null || item.durationText === '0:00',
                uploaded: item.uploadedAt || '',
                uploaderUrl: item.author ? item.author.url : '',
                uploaderId: item.author ? item.author.channelID : ''
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

// Channel Uploads
async function handleChannel(channelId) {
    if (!channelId) throw new Error('Missing channel id');
    
    const cacheKey = `channel:${channelId}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        let actualChannelId = channelId;
        const play = require('play-dl');
        
        // If it doesn't look like a standard YouTube Channel ID (UC...), resolve it
        if (!channelId.startsWith('UC')) {
            try {
                // If it's likely a video ID (11 chars), use ytdl to get author channel
                if (channelId.length === 11 && !channelId.startsWith('@')) {
                    const info = await ytdl.getBasicInfo(channelId);
                    if (info && info.videoDetails && info.videoDetails.author) {
                        actualChannelId = info.videoDetails.author.id;
                    }
                } else {
                    // It's a handle or name, use play-dl search for channel
                    const searchResults = await play.search(channelId, { limit: 1, source: { youtube: 'channel' } });
                    if (searchResults && searchResults.length > 0) {
                        actualChannelId = searchResults[0].id;
                    }
                }
            } catch (resolveErr) {
                console.warn(`Resolution failed for ${channelId}:`, resolveErr);
            }
        }

        // Ensure we got a valid ID starting with UC
        if (!actualChannelId || !actualChannelId.startsWith('UC')) {
            throw new Error(`Invalid or unresolved channel ID: ${actualChannelId}`);
        }

        // Youtubers' Uploads playlist ID is generally UU + channel ID characters after UC
        const uploadsPlaylistId = 'UU' + actualChannelId.substring(2);

        // Fetch playlist using play-dl (bypass ytpl token issues)
        const pl = await play.playlist_info(uploadsPlaylistId, { incomplete: true });
        const videos = await pl.all_videos();
        
        let channelName = pl.channel && pl.channel.name ? pl.channel.name : 'Unknown';
        let channelAvatar = null;
        let subscriberCount = null;
        let channelBanner = null;

        // Extract high-quality avatar and sub count from the first video via ytdl-core
        if (videos.length > 0) {
            try {
                const firstVideoInfo = await ytdl.getBasicInfo(videos[0].url);
                const author = firstVideoInfo.videoDetails.author;
                if (author) {
                    channelName = author.name || channelName;
                    channelAvatar = author.thumbnails && author.thumbnails.length > 0 ? author.thumbnails[author.thumbnails.length - 1].url : null;
                    subscriberCount = author.subscriber_count;
                }
            } catch (e) {
                console.warn('Failed to fetch detailed author info from first video, using defaults');
            }
        }

        const data = {
            title: channelName,
            thumbnail: channelAvatar || (pl.thumbnail ? pl.thumbnail.url : null),
            banner: channelBanner || null,
            subscriberCount: subscriberCount,
            items: videos.slice(0, 50).map(item => ({
                id: item.id,
                title: item.title,
                artist: channelName,
                duration: item.durationInSec || 0,
                durationText: item.durationRaw || '0:00',
                thumbnail: item.thumbnails && item.thumbnails.length > 0 ? item.thumbnails[0].url : `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
                isLive: item.isLive || item.durationInSec === 0,
                uploaderId: actualChannelId,
                uploaderUrl: `https://www.youtube.com/channel/${actualChannelId}`
            }))
        };

        setCache(cacheKey, data);
        return data;
    } catch (e) {
        console.error('handleChannel error:', e);
        throw new Error('Không thể tải dữ liệu kênh hoặc ID không hợp lệ');
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

        } else if (pathname === '/api/channel') {
            const channelId = params.id || '';
            if (!channelId) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Missing id parameter' }));
                return;
            }
            data = await handleChannel(channelId);
            console.log(`[API] Fetch Channel → ${data.title} (${data.items.length} items)`);

        } else if (pathname === '/api/discord/presence') {
            if (!rpcReady || !rpcClient) {
                res.writeHead(503);
                res.end(JSON.stringify({ error: 'Discord RPC not ready' }));
                return;
            }

            const { details, state, largeImageKey, startTimestamp, endTimestamp, type } = params;
            
            try {
                if (type === 'clear') {
                    await rpcClient.clearActivity();
                } else {
                    await rpcClient.setActivity({
                        details: details || 'Đang nghe nhạc',
                        state: state || 'CocaTube',
                        largeImageKey: largeImageKey || 'logo',
                        largeImageText: 'CocaTube Music',
                        smallImageKey: 'play',
                        smallImageText: 'Playing',
                        startTimestamp: startTimestamp ? parseInt(startTimestamp) : undefined,
                        endTimestamp: endTimestamp ? parseInt(endTimestamp) : undefined,
                        instance: false,
                    });
                }
                data = { success: true };
            } catch (rpcErr) {
                console.error('[DISCORD] RPC error:', rpcErr.message);
                throw rpcErr;
            }
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        const jsonBody = JSON.stringify(data);
        sendCompressed(req, res, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Connection': 'keep-alive' }, Buffer.from(jsonBody));

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

        let cacheControl = 'no-cache';
        if (ext === '.jpg' || ext === '.png' || ext === '.svg' || ext === '.woff2') {
            cacheControl = 'public, max-age=604800'; // Cache for 7 days
        }

        const headers = { 
            'Content-Type': contentType,
            'Cache-Control': cacheControl,
            'Connection': 'keep-alive'
        };

        // Compress text-based files (HTML, CSS, JS, JSON, SVG)
        const compressible = ['.html', '.css', '.js', '.json', '.svg'];
        if (compressible.includes(ext)) {
            sendCompressed(req, res, 200, headers, data);
        } else {
            res.writeHead(200, headers);
            res.end(data);
        }
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
