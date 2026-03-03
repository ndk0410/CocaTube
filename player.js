/**
 * player.js - YouTube IFrame Player wrapper with queue management
 * Handles playback, queue, shuffle, repeat, and Media Session API
 */

const MusicPlayer = (() => {
    // ===== STATE =====
    let ytPlayer = null;
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

        // Load YouTube IFrame API
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);

        // Setup global callback
        window.onYouTubeIframeAPIReady = () => {
            const container = document.getElementById('yt-player-container');
            if (!container) {
                // Re-create the container if we deleted it
                const div = document.createElement('div');
                div.id = 'yt-player-container';
                div.style = 'position:fixed;bottom:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;';
                div.innerHTML = '<div id="yt-player"></div>';
                document.body.appendChild(div);
            }

            ytPlayer = new YT.Player('yt-player', {
                height: '1',
                width: '1',
                playerVars: {
                    autoplay: 0,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    modestbranding: 1,
                    rel: 0,
                    showinfo: 0,
                    origin: window.location.origin
                },
                events: {
                    onReady: handlePlayerReady,
                    onStateChange: handleStateChange,
                    onError: handleError
                }
            });
        };
    }

    function handlePlayerReady() {
        isReady = true;
        ytPlayer.setVolume(volume);
        onReady();

        // Resume last track if saved
        if (currentTrack) {
            onTrackChange(currentTrack);
        }
    }

    function handleStateChange(event) {
        const state = event.data;

        switch (state) {
            case YT.PlayerState.PLAYING:
                isPlaying = true;
                startTimeUpdates();
                break;
            case YT.PlayerState.PAUSED:
                isPlaying = false;
                stopTimeUpdates();
                break;
            case YT.PlayerState.ENDED:
                isPlaying = false;
                stopTimeUpdates();
                handleTrackEnd();
                break;
            case YT.PlayerState.BUFFERING:
                break;
        }

        onStateChange({
            playing: isPlaying,
            state: state,
            track: currentTrack
        });

        updateMediaSession();
    }

    function handleError(event) {
        console.error('YouTube Player Error:', event.data);
        onError(event.data);

        // Try next track on error
        if (queue.length > 1) {
            setTimeout(() => next(), 1000);
        }
    }

    // ===== PLAYBACK CONTROLS =====

    function loadTrack(track, autoplay = true) {
        if (!track || !track.id) return;

        currentTrack = track;

        if (isReady && ytPlayer) {
            if (autoplay) {
                ytPlayer.loadVideoById(track.id);
            } else {
                ytPlayer.cueVideoById(track.id);
            }
        }

        onTrackChange(track);
        updateMediaSession();
        addToHistory(track);
        saveState();
    }

    function play() {
        if (!isReady || !ytPlayer) return;

        if (!currentTrack && queue.length > 0) {
            currentIndex = 0;
            loadTrack(queue[0]);
            return;
        }

        ytPlayer.playVideo();
    }

    function pause() {
        if (!isReady || !ytPlayer) return;
        ytPlayer.pauseVideo();
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
        if (isReady && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getCurrentTime() > 3) {
            ytPlayer.seekTo(0);
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
        if (!isReady || !ytPlayer) return;
        ytPlayer.seekTo(time, true);
    }

    function seekToPercent(percent) {
        if (!isReady || !ytPlayer) return;
        const duration = ytPlayer.getDuration() || 0;
        seekTo((percent / 100) * duration);
    }

    function setVolume(vol) {
        volume = Math.max(0, Math.min(100, vol));
        if (isReady && ytPlayer) {
            ytPlayer.setVolume(volume);
        }
        saveState();
    }

    function getVolume() {
        return volume;
    }

    function toggleMute() {
        if (!isReady || !ytPlayer) return;
        if (ytPlayer.isMuted()) {
            ytPlayer.unMute();
        } else {
            ytPlayer.mute();
        }
    }

    function isMuted() {
        return isReady && ytPlayer && ytPlayer.isMuted();
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
            if (!isReady || !ytPlayer || !ytPlayer.getCurrentTime) return;
            const current = ytPlayer.getCurrentTime() || 0;
            const duration = ytPlayer.getDuration() || 0;
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
        syncToCloud('history', history);
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
        syncToCloud('history', []);
    }

    // ===== LIKED SONGS =====

    function toggleLike(track) {
        let liked = getLikedSongs();
        const idx = liked.findIndex(t => t.id === track.id);
        if (idx >= 0) {
            liked.splice(idx, 1);
            localStorage.setItem('music_liked', JSON.stringify(liked));
            syncToCloud('liked', liked);
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
            syncToCloud('liked', liked);
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
        syncToCloud('playlists', playlists);
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

    // ===== CLOUD SYNC =====

    function syncToCloud(key, data) {
        if (!window.currentUser || !window.firebaseDb) return;
        
        const uid = window.currentUser.uid;
        const db = window.firebaseDb;
        
        db.collection('users').doc(uid).set({
            [key]: data,
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
        .catch(err => console.error(`Error syncing ${key} to cloud:`, err));
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
        if (!isReady || !ytPlayer || !ytPlayer.getDuration) return 0;
        return ytPlayer.getDuration();
    }

    function getCurrentTime() {
        if (!isReady || !ytPlayer || !ytPlayer.getCurrentTime) return 0;
        return ytPlayer.getCurrentTime();
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
