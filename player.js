/**
 * player.js - YouTube IFrame Player wrapper with queue management
 * Handles playback, queue, shuffle, repeat, and Media Session API
 */

const MusicPlayer = (() => {
    // ===== STATE =====
    let ytPlayer = null;
    let audioPlayer = null;
    let isReady = false;
    let isPlaying = false;
    let isVideoMode = true; // Default to YT IFrame (always works). Song mode uses HTML5 Audio for background play.

    let queue = [];
    let currentIndex = -1;
    let shuffleMode = false;
    let repeatMode = 0; // 0: off, 1: all, 2: one
    let volume = 70;
    let currentTrack = null;
    let shuffledIndices = [];

    // User data
    let history = JSON.parse(localStorage.getItem('music_history') || '[]');
    let likedSongs = JSON.parse(localStorage.getItem('music_liked') || '[]');
    let playlists = JSON.parse(localStorage.getItem('music_playlists') || '[]');

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

        // Setup HTML5 Audio Player for background playback
        setupAudioPlayer();

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
                    controls: 1, // Enabled to allow quality selections
                    disablekb: 1,
                    fs: 1,       // Enabled to allow native Fullscreen switching
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

    function setupAudioPlayer() {
        audioPlayer = document.getElementById('native-audio-player');
        if (!audioPlayer) return;

        audioPlayer.volume = volume / 100;

        audioPlayer.addEventListener('play', () => {
            if (!isVideoMode) {
                isPlaying = true;
                startTimeUpdates();
                onStateChange({ playing: true, state: YT.PlayerState.PLAYING, track: currentTrack });
                updateMediaSession();
            }
        });

        audioPlayer.addEventListener('pause', () => {
            if (!isVideoMode) {
                isPlaying = false;
                stopTimeUpdates();
                onStateChange({ playing: false, state: YT.PlayerState.PAUSED, track: currentTrack });
                updateMediaSession();
            }
        });

        audioPlayer.addEventListener('ended', () => {
            if (!isVideoMode) {
                isPlaying = false;
                stopTimeUpdates();
                handleTrackEnd();
            }
        });

        audioPlayer.addEventListener('error', (e) => {
            if (!isVideoMode) {
                console.error('Audio Player Error:', e);
                onError(e);
                if (queue.length > 1) {
                    setTimeout(() => next(), 1000);
                }
            }
        });
        
        // Let audioPlayer handle its own timeupdates if possible, or we continue using our setInterval
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
        
        // Auto-switch to video mode for live streams (audio extraction usually fails for live)
        if (track.isLive) {
            isVideoMode = true;
            console.log('Live stream detected, switching to Video mode');
        }

        // Always load into YouTube Player (primary player)
        if (isReady && ytPlayer) {
            if (autoplay) {
                ytPlayer.loadVideoById(track.id);
            } else {
                ytPlayer.cueVideoById(track.id);
            }
        }

        // Pre-fetch audio URL for HTML5 Audio (background playback ready)
        // Skip for live streams as we want to stay in Video mode (YouTube IFrame)
        if (audioPlayer && !track.isLive) {
            fetchAudioUrl(track.id).then(audioUrl => {
                if (audioUrl && currentTrack && currentTrack.id === track.id) {
                    audioPlayer.src = audioUrl;
                    audioPlayer.load();
                    // If we're in audio mode and should autoplay, start audio & pause YT
                    if (autoplay && !isVideoMode) {
                        if (isReady && ytPlayer) ytPlayer.pauseVideo();
                        audioPlayer.play().catch(e => {
                            console.warn('Audio autoplay blocked, falling back to YT:', e);
                            // Fallback: switch to video mode
                            isVideoMode = true;
                            if (isReady && ytPlayer) ytPlayer.playVideo();
                        });
                    }
                }
            }).catch(err => {
                console.warn('Audio URL fetch failed, using YT IFrame:', err);
            });
        }

        onTrackChange(track);
        updateMediaSession();
        addToHistory(track);
        saveState();
    }

    async function fetchAudioUrl(videoId) {
        try {
            const res = await fetch(`/api/stream?id=${videoId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.url || null;
        } catch (e) {
            console.error('fetchAudioUrl error:', e);
            return null;
        }
    }

    function play() {
        if (!currentTrack && queue.length > 0) {
            currentIndex = 0;
            loadTrack(queue[0]);
            return;
        }

        if (isVideoMode) {
            if (audioPlayer) audioPlayer.pause();
            if (isReady && ytPlayer) ytPlayer.playVideo();
        } else {
            if (isReady && ytPlayer) ytPlayer.pauseVideo();
            if (audioPlayer && audioPlayer.src) audioPlayer.play().catch(e => console.error(e));
        }
    }

    function pause() {
        if (isReady && ytPlayer) ytPlayer.pauseVideo();
        if (audioPlayer) audioPlayer.pause();
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
        const currentMs = getCurrentTime();
        if (currentMs > 3) {
            seekTo(0);
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
        if (isReady && ytPlayer) ytPlayer.seekTo(time, true);
        if (audioPlayer && isFinite(audioPlayer.duration)) audioPlayer.currentTime = time;
    }

    function seekToPercent(percent) {
        const duration = getDuration() || 0;
        seekTo((percent / 100) * duration);
    }

    function setVolume(vol) {
        volume = Math.max(0, Math.min(100, vol));
        if (isReady && ytPlayer) {
            ytPlayer.setVolume(volume);
        }
        if (audioPlayer) {
            audioPlayer.volume = volume / 100;
        }
        saveState();
    }

    function getVolume() {
        return volume;
    }

    function toggleMute() {
        if (audioPlayer) {
            audioPlayer.muted = !audioPlayer.muted;
        }
        if (isReady && ytPlayer) {
            if (ytPlayer.isMuted()) {
                ytPlayer.unMute();
            } else {
                ytPlayer.mute();
            }
        }
    }

    function isMuted() {
        if (isVideoMode) return isReady && ytPlayer && ytPlayer.isMuted();
        if (audioPlayer) return audioPlayer.muted;
        return false;
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
        let lastTime = 0;

        function updateLoop(timestamp) {
            if (timestamp - lastTime >= 50) {
                lastTime = timestamp;
                let current = 0;
                let duration = 0;
                
                if (isVideoMode) {
                    if (isReady && ytPlayer && ytPlayer.getCurrentTime) {
                        current = ytPlayer.getCurrentTime() || 0;
                        duration = ytPlayer.getDuration() || 0;
                    }
                } else {
                    if (audioPlayer) {
                        current = audioPlayer.currentTime || 0;
                        duration = audioPlayer.duration || 0;
                        if (!isFinite(duration)) duration = 0;
                    }
                }

                onTimeUpdate({
                    current,
                    duration,
                    percent: duration > 0 ? (current / duration) * 100 : 0
                });
            }
            timeUpdateInterval = requestAnimationFrame(updateLoop);
        }

        timeUpdateInterval = requestAnimationFrame(updateLoop);
    }

    function stopTimeUpdates() {
        if (timeUpdateInterval) {
            cancelAnimationFrame(timeUpdateInterval);
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
        return [...history];
    }

    function clearHistory() {
        history = [];
        localStorage.setItem('music_history', '[]');
        syncToCloud('history', []);
    }

    // ===== LIKED SONGS =====

    function toggleLike(track) {
        const idx = likedSongs.findIndex(t => t.id === track.id);
        if (idx >= 0) {
            likedSongs.splice(idx, 1);
            localStorage.setItem('music_liked', JSON.stringify(likedSongs));
            syncToCloud('liked', likedSongs);
            return false;
        } else {
            likedSongs.unshift({
                id: track.id,
                title: track.title,
                artist: track.artist,
                thumbnail: track.thumbnail,
                duration: track.duration,
                durationText: track.durationText,
                likedAt: Date.now()
            });
            localStorage.setItem('music_liked', JSON.stringify(likedSongs));
            syncToCloud('liked', likedSongs);
            return true;
        }
    }

    function isLiked(trackId) {
        return likedSongs.some(t => t.id === trackId);
    }

    function getLikedSongs() {
        return [...likedSongs];
    }

    // ===== PLAYLISTS =====

    function getPlaylists() {
        return [...playlists];
    }

    function savePlaylists(newPlaylists, modifiedPlaylistId = null) {
        playlists = newPlaylists;
        localStorage.setItem('music_playlists', JSON.stringify(playlists));
        
        // Granular sync
        if (modifiedPlaylistId) {
            const pl = playlists.find(p => p.id === modifiedPlaylistId);
            if (pl) syncPlaylistToCloud(pl);
        } else {
            // Full sync (rare, e.g. after import)
            syncToCloud('playlists', playlists); // Fallback or handle loop
        }
    }

    function syncPlaylistToCloud(playlist) {
        if (!window.currentUser || !window.firebaseDb) return;
        const uid = window.currentUser.uid;
        localStorage.setItem('last_local_write', Date.now().toString());
        
        window.firebaseDb.collection('users').doc(uid)
            .collection('playlists').doc(playlist.id).set(playlist)
            .catch(err => console.error(`Error syncing playlist ${playlist.id}:`, err));
    }

    function deletePlaylistFromCloud(playlistId) {
        if (!window.currentUser || !window.firebaseDb) return;
        const uid = window.currentUser.uid;
        localStorage.setItem('last_local_write', Date.now().toString());
        
        window.firebaseDb.collection('users').doc(uid)
            .collection('playlists').doc(playlistId).delete()
            .catch(err => console.error(`Error deleting playlist ${playlistId}:`, err));
    }

    function createPlaylist(name) {
        const id = 'pl_' + Date.now();
        const newPl = {
            id,
            name,
            tracks: [],
            createdAt: Date.now()
        };
        playlists.push(newPl);
        savePlaylists(playlists, id);
        return id;
    }

    function deletePlaylist(playlistId) {
        playlists = playlists.filter(p => p.id !== playlistId);
        savePlaylists(playlists);
        deletePlaylistFromCloud(playlistId);
    }

    function renamePlaylist(playlistId, newName) {
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            pl.name = newName;
            savePlaylists(playlists, playlistId);
        }
    }

    function addToPlaylist(playlistId, track) {
        return addMultipleToPlaylist(playlistId, [track]);
    }

    function addMultipleToPlaylist(playlistId, tracks) {
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            let addedCount = 0;
            tracks.forEach(track => {
                if (!pl.tracks.some(t => t.id === track.id)) {
                    pl.tracks.push({
                        id: track.id,
                        title: track.title,
                        artist: track.artist,
                        thumbnail: track.thumbnail,
                        duration: track.duration,
                        durationText: track.durationText
                    });
                    addedCount++;
                }
            });
            if (addedCount > 0) {
                savePlaylists(playlists, playlistId);
                return true;
            }
        }
        return false;
    }

    function removeFromPlaylist(playlistId, trackId) {
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            pl.tracks = pl.tracks.filter(t => t.id !== trackId);
            savePlaylists(playlists, playlistId);
        }
    }

    function getPlaylist(playlistId) {
        return playlists.find(p => p.id === playlistId) || null;
    }

    // ===== USER DATA RELOAD =====
    function reloadUserData() {
        history = JSON.parse(localStorage.getItem('music_history') || '[]');
        likedSongs = JSON.parse(localStorage.getItem('music_liked') || '[]');
        playlists = JSON.parse(localStorage.getItem('music_playlists') || '[]');
    }

    // ===== CLOUD SYNC =====

    function syncToCloud(key, data) {
        if (!window.currentUser || !window.firebaseDb) return;
        
        const uid = window.currentUser.uid;
        const db = window.firebaseDb;
        
        // Flag local write to prevent immediate rebound sync from onSnapshot
        localStorage.setItem('last_local_write', Date.now().toString());
        
        if (key === 'playlists') {
            // Special case: Batch update or handled by granular sync
            // For now, if we call syncToCloud('playlists'), we update subcollections
            const batch = db.batch();
            const userRef = db.collection('users').doc(uid);
            data.forEach(pl => {
                const plRef = userRef.collection('playlists').doc(pl.id);
                batch.set(plRef, pl);
            });
            batch.commit().catch(err => console.error("Error batch syncing playlists:", err));
        } else {
            db.collection('users').doc(uid).set({
                [key]: data,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true })
            .catch(err => console.error(`Error syncing ${key} to cloud:`, err));
        }
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
        if (isVideoMode) return isReady && ytPlayer && ytPlayer.getDuration ? ytPlayer.getDuration() : 0;
        if (audioPlayer && isFinite(audioPlayer.duration)) return audioPlayer.duration;
        return 0;
    }

    function getCurrentTime() {
        if (isVideoMode) return isReady && ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
        if (audioPlayer) return audioPlayer.currentTime || 0;
        return 0;
    }

    function setVideoMode(isVideo) {
        if (isVideoMode === isVideo) return;
        
        const wasPlaying = isPlaying;
        const currentMs = getCurrentTime();
        
        isVideoMode = isVideo;
        
        // Sync time to the incoming player
        seekTo(currentMs);
        
        // Toggle play/pause correctly across players
        if (wasPlaying) {
            play();
        } else {
            pause();
        }
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
        addMultipleToPlaylist,
        removeFromPlaylist,
        getPlaylist,
        reloadUserData,
        setVideoMode
    };
})();
