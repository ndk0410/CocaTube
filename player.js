/**
 * player.js - YouTube IFrame Player wrapper with queue management
 * Handles playback, queue, shuffle, repeat, and Media Session API
 */

const MusicPlayer = (() => {
    // ===== STATE =====
    const INVIDIOUS_INSTANCES = [
        'https://inv.tux.pizza',
        'https://vid.priv.au',
        'https://invidious.jing.rocks',
        'https://invidious.nerdvpn.de',
        'https://invidious.protokolla.fi'
    ];
    let currentInstanceIndex = 0;

    let audioElement = new Audio();
    let isReady = false;
    let isPlaying = false;

    let queue = [];
    let currentIndex = -1;
    let shuffleMode = false;
    let repeatMode = 0; // 0: off, 1: all, 2: one
    let volume = 70;
    let currentTrack = null;
    let shuffledIndices = [];

    // Callbacks
    let onStateChange = null;
    let onTrackChange = null;
    let onTimeUpdate = null;
    let onReady = null;
    let onError = null;

    // Timer
    let timeUpdateInterval = null;

    // ===== INIT =====

    function init(callbacks = {}) {
        onStateChange = callbacks.onStateChange || (() => {});
        onTrackChange = callbacks.onTrackChange || (() => {});
        onTimeUpdate = callbacks.onTimeUpdate || (() => {});
        onReady = callbacks.onReady || (() => {});
        onError = callbacks.onError || (() => {});

        // Load saved state
        loadState();

        // Setup HTML5 Audio Element
        audioElement.volume = volume / 100;
        
        audioElement.addEventListener('play', () => {
            isPlaying = true;
            onStateChange({ playing: true, state: 1, track: currentTrack });
            updateMediaSession();
            startTimeUpdates();
        });

        audioElement.addEventListener('pause', () => {
            isPlaying = false;
            onStateChange({ playing: false, state: 2, track: currentTrack });
            updateMediaSession();
            stopTimeUpdates();
        });

        audioElement.addEventListener('ended', () => {
            isPlaying = false;
            stopTimeUpdates();
            handleTrackEnd();
        });

        audioElement.addEventListener('error', (e) => {
            console.error('Audio Player Error on instance:', INVIDIOUS_INSTANCES[currentInstanceIndex]);
            
            // Try next instance before giving up
            currentInstanceIndex++;
            if (currentInstanceIndex < INVIDIOUS_INSTANCES.length && currentTrack) {
                console.log(`Trying fallback instance: ${INVIDIOUS_INSTANCES[currentInstanceIndex]}`);
                const audioUrl = `${INVIDIOUS_INSTANCES[currentInstanceIndex]}/latest_version?id=${currentTrack.id}&itag=140`;
                audioElement.src = audioUrl;
                audioElement.load();
                audioElement.play().catch(err => console.error('Fallback play prevented:', err));
                return;
            }

            // All instances failed, move to next track
            currentInstanceIndex = 0; // Reset for next track
            onError(audioElement.error);
            if (queue.length > 1) {
                setTimeout(() => next(), 1000);
            }
        });

        audioElement.addEventListener('loadedmetadata', () => {
            // Audio is ready to play
        });

        // Set ready state
        isReady = true;
        onReady();

        // Resume last track if saved
        if (currentTrack) {
            onTrackChange(currentTrack);
        }
    }

    // ===== PLAYBACK CONTROLS =====

    function loadTrack(track, autoplay = true) {
        if (!track || !track.id) return;

        currentTrack = track;
        currentInstanceIndex = 0; // Reset instance index on new track

        if (isReady) {
            // Source stream from a public Invidious instance (itag=140 is m4a 128kbps audio only)
            const audioUrl = `${INVIDIOUS_INSTANCES[currentInstanceIndex]}/latest_version?id=${track.id}&itag=140`;
            audioElement.src = audioUrl;
            audioElement.load();

            if (autoplay) {
                audioElement.play().catch(e => console.error('Play prevented:', e));
            }
        }

        onTrackChange(track);
        updateMediaSession();
        addToHistory(track);
        saveState();
    }

    function play() {
        if (!isReady) return;

        if (!currentTrack && queue.length > 0) {
            currentIndex = 0;
            loadTrack(queue[0]);
            return;
        }

        audioElement.play().catch(e => console.error('Play error:', e));
    }

    function pause() {
        if (!isReady) return;
        audioElement.pause();
    }

    function togglePlay() {
        if (isPlaying) {
            pause();
        } else {
            play();
        }
    }

    function next() {
        if (queue.length === 0) return;

        if (shuffleMode) {
            const nextShuffleIdx = getNextShuffleIndex();
            currentIndex = nextShuffleIdx;
        } else {
            currentIndex++;
            if (currentIndex >= queue.length) {
                if (repeatMode === 1) {
                    currentIndex = 0;
                } else {
                    currentIndex = queue.length - 1;
                    pause();
                    return;
                }
            }
        }

        loadTrack(queue[currentIndex]);
    }

    function previous() {
        if (queue.length === 0) return;

        // If more than 3 seconds in, restart current track
        if (isReady && audioElement.currentTime > 3) {
            audioElement.currentTime = 0;
            return;
        }

        if (shuffleMode) {
            const prevShuffleIdx = getPrevShuffleIndex();
            currentIndex = prevShuffleIdx;
        } else {
            currentIndex--;
            if (currentIndex < 0) {
                if (repeatMode === 1) {
                    currentIndex = queue.length - 1;
                } else {
                    currentIndex = 0;
                }
            }
        }

        loadTrack(queue[currentIndex]);
    }

    function seekTo(time) {
        if (!isReady) return;
        audioElement.currentTime = time;
    }

    function seekToPercent(percent) {
        if (!isReady) return;
        let duration = audioElement.duration || 0;
        // Fallback to track data if audio hasn't fully loaded metadata
        if ((!duration || isNaN(duration) || duration === Infinity) && currentTrack) {
            duration = currentTrack.duration || 0;
        }
        audioElement.currentTime = (percent / 100) * duration;
    }

    function setVolume(vol) {
        volume = Math.max(0, Math.min(100, vol));
        if (isReady) {
            audioElement.volume = volume / 100;
        }
        saveState();
    }

    function getVolume() {
        return volume;
    }

    function toggleMute() {
        if (!isReady) return;
        audioElement.muted = !audioElement.muted;
    }

    function isMuted() {
        return isReady && audioElement.muted;
    }

    // ===== TRACK END HANDLING =====

    function handleTrackEnd() {
        if (repeatMode === 2) {
            // Repeat one
            seekTo(0);
            play();
            return;
        }

        next();
    }

    // ===== TIME UPDATES =====

    function startTimeUpdates() {
        stopTimeUpdates();
        timeUpdateInterval = setInterval(() => {
            if (!isReady) return;
            const current = audioElement.currentTime || 0;
            let duration = audioElement.duration || 0;
            if ((!duration || isNaN(duration) || duration === Infinity) && currentTrack) {
                duration = currentTrack.duration || 0;
            }
            onTimeUpdate({
                current,
                duration,
                percent: duration > 0 ? (current / duration) * 100 : 0
            });
        }, 250);
    }

    function stopTimeUpdates() {
        if (timeUpdateInterval) {
            clearInterval(timeUpdateInterval);
            timeUpdateInterval = null;
        }
    }

    // ===== QUEUE MANAGEMENT =====

    function playTrack(track) {
        // If track is already in queue, just switch to it
        const existingIndex = queue.findIndex(t => t.id === track.id);
        if (existingIndex >= 0) {
            currentIndex = existingIndex;
            loadTrack(queue[currentIndex]);
            return;
        }

        // Add to queue and play
        queue.splice(currentIndex + 1, 0, track);
        currentIndex++;
        loadTrack(track);
        saveState();
    }

    function playAll(tracks, startIndex = 0) {
        if (!tracks || tracks.length === 0) return;
        queue = [...tracks];
        currentIndex = startIndex;
        generateShuffleIndices();
        loadTrack(queue[currentIndex]);
        saveState();
    }

    function addToQueue(track) {
        queue.push(track);
        generateShuffleIndices();
        saveState();
    }

    function addNextInQueue(track) {
        queue.splice(currentIndex + 1, 0, track);
        generateShuffleIndices();
        saveState();
    }

    function removeFromQueue(index) {
        if (index < 0 || index >= queue.length) return;

        queue.splice(index, 1);

        if (index < currentIndex) {
            currentIndex--;
        } else if (index === currentIndex) {
            if (currentIndex >= queue.length) {
                currentIndex = queue.length - 1;
            }
            if (currentIndex >= 0 && queue.length > 0) {
                loadTrack(queue[currentIndex]);
            }
        }

        generateShuffleIndices();
        saveState();
    }

    function clearQueue() {
        queue = [];
        currentIndex = -1;
        currentTrack = null;
        shuffledIndices = [];
        saveState();
    }

    function getQueue() {
        return [...queue];
    }

    function getCurrentIndex() {
        return currentIndex;
    }

    function getCurrentTrack() {
        return currentTrack;
    }

    // ===== SHUFFLE =====

    function toggleShuffle() {
        shuffleMode = !shuffleMode;
        if (shuffleMode) {
            generateShuffleIndices();
        }
        saveState();
        return shuffleMode;
    }

    function generateShuffleIndices() {
        shuffledIndices = Array.from({ length: queue.length }, (_, i) => i);
        // Fisher-Yates shuffle
        for (let i = shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
        }
    }

    function getNextShuffleIndex() {
        const currentShufflePos = shuffledIndices.indexOf(currentIndex);
        const nextPos = (currentShufflePos + 1) % shuffledIndices.length;
        return shuffledIndices[nextPos];
    }

    function getPrevShuffleIndex() {
        const currentShufflePos = shuffledIndices.indexOf(currentIndex);
        const prevPos = (currentShufflePos - 1 + shuffledIndices.length) % shuffledIndices.length;
        return shuffledIndices[prevPos];
    }

    // ===== REPEAT =====

    function toggleRepeat() {
        repeatMode = (repeatMode + 1) % 3;
        saveState();
        return repeatMode;
    }

    function getRepeatMode() {
        return repeatMode;
    }

    function getShuffleMode() {
        return shuffleMode;
    }

    // ===== MEDIA SESSION API =====

    function updateMediaSession() {
        if (!('mediaSession' in navigator) || !currentTrack) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: currentTrack.title,
            artist: currentTrack.artist,
            artwork: [
                { src: currentTrack.thumbnail, sizes: '320x180', type: 'image/jpeg' },
                { src: MusicAPI.getThumbnail(currentTrack.id, 'high'), sizes: '480x360', type: 'image/jpeg' }
            ]
        });

        navigator.mediaSession.setActionHandler('play', play);
        navigator.mediaSession.setActionHandler('pause', pause);
        navigator.mediaSession.setActionHandler('previoustrack', previous);
        navigator.mediaSession.setActionHandler('nexttrack', next);
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            seekTo(details.seekTime);
        });
    }

    // ===== HISTORY =====

    function addToHistory(track) {
        let history = getHistory();
        // Remove duplicate
        history = history.filter(t => t.id !== track.id);
        // Add to beginning
        history.unshift({
            id: track.id,
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail,
            duration: track.duration,
            durationText: track.durationText,
            playedAt: Date.now()
        });
        // Limit to 100
        history = history.slice(0, 100);
        localStorage.setItem('music_history', JSON.stringify(history));
    }

    function getHistory() {
        try {
            return JSON.parse(localStorage.getItem('music_history') || '[]');
        } catch {
            return [];
        }
    }

    function clearHistory() {
        localStorage.setItem('music_history', '[]');
    }

    // ===== LIKED SONGS =====

    function toggleLike(track) {
        let liked = getLikedSongs();
        const idx = liked.findIndex(t => t.id === track.id);
        if (idx >= 0) {
            liked.splice(idx, 1);
            localStorage.setItem('music_liked', JSON.stringify(liked));
            return false;
        } else {
            liked.unshift({
                id: track.id,
                title: track.title,
                artist: track.artist,
                thumbnail: track.thumbnail,
                duration: track.duration,
                durationText: track.durationText,
                likedAt: Date.now()
            });
            localStorage.setItem('music_liked', JSON.stringify(liked));
            return true;
        }
    }

    function isLiked(trackId) {
        return getLikedSongs().some(t => t.id === trackId);
    }

    function getLikedSongs() {
        try {
            return JSON.parse(localStorage.getItem('music_liked') || '[]');
        } catch {
            return [];
        }
    }

    // ===== PLAYLISTS =====

    function getPlaylists() {
        try {
            return JSON.parse(localStorage.getItem('music_playlists') || '[]');
        } catch {
            return [];
        }
    }

    function savePlaylists(playlists) {
        localStorage.setItem('music_playlists', JSON.stringify(playlists));
    }

    function createPlaylist(name) {
        const playlists = getPlaylists();
        const id = 'pl_' + Date.now();
        playlists.push({
            id,
            name,
            tracks: [],
            createdAt: Date.now()
        });
        savePlaylists(playlists);
        return id;
    }

    function deletePlaylist(playlistId) {
        let playlists = getPlaylists();
        playlists = playlists.filter(p => p.id !== playlistId);
        savePlaylists(playlists);
    }

    function renamePlaylist(playlistId, newName) {
        const playlists = getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            pl.name = newName;
            savePlaylists(playlists);
        }
    }

    function addToPlaylist(playlistId, track) {
        const playlists = getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            // Avoid duplicates
            if (!pl.tracks.some(t => t.id === track.id)) {
                pl.tracks.push({
                    id: track.id,
                    title: track.title,
                    artist: track.artist,
                    thumbnail: track.thumbnail,
                    duration: track.duration,
                    durationText: track.durationText
                });
                savePlaylists(playlists);
                return true;
            }
        }
        return false;
    }

    function removeFromPlaylist(playlistId, trackId) {
        const playlists = getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            pl.tracks = pl.tracks.filter(t => t.id !== trackId);
            savePlaylists(playlists);
        }
    }

    function getPlaylist(playlistId) {
        return getPlaylists().find(p => p.id === playlistId) || null;
    }

    // ===== PERSISTENCE =====

    function saveState() {
        const state = {
            queue: queue.slice(0, 50), // Limit saved queue
            currentIndex,
            volume,
            shuffleMode,
            repeatMode,
            currentTrack
        };
        localStorage.setItem('music_player_state', JSON.stringify(state));
    }

    function loadState() {
        try {
            const state = JSON.parse(localStorage.getItem('music_player_state'));
            if (state) {
                queue = state.queue || [];
                currentIndex = state.currentIndex ?? -1;
                volume = state.volume ?? 70;
                shuffleMode = state.shuffleMode ?? false;
                repeatMode = state.repeatMode ?? 0;
                currentTrack = state.currentTrack || null;
                if (shuffleMode) generateShuffleIndices();
            }
        } catch {
            // Ignore
        }
    }

    // ===== GETTERS =====

    function getIsPlaying() {
        return isPlaying;
    }

    function getIsReady() {
        return isReady;
    }

    function getDuration() {
        if (!isReady) return 0;
        let duration = audioElement.duration || 0;
        if ((!duration || isNaN(duration) || duration === Infinity) && currentTrack) {
            duration = currentTrack.duration || 0;
        }
        return duration;
    }

    function getCurrentTime() {
        if (!isReady) return 0;
        return audioElement.currentTime || 0;
    }

    // ===== PUBLIC API =====

    return {
        init,
        play,
        pause,
        togglePlay,
        next,
        previous,
        seekTo,
        seekToPercent,
        setVolume,
        getVolume,
        toggleMute,
        isMuted,
        loadTrack,
        playTrack,
        playAll,
        addToQueue,
        addNextInQueue,
        removeFromQueue,
        clearQueue,
        getQueue,
        getCurrentIndex,
        getCurrentTrack,
        toggleShuffle,
        getShuffleMode,
        toggleRepeat,
        getRepeatMode,
        getIsPlaying,
        getIsReady,
        getDuration,
        getCurrentTime,
        getHistory,
        clearHistory,
        toggleLike,
        isLiked,
        getLikedSongs,
        getPlaylists,
        createPlaylist,
        deletePlaylist,
        renamePlaylist,
        addToPlaylist,
        removeFromPlaylist,
        getPlaylist
    };
})();
