/**
 * app.js - Main Application Controller
 * Handles UI rendering, routing, event delegation, and state management
 */

const App = (() => {
    // ===== DOM ELEMENTS =====
    const $ = (id) => document.getElementById(id);
    const dom = {};

    // ===== STATE =====
    let currentPage = 'home';
    let searchDebounceTimer = null;
    let isSearchActive = false;
    let trendingData = [];
    let contextMenuEl = null;
    let isPlayingContextPlaylist = false; // Flag to stop auto-queuing random suggestions when playing a User Playlist
    let unsubscribeSnapshot = null; // Store Firestore real-time listener

    // ===== INIT =====

    function init() {
        cacheDom();
        initPlayer();
        bindEvents();
        restorePlayerUI();
        navigateTo('home');
    }

    function cacheDom() {
        // Header
        dom.header = $('header');
        dom.menuToggle = $('menu-toggle');
        dom.logoLink = $('logo-link');
        dom.searchInput = $('search-input');
        dom.searchContainer = $('search-container');
        dom.searchClearBtn = $('search-clear-btn');
        dom.searchBackBtn = $('search-back-btn');
        dom.mobileSearchBtn = $('mobile-search-btn');

        // Sidebar
        dom.sidebar = $('sidebar');

        // Content
        dom.mainContent = $('main-content');
        dom.pageContainer = $('page-container');
        dom.loadingContainer = $('loading-container');

        // Player bar
        dom.playerBar = $('player-bar');
        dom.playerThumbnail = $('player-thumbnail');
        dom.playerSongTitle = $('player-song-title');
        dom.playerSongArtist = $('player-song-artist');
        dom.playerEqualizer = $('player-equalizer');
        dom.playerLikeBtn = $('player-like-btn');
        dom.playBtn = $('play-btn');
        dom.prevBtn = $('prev-btn');
        dom.nextBtn = $('next-btn');
        dom.shuffleBtn = $('shuffle-btn');
        dom.repeatBtn = $('repeat-btn');
        dom.progressBar = $('progress-bar');
        dom.currentTime = $('current-time');
        dom.totalTime = $('total-time');
        dom.volumeBtn = $('volume-btn');
        dom.volumeSlider = $('volume-slider');
        dom.queueBtn = $('queue-btn');
        dom.playerSongInfo = $('player-song-info');

        // Queue
        dom.queuePanel = $('queue-panel');
        dom.queueOverlay = $('queue-overlay');
        dom.queueCloseBtn = $('queue-close-btn');
        dom.queueList = $('queue-list');

        // Fullscreen Player
        dom.fullscreenPlayer = $('fullscreen-player');
        dom.fsCloseBtn = $('fs-close-btn');
        dom.fsModeSongBtn = $('fs-mode-song');
        dom.fsModeVideoBtn = $('fs-mode-video');
        dom.ytPlayerContainer = $('yt-player-container');
        dom.fsThumbnail = $('fs-thumbnail');
        dom.fsSongTitle = $('fs-song-title');
        dom.fsSongArtist = $('fs-song-artist');
        dom.fsPlayBtn = $('fs-play-btn');
        dom.fsPrevBtn = $('fs-prev-btn');
        dom.fsNextBtn = $('fs-next-btn');
        dom.fsShuffleBtn = $('fs-shuffle-btn');
        dom.fsRepeatBtn = $('fs-repeat-btn');
        dom.fsProgressBar = $('fs-progress-bar');
        dom.fsCurrentTime = $('fs-current-time');
        dom.fsTotalTime = $('fs-total-time');
        dom.fsLikeBtn = $('fs-like-btn');
        dom.fsQueueBtn = $('fs-queue-btn');
        dom.fullscreenPlayerBtn = $('fullscreen-player-btn');

        // Auth & User Profile
        dom.headerLoginBtn = $('header-login-btn');
        dom.userProfile = $('user-profile');
        dom.userAvatar = $('user-avatar');
        dom.userDropdown = $('user-dropdown');
        dom.userNameDisplay = $('user-name-display');
        dom.userEmailDisplay = $('user-email-display');
        dom.logoutBtn = $('logout-btn');
        dom.loginModal = $('login-modal');
        dom.closeLoginModal = $('close-login-modal');
        dom.googleLoginBtn = $('google-login-btn');

        // Toast
        dom.toastContainer = $('toast-container');
    }

    // ===== PLAYER INIT =====

    function initPlayer() {
        MusicPlayer.init({
            onReady: () => {
                console.log('YouTube Player ready');
            },
            onStateChange: (state) => {
                updatePlayButton(state.playing);
            },
            onTrackChange: (track) => {
                updatePlayerUI(track);
                updateQueueUI();

                // Fetch related for auto-play
                loadRelated(track.id);
            },
            onTimeUpdate: (time) => {
                updateTimeUI(time);
            },
            onError: (code) => {
                showToast('Không thể phát bài này. Đang thử bài tiếp theo...');
            }
        });
    }

    // ===== EVENT BINDING =====

    function bindEvents() {
        // Search
        dom.searchInput.addEventListener('input', handleSearchInput);
        dom.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                performSearch(dom.searchInput.value);
            }
        });
        dom.searchClearBtn.addEventListener('click', () => {
            dom.searchInput.value = '';
            dom.searchClearBtn.classList.remove('visible');
            dom.searchInput.focus();
        });
        dom.mobileSearchBtn.addEventListener('click', openMobileSearch);
        dom.searchBackBtn.addEventListener('click', closeMobileSearch);

        // Voice Search
        dom.voiceSearchBtn = $('voice-search-btn');
        if (dom.voiceSearchBtn) {
            dom.voiceSearchBtn.addEventListener('click', () => {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) {
                    showToast('Trình duyệt của bạn không hỗ trợ tìm kiếm bằng giọng nói.');
                    return;
                }
                
                const recognition = new SpeechRecognition();
                recognition.lang = 'vi-VN'; // Support Vietnamese
                recognition.interimResults = false;
                recognition.maxAlternatives = 1;

                recognition.onstart = () => {
                    dom.voiceSearchBtn.style.color = 'var(--accent)';
                    dom.voiceSearchBtn.classList.add('pulse-anim');
                    showToast('Đang nghe...');
                };

                recognition.onspeechend = () => {
                    recognition.stop();
                };

                recognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript;
                    dom.searchInput.value = transcript;
                    dom.searchClearBtn.classList.add('visible');
                    // Automatically trigger search
                    performSearch(transcript);
                };

                recognition.onerror = (event) => {
                    dom.voiceSearchBtn.style.color = '';
                    dom.voiceSearchBtn.classList.remove('pulse-anim');
                    showToast('Không nhận diện được giọng nói.');
                };

                recognition.onend = () => {
                    dom.voiceSearchBtn.style.color = '';
                    dom.voiceSearchBtn.classList.remove('pulse-anim');
                };

                recognition.start();
            });
        }

        // Navigation
        document.querySelectorAll('[data-page]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(el.dataset.page);
            });
        });

        dom.logoLink.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('home');
        });

        // Sidebar toggle
        dom.menuToggle.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                // Desktop: Toggle mini sidebar
                document.body.classList.toggle('sidebar-mini');
            } else {
                // Mobile: Toggle slide-in menu
                dom.sidebar.classList.toggle('open');
            }
        });

        // Close sidebar on content click (tablet)
        dom.mainContent.addEventListener('click', () => {
            dom.sidebar.classList.remove('open');
        });

        // Player Controls
        dom.playBtn.addEventListener('click', () => MusicPlayer.togglePlay());
        dom.prevBtn.addEventListener('click', () => MusicPlayer.previous());
        dom.nextBtn.addEventListener('click', () => MusicPlayer.next());

        dom.shuffleBtn.addEventListener('click', () => {
            const mode = MusicPlayer.toggleShuffle();
            dom.shuffleBtn.classList.toggle('active', mode);
            dom.fsShuffleBtn.classList.toggle('active', mode);
            showToast(mode ? 'Phát ngẫu nhiên BẬT' : 'Phát ngẫu nhiên TẮT');
        });

        dom.repeatBtn.addEventListener('click', handleRepeatToggle);

        // Progress bar
        dom.progressBar.addEventListener('input', (e) => {
            MusicPlayer.seekToPercent(parseFloat(e.target.value));
        });

        // Volume
        dom.volumeSlider.addEventListener('input', (e) => {
            MusicPlayer.setVolume(parseInt(e.target.value));
            updateVolumeIcon(parseInt(e.target.value));
        });
        dom.volumeBtn.addEventListener('click', () => {
            MusicPlayer.toggleMute();
            const muted = MusicPlayer.isMuted();
            updateVolumeIcon(muted ? 0 : MusicPlayer.getVolume());
        });

        // Queue
        dom.queueBtn.addEventListener('click', toggleQueue);
        dom.queueCloseBtn.addEventListener('click', closeQueue);
        dom.queueOverlay.addEventListener('click', closeQueue);

        // Like
        dom.playerLikeBtn.addEventListener('click', handleLikeToggle);

        // Fullscreen Player (Mobile)
        dom.playerSongInfo.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && MusicPlayer.getCurrentTrack()) {
                openFullscreenPlayer();
            }
        });
        dom.fullscreenPlayerBtn.addEventListener('click', () => {
            if (MusicPlayer.getCurrentTrack()) openFullscreenPlayer();
        });
        dom.fsCloseBtn.addEventListener('click', closeFullscreenPlayer);
        
        if(dom.fsModeSongBtn) dom.fsModeSongBtn.addEventListener('click', () => setVideoMode(false));
        if(dom.fsModeVideoBtn) dom.fsModeVideoBtn.addEventListener('click', () => setVideoMode(true));
        
        dom.fsPlayBtn.addEventListener('click', () => MusicPlayer.togglePlay());
        dom.fsPrevBtn.addEventListener('click', () => MusicPlayer.previous());
        dom.fsNextBtn.addEventListener('click', () => MusicPlayer.next());
        dom.fsShuffleBtn.addEventListener('click', () => {
            const mode = MusicPlayer.toggleShuffle();
            dom.shuffleBtn.classList.toggle('active', mode);
            dom.fsShuffleBtn.classList.toggle('active', mode);
        });
        dom.fsRepeatBtn.addEventListener('click', handleRepeatToggle);
        dom.fsProgressBar.addEventListener('input', (e) => {
            MusicPlayer.seekToPercent(parseFloat(e.target.value));
        });
        dom.fsLikeBtn.addEventListener('click', handleLikeToggle);
        dom.fsQueueBtn.addEventListener('click', () => {
            closeFullscreenPlayer();
            setTimeout(toggleQueue, 300);
        });

        // Content click delegation
        dom.pageContainer.addEventListener('click', handleContentClick);
        dom.queueList.addEventListener('click', handleQueueClick);

        // Context menu
        dom.pageContainer.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('click', () => removeContextMenu());

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboard);

        // Close sidebar overlay on resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) {
                dom.sidebar.classList.remove('open');
            }
        });

        // ===== AUTHENTICATION EVENTS =====
        dom.headerLoginBtn.addEventListener('click', () => {
            dom.loginModal.classList.remove('hidden');
        });

        dom.closeLoginModal.addEventListener('click', () => {
            dom.loginModal.classList.add('hidden');
        });

        dom.userAvatar.addEventListener('click', (e) => {
            e.stopPropagation();
            dom.userDropdown.classList.toggle('hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dom.userProfile.contains(e.target)) {
                dom.userDropdown.classList.add('hidden');
            }
            if (e.target === dom.loginModal) {
                dom.loginModal.classList.add('hidden');
            }
        });

        dom.googleLoginBtn.addEventListener('click', handleGoogleLogin);
        dom.logoutBtn.addEventListener('click', handleLogout);

        // Initialize Firebase Auth Listener
        initAuth();
    }

    // ===== UI MODE TOGGLES =====
    
    function setVideoMode(isVideo) {
        if (!dom.fsModeSongBtn || !dom.fsModeVideoBtn || !dom.ytPlayerContainer) return;
        
        // Cache fsArtwork if not already in dom object
        if (!dom.fsArtwork) dom.fsArtwork = document.querySelector('.fs-artwork');
        
        if (isVideo) {
            dom.fsModeSongBtn.classList.remove('active');
            dom.fsModeVideoBtn.classList.add('active');
            dom.fsThumbnail.classList.add('video-mode-hidden');
            dom.ytPlayerContainer.classList.remove('video-mode-hidden');
            if (dom.fsArtwork) dom.fsArtwork.classList.add('video-mode-active');
            if (dom.fullscreenPlayer) dom.fullscreenPlayer.classList.add('video-mode-active');
        } else {
            dom.fsModeVideoBtn.classList.remove('active');
            dom.fsModeSongBtn.classList.add('active');
            dom.ytPlayerContainer.classList.add('video-mode-hidden');
            dom.fsThumbnail.classList.remove('video-mode-hidden');
            if (dom.fsArtwork) dom.fsArtwork.classList.remove('video-mode-active');
            if (dom.fullscreenPlayer) dom.fullscreenPlayer.classList.remove('video-mode-active');
        }

        // Notify player.js to swap audio engines
        if (window.MusicPlayer && window.MusicPlayer.setVideoMode) {
            window.MusicPlayer.setVideoMode(isVideo);
        }
    }

    // Callback from player.js when auto-switching modes (e.g., screen off)
    // Only update UI, do NOT call MusicPlayer.setVideoMode to avoid circular loop
    window.onVideoModeChange = function(isVideo) {
        if (!dom.fsModeSongBtn || !dom.fsModeVideoBtn) return;
        if (!dom.fsArtwork) dom.fsArtwork = document.querySelector('.fs-artwork');
        
        if (isVideo) {
            dom.fsModeSongBtn.classList.remove('active');
            dom.fsModeVideoBtn.classList.add('active');
            if (dom.ytPlayerContainer) dom.ytPlayerContainer.classList.remove('video-mode-hidden');
            if (dom.fsThumbnail) dom.fsThumbnail.classList.add('video-mode-hidden');
            if (dom.fsArtwork) dom.fsArtwork.classList.add('video-mode-active');
            if (dom.fullscreenPlayer) dom.fullscreenPlayer.classList.add('video-mode-active');
        } else {
            dom.fsModeVideoBtn.classList.remove('active');
            dom.fsModeSongBtn.classList.add('active');
            if (dom.ytPlayerContainer) dom.ytPlayerContainer.classList.add('video-mode-hidden');
            if (dom.fsThumbnail) dom.fsThumbnail.classList.remove('video-mode-hidden');
            if (dom.fsArtwork) dom.fsArtwork.classList.remove('video-mode-active');
            if (dom.fullscreenPlayer) dom.fullscreenPlayer.classList.remove('video-mode-active');
        }
    };

    // ===== AUTHENTICATION LOGIC =====

    function initAuth() {
        if (!window.firebaseAuth) {
            console.warn('Firebase is not initialized');
            return;
        }

        window.firebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                // User is signed in
                window.currentUser = user;
                updateAuthUI(user);
                dom.loginModal.classList.add('hidden');
                
                showToast(`Xin chào, ${user.displayName}`);
                
                // Trigger cloud sync
                await syncDataFromCloud(user.uid);
            } else {
                // User is signed out
                window.currentUser = null;
                updateAuthUI(null);
            }
        });
    }

    async function syncDataFromCloud(uid) {
        if (!window.firebaseDb) return;
        
        showLoading();
        showToast('Đang kết nối đồng bộ thời gian thực...', 2000);
        
        try {
            // Unsubscribe previous listener if exists
            if (unsubscribeSnapshot) {
                unsubscribeSnapshot();
            }

            // Real-time sync listener
            unsubscribeSnapshot = window.firebaseDb.collection('users').doc(uid).onSnapshot((doc) => {
                if (doc.exists) {
                    const data = doc.data();
                    
                    // Skip sync if this device just wrote to Cloud
                    const lastWrite = parseInt(localStorage.getItem('last_local_write') || '0');
                    if (Date.now() - lastWrite < 2000) return;
                    
                    // Check if cloud data is actually different from local to prevent infinite sync loops
                    const localHistory = localStorage.getItem('music_history') || '[]';
                    const localLiked = localStorage.getItem('music_liked') || '[]';
                    const localPlaylists = localStorage.getItem('music_playlists') || '[]';
                    
                    const cloudHistory = data.history ? JSON.stringify(data.history) : '[]';
                    const cloudLiked = data.liked ? JSON.stringify(data.liked) : '[]';
                    const cloudPlaylists = data.playlists ? JSON.stringify(data.playlists) : '[]';
                    
                    if (localHistory !== cloudHistory || localLiked !== cloudLiked || localPlaylists !== cloudPlaylists) {
                        // Hydrate local state from cloud
                        localStorage.setItem('music_history', cloudHistory);
                        localStorage.setItem('music_liked', cloudLiked);
                        localStorage.setItem('music_playlists', cloudPlaylists);
                        
                        // Force player to reload the new local data into memory
                        if (window.MusicPlayer && window.MusicPlayer.reloadUserData) {
                            window.MusicPlayer.reloadUserData();
                        }
                        
                        // console.log('Phát hiện dữ liệu Cloud thay đổi, đã đồng bộ về máy');
                        
                        // Refresh current page if needed
                        if (currentPage === 'library' || currentPage === 'liked' || currentPage === 'history' || currentPage === 'playlist') {
                            navigateTo(currentPage);
                        }
                    }
                } else {
                    // First time login - upload current local data to cloud
                    const history = JSON.parse(localStorage.getItem('music_history') || '[]');
                    const liked = JSON.parse(localStorage.getItem('music_liked') || '[]');
                    const playlists = JSON.parse(localStorage.getItem('music_playlists') || '[]');
                    
                    window.firebaseDb.collection('users').doc(uid).set({
                        history,
                        liked,
                        playlists,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
                    }).then(() => {
                        console.log('Khởi tạo dữ liệu người dùng mới trên Cloud');
                        showToast('Đã tạo hồ sơ đám mây thành công!');
                    });
                }
                
                hideLoading();
            }, (error) => {
                console.error('Lỗi onSnapshot:', error);
                showToast('Mất kết nối đồng bộ: Vui lòng kiểm tra mạng');
                hideLoading();
            });
            
        } catch (error) {
            console.error('Error setting up cloud sync:', error);
            showToast('Lỗi khởi tạo đồng bộ dữ liệu');
            hideLoading();
        }
    }

    async function handleGoogleLogin() {
        if (!window.firebaseAuth) return;
        
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            // Optional: Request specific scopes
            // provider.addScope('profile');
            // provider.addScope('email');
            
            showToast('Đang kết nối với Google...', 2000);
            await window.firebaseAuth.signInWithPopup(provider);
            // The onAuthStateChanged listener will handle the UI update
        } catch (error) {
            console.error('Login error:', error);
            showToast(`Lỗi đăng nhập: ${error.message}`);
        }
    }

    async function handleLogout() {
        if (!window.firebaseAuth) return;
        
        try {
            dom.userDropdown.classList.add('hidden');
            if (unsubscribeSnapshot) {
                unsubscribeSnapshot();
                unsubscribeSnapshot = null;
            }
            await window.firebaseAuth.signOut();
            showToast('Đã đăng xuất thành công');
        } catch (error) {
            console.error('Logout error:', error);
            showToast('Lỗi khi đăng xuất');
        }
    }

    function updateAuthUI(user) {
        if (user) {
            dom.headerLoginBtn.classList.add('hidden');
            dom.userProfile.classList.remove('hidden');
            
            // Set user data
            dom.userAvatar.src = user.photoURL || 'https://via.placeholder.com/32';
            dom.userNameDisplay.textContent = user.displayName || 'Người dùng';
            dom.userEmailDisplay.textContent = user.email || '';
        } else {
            dom.headerLoginBtn.classList.remove('hidden');
            dom.userProfile.classList.add('hidden');
        }
    }

    // ===== SEARCH =====

    function handleSearchInput(e) {
        const value = e.target.value.trim();
        dom.searchClearBtn.classList.toggle('visible', value.length > 0);

        clearTimeout(searchDebounceTimer);
        if (value.length >= 2) {
            searchDebounceTimer = setTimeout(() => {
                performSearch(value);
            }, 500);
        }
    }

    async function performSearch(query) {
        if (!query || !query.trim()) return;

        navigateTo('search');
        showLoading();

        try {
            const results = await MusicAPI.search(query);
            renderSearchResults(query, results);
        } catch (e) {
            console.error('Search failed:', e);
            renderError('Không thể tìm kiếm. Vui lòng thử lại.');
        }

        hideLoading();
    }

    function openMobileSearch() {
        dom.header.classList.add('search-active');
        dom.searchInput.focus();
        isSearchActive = true;
    }

    function closeMobileSearch() {
        dom.header.classList.remove('search-active');
        dom.searchInput.value = '';
        dom.searchClearBtn.classList.remove('visible');
        isSearchActive = false;
    }

    // ===== NAVIGATION =====

    function navigateTo(page, params) {
        currentPage = page;
        updateNavActive(page);

        switch (page) {
            case 'home':
                loadHomePage();
                break;
            case 'explore':
                loadExplorePage();
                break;
            case 'library':
                loadLibraryPage();
                break;
            case 'history':
                loadHistoryPage();
                break;
            case 'liked':
                loadLikedPage();
                break;
            case 'playlist':
                loadPlaylistPage(params);
                break;
            case 'search':
                // Search handled by performSearch
                break;
            case 'tiktok':
                loadTikTokPage();
                break;
        }

        dom.mainContent.scrollTop = 0;
    }

    function updateNavActive(page) {
        // Sidebar
        document.querySelectorAll('.sidebar-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });
        // Mobile nav
        document.querySelectorAll('.mobile-nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.page === page);
        });
    }

    // ===== PAGE RENDERERS =====

    async function loadHomePage() {
        showLoading();

        const container = dom.pageContainer;
        container.innerHTML = '';

        try {
            // Trending
            trendingData = await MusicAPI.getTrending('VN');

            let html = '';

            // Quick Picks
            if (trendingData.length > 0) {
                const quickPicks = trendingData.slice(0, 16);
                html += `
                    <div class="section fade-in">
                        <div class="section-header">
                            <h2 class="section-title">Lựa chọn nhanh</h2>
                        </div>
                        <div class="song-list quick-picks-grid">
                            ${quickPicks.map((track, i) => renderSongRow(track, i)).join('')}
                        </div>
                    </div>
                `;
            }

            // Trending section removed as per user request to avoid duplication with Quick Picks

            // Music Categories
            html += `
                <div class="section fade-in" style="animation-delay: 0.2s">
                    <div class="section-header">
                        <h2 class="section-title">Duyệt theo thể loại</h2>
                    </div>
                    <div class="scroll-row">
                        ${renderCategoryChips()}
                    </div>
                </div>
            `;

            // History section
            const history = MusicPlayer.getHistory();
            if (history.length > 0) {
                html += `
                    <div class="section fade-in" style="animation-delay: 0.3s">
                        <div class="section-header">
                            <h2 class="section-title">Nghe gần đây</h2>
                            <a class="section-more" data-page="history">Xem tất cả</a>
                        </div>
                        <div class="scroll-row">
                            ${history.slice(0, 10).map(track => renderMusicCard(track)).join('')}
                        </div>
                    </div>
                `;
            }

            container.innerHTML = html || renderEmptyState('home', 'Chưa có nội dung', 'Kiểm tra kết nối internet và thử lại');
        } catch (e) {
            console.error('Failed to load home:', e);
            container.innerHTML = renderEmptyState('error', 'Không thể tải dữ liệu', 'Kiểm tra kết nối internet và thử lại');
        }

        hideLoading();
    }

    async function loadExplorePage() {
        showLoading();
        const container = dom.pageContainer;

        const categories = [
            { id: 'vpop', label: 'V-Pop', color: '#e91e63', icon: 'music_note' },
            { id: 'kpop', label: 'K-Pop', color: '#9c27b0', icon: 'music_note' },
            { id: 'usuk', label: 'US-UK', color: '#2196f3', icon: 'music_note' },
            { id: 'edm', label: 'EDM', color: '#00bcd4', icon: 'equalizer' },
            { id: 'lofi', label: 'Lo-Fi', color: '#4caf50', icon: 'headphones' },
            { id: 'ballad', label: 'Ballad', color: '#ff9800', icon: 'favorite' },
            { id: 'rap', label: 'Rap Việt', color: '#f44336', icon: 'mic' },
            { id: 'indie', label: 'Indie', color: '#795548', icon: 'album' },
            { id: 'acoustic', label: 'Acoustic', color: '#607d8b', icon: 'acoustic_space' },
            { id: 'remix', label: 'Remix', color: '#ff5722', icon: 'speed' }
        ];

        let html = `
            <div class="section fade-in">
                <div class="section-header">
                    <h2 class="section-title">Khám phá</h2>
                </div>
                <div class="explore-categories">
                    ${categories.map(cat => `
                        <div class="category-card" data-action="category" data-category="${cat.id}" style="background: linear-gradient(135deg, ${cat.color}, ${cat.color}88);">
                            <span class="category-card-label">${cat.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Load a default category
        try {
            const vpopResults = await MusicAPI.searchCategory('vpop');
            if (vpopResults.length > 0) {
                html += `
                    <div class="section fade-in" style="animation-delay: 0.1s">
                        <div class="section-header">
                            <h2 class="section-title">V-Pop nổi bật</h2>
                        </div>
                        <div class="song-list">
                            ${vpopResults.slice(0, 10).map((track, i) => renderSongRow(track, i)).join('')}
                        </div>
                    </div>
                `;
            }
        } catch (e) {
            // Ignore
        }

        container.innerHTML = html;
        hideLoading();
    }

    function loadLibraryPage() {
        const container = dom.pageContainer;
        const playlists = MusicPlayer.getPlaylists();
        const liked = MusicPlayer.getLikedSongs();
        const history = MusicPlayer.getHistory();

        let html = `
            <div class="section fade-in">
                <div class="section-header">
                    <h2 class="section-title">Danh sách phát</h2>
                </div>
                <div class="playlist-grid">
                    <div class="playlist-card create-playlist-card" data-action="create-playlist">
                        <span class="material-icons-round">add</span>
                        <span>Tạo playlist mới</span>
                    </div>
                    <div class="playlist-card create-playlist-card" data-action="import-playlist" style="background: rgba(255,0,0,0.1); border-color: rgba(255,0,0,0.2);">
                        <span class="material-icons-round" style="color: #ff0000;">sync</span>
                        <span style="color: #ff0000;">Nhập từ YouTube</span>
                    </div>
                    ${playlists.map(pl => `
                        <div class="playlist-card" data-action="open-playlist" data-playlist-id="${pl.id}">
                            <div class="playlist-card-icon">
                                <span class="material-icons-round">queue_music</span>
                            </div>
                            <div class="playlist-card-name">${escapeHtml(pl.name)}</div>
                            <div class="playlist-card-count">${pl.tracks.length} bài hát</div>
                            <div class="playlist-card-actions">
                                <button class="icon-btn" data-action="delete-playlist" data-playlist-id="${pl.id}" title="Xóa playlist">
                                    <span class="material-icons-round" style="font-size:18px">delete_outline</span>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="section fade-in" style="animation-delay: 0.1s">
                <div class="section-header">
                    <h2 class="section-title">Thư viện</h2>
                </div>
                <div class="library-tabs">
                    <div class="library-tab active" data-lib-tab="liked">Đã thích (${liked.length})</div>
                    <div class="library-tab" data-lib-tab="history">Lịch sử (${history.length})</div>
                </div>
                <div id="lib-content">
        `;

        if (liked.length > 0) {
            html += `
                <div class="song-list">
                    ${liked.map((track, i) => renderSongRow(track, i)).join('')}
                </div>
            `;
        } else {
            html += renderEmptyState('favorite_border', 'Chưa có bài hát yêu thích', 'Nhấn ♡ để thêm bài hát vào thư viện');
        }

        html += '</div></div>';

        container.innerHTML = html;

        // Tab switching
        container.querySelectorAll('.library-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                container.querySelectorAll('.library-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const tabName = tab.dataset.libTab;
                const libContent = $('lib-content');

                if (tabName === 'liked') {
                    const liked = MusicPlayer.getLikedSongs();
                    libContent.innerHTML = liked.length > 0
                        ? `<div class="song-list">${liked.map((t, i) => renderSongRow(t, i)).join('')}</div>`
                        : renderEmptyState('favorite_border', 'Chưa có bài hát yêu thích', 'Nhấn ♡ để thêm bài hát vào thư viện');
                } else {
                    const history = MusicPlayer.getHistory();
                    libContent.innerHTML = history.length > 0
                        ? `<div class="song-list">${history.map((t, i) => renderSongRow(t, i)).join('')}</div>`
                        : renderEmptyState('history', 'Chưa có lịch sử nghe nhạc', 'Bắt đầu phát nhạc để xem lịch sử');
                }
            });
        });

        hideLoading();
    }

    // ===== PLAYLIST DETAIL PAGE =====

    function loadPlaylistPage(playlistId) {
        const container = dom.pageContainer;
        const pl = MusicPlayer.getPlaylist(playlistId);

        if (!pl) {
            container.innerHTML = renderEmptyState('error', 'Playlist không tồn tại', '');
            return;
        }

        let html = `
            <div class="section fade-in">
                <div class="playlist-header">
                    <div class="playlist-header-icon">
                        <span class="material-icons-round">queue_music</span>
                    </div>
                    <div class="playlist-header-info">
                        <h2>${escapeHtml(pl.name)}</h2>
                        <p>${pl.tracks.length} bài hát</p>
                        <div class="playlist-header-actions">
                            ${pl.tracks.length > 0 ? `
                                <button class="chip active" id="play-all-pl">
                                    <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">play_arrow</span>
                                    Phát tất cả
                                </button>
                                <button class="chip" id="shuffle-pl">
                                    <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">shuffle</span>
                                    Trộn bài
                                </button>
                            ` : ''}
                            <button class="chip" id="rename-pl">
                                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">edit</span>
                                Đổi tên
                            </button>
                            <a class="section-more" data-page="library">← Quay lại</a>
                        </div>
                    </div>
                </div>
        `;

        if (pl.tracks.length > 0) {
            html += `<div class="song-list">${pl.tracks.map((track, i) => renderPlaylistSongRow(track, i, pl.id)).join('')}</div>`;
        } else {
            html += renderEmptyState('queue_music', 'Playlist trống', 'Thêm bài hát bằng cách nhấn chuột phải → Thêm vào playlist');
        }

        html += '</div>';
        container.innerHTML = html;

        // Bind events
        const playAllBtn = $('play-all-pl');
        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                isPlayingContextPlaylist = true;
                MusicPlayer.playAll(pl.tracks);
                showToast(`Đang phát ${pl.name}`);
            });
        }

        const shuffleBtn = $('shuffle-pl');
        if (shuffleBtn) {
            shuffleBtn.addEventListener('click', () => {
                isPlayingContextPlaylist = true;
                MusicPlayer.playAll(pl.tracks);
                if (!MusicPlayer.getShuffleMode()) MusicPlayer.toggleShuffle();
                showToast(`Đang phát ngẫu nhiên ${pl.name}`);
            });
        }

        const renameBtn = $('rename-pl');
        if (renameBtn) {
            renameBtn.addEventListener('click', () => {
                showCreatePlaylistDialog((newName) => {
                    MusicPlayer.renamePlaylist(pl.id, newName);
                    showToast('Đã đổi tên playlist');
                    loadPlaylistPage(pl.id);
                }, pl.name, 'Đổi tên playlist');
            });
        }

        hideLoading();
    }

    function renderPlaylistSongRow(track, index, playlistId) {
        const playing = MusicPlayer.getCurrentTrack()?.id === track.id;
        return `
            <div class="song-row ${playing ? 'playing' : ''}" data-action="play" data-track='${escapeAttr(JSON.stringify(track))}'>
                <span class="song-row-index">${playing ? '<span class="material-icons-round" style="font-size:18px;color:var(--accent)">equalizer</span>' : (index + 1)}</span>
                <div class="song-row-thumb">
                    <img src="${track.thumbnail || MusicAPI.getThumbnail(track.id)}" alt="" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23272727%22 width=%221%22 height=%221%22/></svg>'">
                    <div class="song-row-thumb-overlay">
                        <span class="material-icons-round">${playing ? 'pause' : 'play_arrow'}</span>
                    </div>
                </div>
                <div class="song-row-info">
                    <span class="song-row-title">${escapeHtml(track.title)}</span>
                    <span class="song-row-artist">${escapeHtml(track.artist)}</span>
                </div>
                <span class="song-row-duration">${track.durationText || MusicAPI.formatDuration(track.duration)}</span>
                <div class="song-row-actions">
                    <button class="icon-btn" data-action="remove-from-playlist" data-playlist-id="${playlistId}" data-track-id="${track.id}" title="Xóa khỏi playlist">
                        <span class="material-icons-round" style="font-size:20px">remove_circle_outline</span>
                    </button>
                    <button class="icon-btn" data-action="add-queue" data-track='${escapeAttr(JSON.stringify(track))}' title="Thêm vào danh sách phát">
                        <span class="material-icons-round" style="font-size:20px">playlist_add</span>
                    </button>
                </div>
            </div>
        `;
    }

    function loadHistoryPage() {
        const container = dom.pageContainer;
        const history = MusicPlayer.getHistory();

        let html = `
            <div class="section fade-in">
                <div class="section-header">
                    <h2 class="section-title">Lịch sử nghe nhạc</h2>
                    ${history.length > 0 ? '<a class="section-more" id="clear-history-btn">Xóa tất cả</a>' : ''}
                </div>
        `;

        if (history.length > 0) {
            html += `
                <div class="song-list">
                    ${history.map((track, i) => renderSongRow(track, i)).join('')}
                </div>
            `;
        } else {
            html += renderEmptyState('history', 'Chưa có lịch sử nghe nhạc', 'Bắt đầu phát nhạc để xem lịch sử');
        }

        html += '</div>';
        container.innerHTML = html;

        const clearBtn = $('clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                MusicPlayer.clearHistory();
                loadHistoryPage();
                showToast('Đã xóa lịch sử');
            });
        }

        hideLoading();
    }

    function loadLikedPage() {
        const container = dom.pageContainer;
        const liked = MusicPlayer.getLikedSongs();

        let html = `
            <div class="section fade-in">
                <div class="section-header">
                    <h2 class="section-title">Bài hát đã thích</h2>
                </div>
        `;

        if (liked.length > 0) {
            html += `
                <div style="margin-bottom: 16px;">
                    <button class="chip active" id="play-all-liked">
                        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">play_arrow</span>
                        Phát tất cả
                    </button>
                </div>
                <div class="song-list">
                    ${liked.map((track, i) => renderSongRow(track, i)).join('')}
                </div>
            `;
        } else {
            html += renderEmptyState('favorite_border', 'Chưa có bài hát yêu thích', 'Nhấn ♡ để thêm bài hát vào danh sách');
        }

        html += '</div>';
        container.innerHTML = html;

        const playAllBtn = $('play-all-liked');
        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                isPlayingContextPlaylist = true;
                MusicPlayer.playAll(liked);
                showToast('Đang phát tất cả bài hát yêu thích');
            });
        }

        hideLoading();
    }

    // ===== TIKTOK PAGE =====

    let tiktokFeedData = [];
    let tiktokCurrentTab = 'trending';
    let tiktokObserver = null;

    async function loadTikTokPage() {
        const container = dom.pageContainer;
        container.innerHTML = `
            <div class="tiktok-page">
                <div class="tiktok-tabs">
                    <button class="tiktok-tab active" data-tiktok-tab="trending">🔥 Đề xuất</button>
                    <button class="tiktok-tab" data-tiktok-tab="search">🔍 Tìm kiếm</button>
                </div>
                <div class="tiktok-search-bar" id="tiktok-search-bar">
                    <input type="text" id="tiktok-search-input" placeholder="Tìm hashtag hoặc username...">
                    <button id="tiktok-search-go">Tìm</button>
                </div>
                <div class="tiktok-feed" id="tiktok-feed">
                    <div class="tiktok-loading">
                        <div class="spinner"></div>
                        <p>Đang tải video TikTok...</p>
                    </div>
                </div>
            </div>
        `;

        // Tab switching
        container.querySelectorAll('.tiktok-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                container.querySelectorAll('.tiktok-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabType = tab.dataset.tiktokTab;
                tiktokCurrentTab = tabType;

                const searchBar = container.querySelector('#tiktok-search-bar');
                if (tabType === 'search') {
                    searchBar.classList.add('visible');
                    container.querySelector('#tiktok-search-input').focus();
                } else {
                    searchBar.classList.remove('visible');
                    loadTikTokFeed();
                }
            });
        });

        // Search
        const searchGoBtn = container.querySelector('#tiktok-search-go');
        const searchInput = container.querySelector('#tiktok-search-input');
        if (searchGoBtn) {
            searchGoBtn.addEventListener('click', () => {
                const q = searchInput.value.trim();
                if (q) loadTikTokFeed(q);
            });
        }
        if (searchInput) {
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const q = searchInput.value.trim();
                    if (q) loadTikTokFeed(q);
                }
            });
        }

        hideLoading();
        loadTikTokFeed();
    }

    async function loadTikTokFeed(searchQuery) {
        const feedEl = document.getElementById('tiktok-feed');
        if (!feedEl) return;

        feedEl.innerHTML = '<div class="tiktok-loading"><div class="spinner"></div><p>Đang tải...</p></div>';

        try {
            let apiUrl;
            if (searchQuery) {
                apiUrl = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(searchQuery)}&count=20`;
            } else {
                apiUrl = `https://www.tikwm.com/api/feed/list?region=VN&count=20`;
            }

            const res = await fetch(apiUrl);
            const json = await res.json();

            if (!json.data || !json.data.videos || json.data.videos.length === 0) {
                feedEl.innerHTML = '<div class="tiktok-empty"><span class="material-icons-round" style="font-size:48px;">videocam_off</span><p>Không tìm thấy video nào</p></div>';
                return;
            }

            tiktokFeedData = json.data.videos;
            renderTikTokFeed(feedEl, tiktokFeedData);
        } catch (err) {
            console.error('TikTok API error:', err);
            feedEl.innerHTML = '<div class="tiktok-empty"><span class="material-icons-round" style="font-size:48px;">error</span><p>Lỗi tải video TikTok. Vui lòng thử lại sau.</p></div>';
        }
    }

    function renderTikTokFeed(feedEl, videos) {
        feedEl.innerHTML = '';

        // Disconnect old observer
        if (tiktokObserver) tiktokObserver.disconnect();

        videos.forEach((video, idx) => {
            const card = document.createElement('div');
            card.className = 'tiktok-card paused';
            card.dataset.index = idx;

            const playUrl = video.play || '';
            const author = video.author ? (video.author.nickname || video.author.unique_id || 'Unknown') : 'Unknown';
            const authorId = video.author ? ('@' + (video.author.unique_id || '')) : '';
            const desc = video.title || '';
            const musicTitle = video.music_info ? video.music_info.title : '';
            const likes = formatTikTokCount(video.digg_count || 0);
            const comments = formatTikTokCount(video.comment_count || 0);
            const shares = formatTikTokCount(video.share_count || 0);

            card.innerHTML = `
                <video src="${playUrl}" loop playsinline preload="metadata" muted></video>
                <span class="material-icons-round tiktok-play-overlay">play_arrow</span>
                <div class="tiktok-overlay">
                    <div class="tiktok-author">${author} <span style="font-weight:400;color:rgba(255,255,255,0.6);font-size:0.85rem;">${authorId}</span></div>
                    <div class="tiktok-desc">${desc}</div>
                    ${musicTitle ? `<div class="tiktok-music-tag"><span class="material-icons-round" style="font-size:14px;">music_note</span> ${musicTitle}</div>` : ''}
                </div>
                <div class="tiktok-actions">
                    <button class="tiktok-action-btn" data-action="like"><span class="material-icons-round">favorite</span><span>${likes}</span></button>
                    <button class="tiktok-action-btn" data-action="comment"><span class="material-icons-round">chat_bubble</span><span>${comments}</span></button>
                    <button class="tiktok-action-btn" data-action="share"><span class="material-icons-round">share</span><span>${shares}</span></button>
                </div>
            `;

            // Click to play/pause
            const videoEl = card.querySelector('video');
            card.addEventListener('click', (e) => {
                if (e.target.closest('.tiktok-action-btn')) return;
                if (videoEl.paused) {
                    videoEl.muted = false;
                    videoEl.play();
                    card.classList.remove('paused');
                } else {
                    videoEl.pause();
                    card.classList.add('paused');
                }
            });

            // Action buttons
            card.querySelectorAll('.tiktok-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    if (action === 'like') {
                        btn.classList.toggle('liked');
                    } else if (action === 'share') {
                        const shareUrl = `https://www.tiktok.com/@${video.author?.unique_id || ''}/video/${video.video_id || ''}`;
                        if (navigator.share) {
                            navigator.share({ title: desc, url: shareUrl });
                        } else {
                            navigator.clipboard.writeText(shareUrl);
                            showToast('Đã sao chép liên kết!');
                        }
                    } else if (action === 'comment') {
                        showToast('Tính năng bình luận chưa khả dụng');
                    }
                });
            });

            feedEl.appendChild(card);
        });

        // IntersectionObserver for auto play/pause on scroll
        tiktokObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const videoEl = entry.target.querySelector('video');
                if (!videoEl) return;
                if (entry.isIntersecting) {
                    videoEl.muted = false;
                    videoEl.play().catch(() => {});
                    entry.target.classList.remove('paused');
                } else {
                    videoEl.pause();
                    entry.target.classList.add('paused');
                }
            });
        }, { threshold: 0.6 });

        feedEl.querySelectorAll('.tiktok-card').forEach(card => {
            tiktokObserver.observe(card);
        });
    }

    function formatTikTokCount(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    }

    // ===== SEARCH RESULTS RENDERER =====

    function renderSearchResults(query, results) {
        const container = dom.pageContainer;

        let html = `
            <div class="section fade-in">
                <p class="search-results-header">
                    Kết quả cho <strong>"${escapeHtml(query)}"</strong> — ${results.length} bài hát
                </p>
        `;

        if (results.length > 0) {
            html += `
                <div style="margin-bottom: 16px;">
                    <button class="chip active" id="play-all-search">
                        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">play_arrow</span>
                        Phát tất cả
                    </button>
                </div>
                <div class="song-list">
                    ${results.map((track, i) => renderSongRow(track, i)).join('')}
                </div>
            `;
        } else {
            html += renderEmptyState('search_off', 'Không tìm thấy kết quả', 'Thử từ khóa khác hoặc kiểm tra chính tả');
        }

        html += '</div>';
        container.innerHTML = html;

        const playAllBtn = $('play-all-search');
        if (playAllBtn) {
            playAllBtn.addEventListener('click', () => {
                MusicPlayer.playAll(results);
                showToast('Đang phát tất cả kết quả tìm kiếm');
            });
        }
    }

    // ===== COMPONENT RENDERERS =====

    function renderMusicCard(track) {
        return `
            <div class="music-card" data-action="play" data-track='${escapeAttr(JSON.stringify(track))}'>
                <div class="music-card-thumb">
                    <img src="${track.thumbnail || MusicAPI.getThumbnail(track.id)}" alt="${escapeHtml(track.title)}" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23272727%22 width=%221%22 height=%221%22/></svg>'">
                    <div class="music-card-play">
                        <span class="material-icons-round">play_arrow</span>
                    </div>
                </div>
                <div class="music-card-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
                <div class="music-card-subtitle">${escapeHtml(track.artist)}</div>
            </div>
        `;
    }

    function renderSongRow(track, index) {
        const playing = MusicPlayer.getCurrentTrack()?.id === track.id;
        return `
            <div class="song-row ${playing ? 'playing' : ''}" data-action="play" data-track='${escapeAttr(JSON.stringify(track))}'>
                <span class="song-row-index">${playing ? '<span class="material-icons-round" style="font-size:18px;color:var(--accent)">equalizer</span>' : (index + 1)}</span>
                <div class="song-row-thumb">
                    <img src="${track.thumbnail || MusicAPI.getThumbnail(track.id)}" alt="" loading="lazy"
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22><rect fill=%22%23272727%22 width=%221%22 height=%221%22/></svg>'">
                    <div class="song-row-thumb-overlay">
                        <span class="material-icons-round">${playing ? 'pause' : 'play_arrow'}</span>
                    </div>
                </div>
                <div class="song-row-info">
                    <span class="song-row-title">${escapeHtml(track.title)}</span>
                    <span class="song-row-artist">${escapeHtml(track.artist)}</span>
                </div>
                <span class="song-row-duration">${track.durationText || MusicAPI.formatDuration(track.duration)}</span>
                <div class="song-row-actions">
                    <button class="icon-btn" data-action="add-queue" data-track='${escapeAttr(JSON.stringify(track))}' title="Thêm vào danh sách phát">
                        <span class="material-icons-round" style="font-size:20px">playlist_add</span>
                    </button>
                    <button class="icon-btn" data-action="like" data-track-id="${track.id}" title="Thích">
                        <span class="material-icons-round" style="font-size:20px">${MusicPlayer.isLiked(track.id) ? 'favorite' : 'favorite_border'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderCategoryChips() {
        const categories = [
            { id: 'vpop', label: 'V-Pop' },
            { id: 'kpop', label: 'K-Pop' },
            { id: 'usuk', label: 'US-UK' },
            { id: 'edm', label: 'EDM' },
            { id: 'lofi', label: 'Lo-Fi' },
            { id: 'ballad', label: 'Ballad' },
            { id: 'rap', label: 'Rap Việt' },
            { id: 'indie', label: 'Indie' },
            { id: 'acoustic', label: 'Acoustic' },
            { id: 'remix', label: 'Remix' }
        ];

        return categories.map(cat => `
            <div class="chip" data-action="category" data-category="${cat.id}">${cat.label}</div>
        `).join('');
    }

    function renderEmptyState(icon, title, subtitle) {
        return `
            <div class="empty-state">
                <span class="material-icons-round">${icon}</span>
                <h3>${title}</h3>
                <p>${subtitle}</p>
            </div>
        `;
    }

    function renderError(message) {
        dom.pageContainer.innerHTML = renderEmptyState('error_outline', 'Đã xảy ra lỗi', message);
    }

    // ===== CONTENT CLICK HANDLER =====

    function handleContentClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        switch (action) {
            case 'play': {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const track = JSON.parse(target.dataset.track);
                    isPlayingContextPlaylist = false;
                    MusicPlayer.playTrack(track);
                } catch (err) { console.error(err); }
                break;
            }
            case 'add-queue': {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const track = JSON.parse(target.dataset.track);
                    MusicPlayer.addToQueue(track);
                    showToast('Đã thêm vào danh sách phát');
                    updateQueueUI();
                } catch (err) { console.error(err); }
                break;
            }
            case 'like': {
                e.preventDefault();
                e.stopPropagation();
                const trackId = target.dataset.trackId;
                const currentTrack = MusicPlayer.getCurrentTrack();
                // Find track from page
                const trackEl = target.closest('[data-track]');
                if (trackEl) {
                    try {
                        const track = JSON.parse(trackEl.dataset.track);
                        const liked = MusicPlayer.toggleLike(track);
                        const icon = target.querySelector('.material-icons-round');
                        if (icon) icon.textContent = liked ? 'favorite' : 'favorite_border';
                        showToast(liked ? 'Đã thêm vào Yêu thích' : 'Đã xóa khỏi Yêu thích');
                        if (currentTrack && currentTrack.id === track.id) {
                            updateLikeButton(track.id);
                        }
                    } catch (err) { console.error(err); }
                }
                break;
            }
            case 'category': {
                e.preventDefault();
                loadCategory(target.dataset.category);
                break;
            }
            case 'create-playlist': {
                e.preventDefault();
                showCreatePlaylistDialog((name) => {
                    MusicPlayer.createPlaylist(name);
                    showToast(`Đã tạo playlist "${name}"`);
                    loadLibraryPage();
                });
                break;
            }
            case 'import-playlist': {
                e.preventDefault();
                showCreatePlaylistDialog(async (url) => {
                    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                        showToast('Link không hợp lệ! Vui lòng nhập link YouTube');
                        return;
                    }
                    showLoading();
                    try {
                        const data = await MusicAPI.importPlaylist(url);
                        if (data && data.items && data.items.length > 0) {
                            const plId = MusicPlayer.createPlaylist(data.title || 'Playlist nhập từ YouTube');
                            let count = 0;
                            data.items.forEach(track => {
                                if (MusicPlayer.addToPlaylist(plId, track)) count++;
                            });
                            showToast(`Đã nhập thành công ${count} bài hát vào "${data.title}"`);
                            loadLibraryPage();
                        } else {
                            showToast('Không tìm thấy bài hát nào trong playlist này');
                        }
                    } catch (err) {
                        showToast(err.message || 'Lỗi khi nhập playlist');
                    } finally {
                        hideLoading();
                    }
                }, '', 'Dán link YouTube Playlist vào đây:');
                break;
            }
            case 'open-playlist': {
                e.preventDefault();
                const plId = target.dataset.playlistId;
                if (plId) navigateTo('playlist', plId);
                break;
            }
            case 'delete-playlist': {
                e.preventDefault();
                e.stopPropagation();
                const plId = target.dataset.playlistId;
                if (plId) {
                    MusicPlayer.deletePlaylist(plId);
                    showToast('Đã xóa playlist');
                    loadLibraryPage();
                }
                break;
            }
            case 'remove-from-playlist': {
                e.preventDefault();
                e.stopPropagation();
                const plId = target.dataset.playlistId;
                const trackId = target.dataset.trackId;
                if (plId && trackId) {
                    MusicPlayer.removeFromPlaylist(plId, trackId);
                    showToast('Đã xóa bài hát khỏi playlist');
                    loadPlaylistPage(plId);
                }
                break;
            }
        }
    }

    async function loadCategory(categoryId) {
        showLoading();
        dom.pageContainer.innerHTML = '';

        try {
            const results = await MusicAPI.searchCategory(categoryId);

            let html = `
                <div class="section fade-in">
                    <div class="section-header">
                        <h2 class="section-title">${escapeHtml(categoryId.toUpperCase())}</h2>
                        <a class="section-more" data-page="explore">← Quay lại</a>
                    </div>
            `;

            if (results.length > 0) {
                html += `
                    <div style="margin-bottom: 16px;">
                        <button class="chip active" id="play-all-cat">
                            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">play_arrow</span>
                            Phát tất cả
                        </button>
                    </div>
                    <div class="song-list">
                        ${results.map((track, i) => renderSongRow(track, i)).join('')}
                    </div>
                `;
            } else {
                html += renderEmptyState('music_off', 'Không tìm thấy nhạc', 'Thử thể loại khác');
            }

            html += '</div>';
            dom.pageContainer.innerHTML = html;

            const playAllBtn = $('play-all-cat');
            if (playAllBtn) {
                playAllBtn.addEventListener('click', () => {
                    MusicPlayer.playAll(results);
                    showToast('Đang phát tất cả');
                });
            }
        } catch (e) {
            renderError('Không thể tải thể loại này');
        }

        hideLoading();
    }

    // ===== QUEUE CLICK HANDLER =====

    function handleQueueClick(e) {
        const item = e.target.closest('.queue-item');
        if (!item) return;

        const removeBtn = e.target.closest('.queue-item-remove');
        if (removeBtn) {
            const index = parseInt(item.dataset.index);
            MusicPlayer.removeFromQueue(index);
            updateQueueUI();
            return;
        }

        const index = parseInt(item.dataset.index);
        const queue = MusicPlayer.getQueue();
        if (queue[index]) {
            MusicPlayer.playAll(queue, index);
        }
    }

    // ===== CONTEXT MENU =====

    function handleContextMenu(e) {
        const songRow = e.target.closest('[data-track]');
        if (!songRow) return;

        e.preventDefault();
        removeContextMenu();

        try {
            const track = JSON.parse(songRow.dataset.track);

            contextMenuEl = document.createElement('div');
            contextMenuEl.className = 'context-menu';

            const isLiked = MusicPlayer.isLiked(track.id);

            // Build playlist submenu
            const playlists = MusicPlayer.getPlaylists();
            let playlistSubmenuHtml = '';
            if (playlists.length > 0) {
                playlistSubmenuHtml = `
                    <div class="context-submenu">
                        ${playlists.map(pl => `
                            <div class="context-submenu-item" data-ctx="add-to-playlist" data-playlist-id="${pl.id}">
                                <span class="material-icons-round">queue_music</span> ${escapeHtml(pl.name)}
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            contextMenuEl.innerHTML = `
                <div class="context-menu-item" data-ctx="play">
                    <span class="material-icons-round">play_arrow</span> Phát ngay
                </div>
                <div class="context-menu-item" data-ctx="play-next">
                    <span class="material-icons-round">queue_play_next</span> Phát tiếp theo
                </div>
                <div class="context-menu-item" data-ctx="add-queue">
                    <span class="material-icons-round">playlist_add</span> Thêm vào hàng chờ
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" data-ctx="like">
                    <span class="material-icons-round">${isLiked ? 'favorite' : 'favorite_border'}</span> ${isLiked ? 'Bỏ thích' : 'Thêm vào Yêu thích'}
                </div>
                <div class="context-menu-divider"></div>
                <div class="context-menu-item" style="font-weight:500;color:var(--text-secondary);font-size:12px;pointer-events:none;padding:6px 16px">
                    <span class="material-icons-round" style="font-size:16px">queue_music</span> THÊM VÀO PLAYLIST
                </div>
                <div class="context-submenu-item" data-ctx="new-playlist">
                    <span class="material-icons-round">add</span> Tạo playlist mới
                </div>
                ${playlistSubmenuHtml}
            `;

            // Position
            let x = e.clientX;
            let y = e.clientY;
            document.body.appendChild(contextMenuEl);

            const rect = contextMenuEl.getBoundingClientRect();
            if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
            if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;

            contextMenuEl.style.left = x + 'px';
            contextMenuEl.style.top = y + 'px';

            // Handle clicks
            contextMenuEl.addEventListener('click', (ev) => {
                const ctxItem = ev.target.closest('[data-ctx]');
                if (!ctxItem) return;
                const action = ctxItem.dataset.ctx;

                switch (action) {
                    case 'play':
                        MusicPlayer.playTrack(track);
                        break;
                    case 'play-next':
                        MusicPlayer.addNextInQueue(track);
                        showToast('Sẽ phát tiếp theo');
                        updateQueueUI();
                        break;
                    case 'add-queue':
                        MusicPlayer.addToQueue(track);
                        showToast('Đã thêm vào hàng chờ');
                        updateQueueUI();
                        break;
                    case 'like': {
                        const liked = MusicPlayer.toggleLike(track);
                        showToast(liked ? 'Đã thêm vào Yêu thích' : 'Đã xóa khỏi Yêu thích');
                        break;
                    }
                    case 'new-playlist':
                        showCreatePlaylistDialog((name) => {
                            const plId = MusicPlayer.createPlaylist(name);
                            MusicPlayer.addToPlaylist(plId, track);
                            showToast(`Đã tạo "${name}" và thêm bài hát`);
                        });
                        break;
                    case 'add-to-playlist': {
                        const plId = ctxItem.dataset.playlistId;
                        const added = MusicPlayer.addToPlaylist(plId, track);
                        if (added) {
                            const pl = MusicPlayer.getPlaylist(plId);
                            showToast(`Đã thêm vào "${pl.name}"`);
                        } else {
                            showToast('Bài hát đã có trong playlist này');
                        }
                        break;
                    }
                }

                removeContextMenu();
            });
        } catch (err) {
            console.error(err);
        }
    }

    function removeContextMenu() {
        if (contextMenuEl) {
            contextMenuEl.remove();
            contextMenuEl = null;
        }
    }

    // ===== PLAYER UI UPDATES =====

    function updatePlayerUI(track) {
        if (!track) return;

        const thumb = track.thumbnail || MusicAPI.getThumbnail(track.id);

        // Player bar
        dom.playerThumbnail.src = thumb;
        dom.playerSongTitle.textContent = track.title;
        dom.playerSongArtist.textContent = track.artist;

        // Fullscreen player
        dom.fsThumbnail.src = MusicAPI.getThumbnail(track.id, 'high');
        dom.fsSongTitle.textContent = track.title;
        dom.fsSongArtist.textContent = track.artist;

        // Like button
        updateLikeButton(track.id);

        // Update playing indicators in song list
        document.querySelectorAll('.song-row').forEach(row => {
            try {
                const rowTrack = JSON.parse(row.dataset.track);
                row.classList.toggle('playing', rowTrack.id === track.id);
            } catch { }
        });

        // Page title
        document.title = `${track.title} - MusicFlow`;
    }

    function updatePlayButton(playing) {
        const icon = playing ? 'pause' : 'play_arrow';
        dom.playBtn.querySelector('.material-icons-round').textContent = icon;
        dom.fsPlayBtn.querySelector('.material-icons-round').textContent = icon;
        dom.playerEqualizer.classList.toggle('active', playing);
    }

    function updateTimeUI(time) {
        dom.currentTime.textContent = MusicAPI.formatDuration(time.current);
        dom.totalTime.textContent = MusicAPI.formatDuration(time.duration);
        dom.progressBar.value = time.percent;

        dom.fsCurrentTime.textContent = MusicAPI.formatDuration(time.current);
        dom.fsTotalTime.textContent = MusicAPI.formatDuration(time.duration);
        dom.fsProgressBar.value = time.percent;

        // Update progress bar fill
        updateSliderFill(dom.progressBar, time.percent);
        updateSliderFill(dom.fsProgressBar, time.percent);
    }

    function updateSliderFill(slider, percent) {
        slider.style.background = `linear-gradient(to right, var(--accent) ${percent}%, var(--bg-hover) ${percent}%)`;
    }

    function updateVolumeIcon(vol) {
        let icon = 'volume_up';
        if (vol === 0) icon = 'volume_off';
        else if (vol < 30) icon = 'volume_mute';
        else if (vol < 70) icon = 'volume_down';
        dom.volumeBtn.querySelector('.material-icons-round').textContent = icon;
    }

    function updateLikeButton(trackId) {
        const liked = MusicPlayer.isLiked(trackId);
        const icon = liked ? 'favorite' : 'favorite_border';
        dom.playerLikeBtn.querySelector('.material-icons-round').textContent = icon;
        dom.playerLikeBtn.classList.toggle('active', liked);
        dom.fsLikeBtn.querySelector('.material-icons-round').textContent = icon;
        dom.fsLikeBtn.classList.toggle('active', liked);
    }

    function restorePlayerUI() {
        const track = MusicPlayer.getCurrentTrack();
        if (track) {
            updatePlayerUI(track);
        }

        // Restore modes
        dom.shuffleBtn.classList.toggle('active', MusicPlayer.getShuffleMode());
        dom.fsShuffleBtn.classList.toggle('active', MusicPlayer.getShuffleMode());
        updateRepeatUI(MusicPlayer.getRepeatMode());

        // Restore volume
        const vol = MusicPlayer.getVolume();
        dom.volumeSlider.value = vol;
        updateVolumeIcon(vol);
    }

    // ===== QUEUE UI =====

    function toggleQueue() {
        const isActive = dom.queuePanel.classList.contains('active');
        if (isActive) {
            closeQueue();
        } else {
            openQueue();
        }
    }

    function openQueue() {
        dom.queuePanel.classList.add('active');
        dom.queueOverlay.classList.add('active');
        updateQueueUI();
    }

    function closeQueue() {
        dom.queuePanel.classList.remove('active');
        dom.queueOverlay.classList.remove('active');
    }

    function updateQueueUI() {
        const queue = MusicPlayer.getQueue();
        const currentIdx = MusicPlayer.getCurrentIndex();

        if (queue.length === 0) {
            dom.queueList.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px;">
                    <span class="material-icons-round" style="font-size:48px;">queue_music</span>
                    <h3>Danh sách phát trống</h3>
                    <p>Thêm bài hát để phát</p>
                </div>
            `;
            return;
        }

        dom.queueList.innerHTML = queue.map((track, i) => `
            <div class="queue-item ${i === currentIdx ? 'playing' : ''}" data-index="${i}">
                <div class="queue-item-thumb">
                    <img src="${track.thumbnail || MusicAPI.getThumbnail(track.id)}" alt="" loading="lazy">
                </div>
                <div class="queue-item-info">
                    <div class="queue-item-title">${escapeHtml(track.title)}</div>
                    <div class="queue-item-artist">${escapeHtml(track.artist)}</div>
                </div>
                <button class="icon-btn queue-item-remove" title="Xóa">
                    <span class="material-icons-round" style="font-size:18px;">close</span>
                </button>
            </div>
        `).join('');
    }

    // ===== FULLSCREEN PLAYER =====

    function openFullscreenPlayer() {
        dom.fullscreenPlayer.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeFullscreenPlayer() {
        dom.fullscreenPlayer.classList.remove('active');
        document.body.style.overflow = '';
    }

    // ===== REPEAT TOGGLE =====

    function handleRepeatToggle() {
        const mode = MusicPlayer.toggleRepeat();
        updateRepeatUI(mode);
        const labels = ['Tắt lặp lại', 'Lặp lại tất cả', 'Lặp lại một bài'];
        showToast(labels[mode]);
    }

    function updateRepeatUI(mode) {
        const icons = ['repeat', 'repeat', 'repeat_one'];
        dom.repeatBtn.querySelector('.material-icons-round').textContent = icons[mode];
        dom.repeatBtn.classList.toggle('active', mode > 0);
        dom.fsRepeatBtn.querySelector('.material-icons-round').textContent = icons[mode];
        dom.fsRepeatBtn.classList.toggle('active', mode > 0);
    }

    // ===== LIKE TOGGLE =====

    function handleLikeToggle() {
        const track = MusicPlayer.getCurrentTrack();
        if (!track) return;
        const liked = MusicPlayer.toggleLike(track);
        updateLikeButton(track.id);
        showToast(liked ? 'Đã thêm vào Yêu thích' : 'Đã xóa khỏi Yêu thích');
    }

    // ===== RELATED =====

    async function loadRelated(videoId) {
        if (isPlayingContextPlaylist) return; // Do not auto-add random songs when playing a custom Playlist

        const queue = MusicPlayer.getQueue();
        const currentIdx = MusicPlayer.getCurrentIndex();

        // Only auto-load related if near end of queue
        if (currentIdx < queue.length - 2) return;

        try {
            const related = await MusicAPI.getRelated(videoId);
            if (related && related.length > 0) {
                related.forEach(track => {
                    // Don't add duplicates
                    if (!queue.find(q => q.id === track.id)) {
                        MusicPlayer.addToQueue(track);
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to load related:', e);
        }
    }

    // ===== KEYBOARD SHORTCUTS =====

    function handleKeyboard(e) {
        // Don't handle if typing in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                MusicPlayer.togglePlay();
                break;
            case 'ArrowRight':
                if (e.ctrlKey) MusicPlayer.next();
                break;
            case 'ArrowLeft':
                if (e.ctrlKey) MusicPlayer.previous();
                break;
            case 'ArrowUp':
                if (e.ctrlKey) {
                    e.preventDefault();
                    const vol = Math.min(100, MusicPlayer.getVolume() + 5);
                    MusicPlayer.setVolume(vol);
                    dom.volumeSlider.value = vol;
                    updateVolumeIcon(vol);
                }
                break;
            case 'ArrowDown':
                if (e.ctrlKey) {
                    e.preventDefault();
                    const vol2 = Math.max(0, MusicPlayer.getVolume() - 5);
                    MusicPlayer.setVolume(vol2);
                    dom.volumeSlider.value = vol2;
                    updateVolumeIcon(vol2);
                }
                break;
            case 'KeyF':
                if (e.ctrlKey) {
                    e.preventDefault();
                    dom.searchInput.focus();
                }
                break;
        }
    }

    // ===== UTILITIES =====

    function showLoading() {
        dom.loadingContainer.classList.remove('hidden');
    }

    function hideLoading() {
        dom.loadingContainer.classList.add('hidden');
    }

    function showCreatePlaylistDialog(onConfirm, defaultValue = '', title = 'Tạo playlist mới') {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = `
            <div class="dialog">
                <h3>${title}</h3>
                <input type="text" class="dialog-input" placeholder="Tên playlist" value="${escapeHtml(defaultValue)}" autofocus>
                <div class="dialog-actions">
                    <button class="dialog-btn cancel">Hủy</button>
                    <button class="dialog-btn primary">Lưu</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = overlay.querySelector('.dialog-input');
        const cancelBtn = overlay.querySelector('.dialog-btn.cancel');
        const confirmBtn = overlay.querySelector('.dialog-btn.primary');

        input.focus();
        input.select();

        function close() {
            overlay.remove();
        }

        cancelBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        confirmBtn.addEventListener('click', () => {
            const name = input.value.trim();
            if (name) {
                onConfirm(name);
                close();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const name = input.value.trim();
                if (name) {
                    onConfirm(name);
                    close();
                }
            }
            if (e.key === 'Escape') close();
        });
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        dom.toastContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }

    function escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/'/g, '&#39;')
                  .replace(/"/g, '&quot;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
    }

    // ===== PUBLIC API =====

    return { init };
})();

// ===== GOOGLE CAST =====
window.__onGCastApiAvailable = function(isAvailable) {
    if (isAvailable) {
        cast.framework.CastContext.getInstance().setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });
        console.log('Google Cast initialized');
    }
};

// ===== SERVICE WORKER FOR PWA =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// ===== START APP =====
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
